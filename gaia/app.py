"""The web app: Gaia's API, the page, and the TV stream's signalling."""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from gaia import __version__, config, events
from gaia.feeds import clouds, eonet, gdacs, gfs, ice, usgs, volcanoes
from gaia.scheduler import Feed, Scheduler
from gaia.store import Store

WEB = Path(__file__).parent / "web"
MINUTE = 60
HOUR = 60 * MINUTE

log = logging.getLogger("gaia")


def feeds(settings: config.Settings) -> list[Feed]:
    live_clouds = settings.tier["live_clouds"]
    return [
        Feed("quakes", MINUTE, usgs.run, "USGS Earthquake Hazards Program"),
        Feed("eonet", 15 * MINUTE, eonet.run, "NASA EONET"),
        Feed("gdacs", 15 * MINUTE, gdacs.run, "GDACS"),
        Feed("volcano-reports", 6 * HOUR, volcanoes.run_gvp, "Smithsonian GVP"),
        Feed("volcano-alerts", 30 * MINUTE, volcanoes.run_hans, "USGS HANS"),
        Feed("sea-ice", 6 * HOUR, ice.run, "NSIDC Sea Ice Index"),
        # Lite boxes refresh clouds hourly: the stream shows them static.
        Feed(
            "clouds", (10 if live_clouds else 60) * MINUTE, clouds.run, "NASA GIBS (GOES, Himawari)"
        ),
        Feed("weather", HOUR, gfs.run, "NOAA GFS", timeout=300),
    ]


def create_app(settings: config.Settings | None = None, *, start_feeds: bool = True) -> FastAPI:
    settings = settings or config.load()
    store = Store(settings.data)
    scheduler = Scheduler(store, feeds(settings))
    streams = None

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        nonlocal streams
        if start_feeds:
            await scheduler.start()
        if settings.stream:
            from gaia.stream import Streams  # needs Playwright and Chromium

            streams = Streams(settings)
            await streams.start()
        yield
        if streams:
            await streams.stop()
        if start_feeds:
            await scheduler.stop()

    app = FastAPI(
        title="Gaia", version=__version__, lifespan=lifespan, docs_url=None, redoc_url=None
    )
    app.state.store = store
    app.state.scheduler = scheduler

    @app.get("/health")
    def health():
        return {"ok": True}

    @app.get("/api/events")
    def api_events():
        return events.collect(store)

    @app.get("/api/volcanoes")
    def api_volcanoes():
        return events.volcanoes(
            store.read_json("gvp.json", []) or [], store.read_json("hans.json", []) or []
        )

    @app.get("/api/ice")
    def api_ice():
        return store.read_json("ice.json") or JSONResponse({}, status_code=503)

    @app.get("/api/weather/{name}")
    def api_weather(name: str):
        stem, _, ext = name.partition(".")
        if stem not in ("wind", "temp", "rain", "clouds") or ext not in ("png", "json"):
            raise HTTPException(404)
        path = store.path(name)
        if not path.exists():
            raise HTTPException(503, "not fetched yet")
        media = "image/png" if ext == "png" else "application/json"
        return FileResponse(path, media_type=media, headers={"Cache-Control": "no-cache"})

    @app.get("/api/status")
    def api_status():
        return {
            "version": __version__,
            "quality": settings.quality,
            "quality_source": settings.quality_source,
            "stream": streams.report() if streams else None,
            "feeds": scheduler.report(),
        }

    @app.get("/api/config")
    def api_config():
        """What the page needs to know about this box."""
        return {"version": __version__, "quality": settings.quality, "tier": settings.tier}

    @app.websocket("/api/rtc")
    async def rtc(ws: WebSocket):
        if not streams:
            await ws.close(code=4404, reason="streaming is off")
            return
        await streams.signal(ws)

    @app.get("/")
    def index():
        return FileResponse(WEB / "index.html", headers={"Cache-Control": "no-cache"})

    @app.get("/tv")
    def tv():
        return FileResponse(WEB / "tv.html", headers={"Cache-Control": "no-cache"})

    @app.get("/favicon.ico")
    def favicon():
        return Response(status_code=204)

    app.mount("/static", StaticFiles(directory=WEB), name="static")
    return app
