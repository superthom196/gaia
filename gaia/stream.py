"""The TV stream: Gaia's page rendered on the box and sent to TVs over WebRTC.

Headless Chromium opens the page in TV mode (`/?tv=1&render=<session>`). The
page captures its own tab and offers it to every TV that joins that session
(gaia/web/js/sender.js); the TV plays it (gaia/web/js/player.js). This module
starts and stops those renderer pages and passes the WebRTC offers and
answers between them over one WebSocket, `/api/rtc`.

- The **ambient** session (screensaver mode) always runs, and every idle TV
  watches it.
- A TV that gets a key press asks for an **interactive** session of its own.
  It's started on demand, capped by quality level, and stopped once no TV
  has watched it for a short while.
"""

import asyncio
import contextlib
import itertools
import json
import logging
import os
import secrets
import time
from dataclasses import dataclass, field
from pathlib import Path

from fastapi import WebSocket, WebSocketDisconnect

from gaia.config import Settings

log = logging.getLogger("gaia.stream")

AMBIENT = "ambient"
GRACE = 45  # seconds an interactive session lives on with no viewers
START_TIMEOUT = 60


def chromium_args() -> list[str]:
    args = [
        # getDisplayMedia({preferCurrentTab}) without a prompt.
        "--auto-accept-this-tab-capture",
        "--autoplay-policy=no-user-gesture-required",
        # Offer real LAN addresses, not mDNS names a TV may not resolve.
        "--disable-features=WebRtcHideLocalIpsWithMdns",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        "--no-first-run",
    ]
    if Path("/dev/dri/renderD128").exists():
        args += [
            "--ignore-gpu-blocklist",
            "--enable-gpu-rasterization",
            "--use-gl=angle",
            "--use-angle=gl-egl",
            "--enable-features=VaapiVideoEncoder,VaapiVideoDecoder",
        ]
    else:
        args += ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
    extra = os.environ.get("GAIA_CHROMIUM_ARGS", "").split()
    return args + extra


@dataclass
class Session:
    name: str
    page: object = None  # playwright Page
    renderer: WebSocket | None = None
    ready: asyncio.Event = field(default_factory=asyncio.Event)
    viewers: dict[int, WebSocket] = field(default_factory=dict)
    empty_since: float = field(default_factory=time.time)
    last_key: float = 0.0
    started: float = field(default_factory=time.time)


class Streams:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.tier = settings.tier
        self.key = secrets.token_urlsafe(16)
        self.sessions: dict[str, Session] = {}
        self._ids = itertools.count(1)
        self._pw = None
        self._browser = None
        self._reaper: asyncio.Task | None = None
        self._lock = asyncio.Lock()
        self.error: str | None = None

    # ---- lifecycle ----

    async def start(self) -> None:
        try:
            from playwright.async_api import async_playwright

            self._pw = await async_playwright().start()
            # A full Chromium in new headless mode can capture a tab;
            # Playwright's default headless shell can't. The image uses
            # Debian's (GAIA_CHROMIUM); elsewhere Playwright's own.
            path = os.environ.get("GAIA_CHROMIUM")
            options = {"executable_path": path} if path else {"channel": "chromium"}
            self._browser = await self._pw.chromium.launch(
                headless=True, args=chromium_args(), **options
            )
        except Exception as exc:  # the web page keeps working without streams
            self.error = f"{type(exc).__name__}: {exc}"[:300]
            log.error("TV streaming is off: %s", self.error)
            return
        self._reaper = asyncio.create_task(self._reap())

    async def stop(self) -> None:
        if self._reaper:
            self._reaper.cancel()
        for s in list(self.sessions.values()):
            await self._close(s)
        if self._browser:
            await self._browser.close()
        if self._pw:
            await self._pw.stop()

    async def _open(self, name: str) -> Session:
        session = self.sessions.get(name)
        if session:
            return session
        session = Session(name)
        self.sessions[name] = session
        ambient = "&ambient=1" if name == AMBIENT else ""
        url = f"http://127.0.0.1:{self.settings.port}/?tv=1{ambient}&render={name}&key={self.key}"
        page = await self._browser.new_page(
            viewport={"width": self.tier["width"], "height": self.tier["height"]},
            device_scale_factor=1,
        )
        session.page = page
        page.on("crash", lambda *_: asyncio.create_task(self._close(session)))
        page.on("console", lambda m: self._console(name, m))
        page.on("pageerror", lambda e: log.warning("%s page error: %s", name, e))
        await page.goto(url)
        await page.wait_for_selector("body[data-ready]", timeout=START_TIMEOUT * 1000)
        # A key press is the user gesture getDisplayMedia needs.
        await page.keyboard.press("Shift")
        log.info("renderer %s opened", name)
        return session

    @staticmethod
    def _console(name: str, message) -> None:
        # SwiftShader and ANGLE chatter about buffer readback; skip it.
        if message.type in ("error", "warning") and "performance warning" not in message.text:
            log.info("%s console %s: %s", name, message.type, message.text)

    async def _close(self, session: Session) -> None:
        self.sessions.pop(session.name, None)
        for ws in list(session.viewers.values()):
            with contextlib.suppress(Exception):
                await ws.close(code=4000, reason="session ended")
        if session.page:
            with contextlib.suppress(Exception):
                await session.page.close()
        log.info("renderer %s closed", session.name)

    async def _reap(self) -> None:
        while True:
            try:
                if AMBIENT not in self.sessions:
                    await self._ensure(AMBIENT)
                now = time.time()
                for s in list(self.sessions.values()):
                    if s.name != AMBIENT and not s.viewers and now - s.empty_since > GRACE:
                        await self._close(s)
            except Exception as exc:
                log.warning("stream upkeep: %s", exc)
            await asyncio.sleep(10)

    async def _ensure(self, name: str) -> Session:
        async with self._lock:
            session = await self._open(name)
        await asyncio.wait_for(session.ready.wait(), START_TIMEOUT)
        return session

    # ---- signalling ----

    async def signal(self, ws: WebSocket) -> None:
        await ws.accept()
        try:
            hello = json.loads(await ws.receive_text())
            if hello.get("role") == "renderer":
                await self._renderer(ws, hello)
            else:
                await self._viewer(ws, hello)
        except (WebSocketDisconnect, asyncio.CancelledError):
            pass
        except Exception as exc:
            log.warning("signalling: %s", exc)
            with contextlib.suppress(Exception):
                await ws.close()

    async def _renderer(self, ws: WebSocket, hello: dict) -> None:
        session = self.sessions.get(hello.get("session", ""))
        if not session or not secrets.compare_digest(hello.get("key", ""), self.key):
            await ws.close(code=4403)
            return
        session.renderer = ws
        session.ready.set()
        async for raw in ws.iter_text():
            msg = json.loads(raw)
            viewer = session.viewers.get(msg.get("viewer"))
            if msg["type"] == "offer" and viewer:
                await viewer.send_text(json.dumps({"type": "offer", "sdp": msg["sdp"]}))
            elif msg["type"] == "key":
                session.last_key = time.time()
        session.renderer = None
        session.ready.clear()

    async def _viewer(self, ws: WebSocket, hello: dict) -> None:
        want = hello.get("want")
        name = AMBIENT
        if want == "interactive":
            tv = "".join(c for c in str(hello.get("tv", "")) if c.isalnum() or c == "-")[:40]
            name = f"tv-{tv or secrets.token_hex(4)}"
            interactive = [s for s in self.sessions if s != AMBIENT and s != name]
            if len(interactive) >= self.tier["interactive"]:
                await ws.send_text(json.dumps({"type": "busy"}))
                await ws.close()
                return
        if not self._browser:
            await ws.close(code=4503, reason="streaming unavailable")
            return
        session = await self._ensure(name)
        vid = next(self._ids)
        session.viewers[vid] = ws
        try:
            await session.renderer.send_text(json.dumps({"type": "join", "viewer": vid}))
            async for raw in ws.iter_text():
                msg = json.loads(raw)
                if msg["type"] == "answer" and session.renderer:
                    await session.renderer.send_text(
                        json.dumps({"type": "answer", "viewer": vid, "sdp": msg["sdp"]})
                    )
        finally:
            session.viewers.pop(vid, None)
            if not session.viewers:
                session.empty_since = time.time()
            if session.renderer:
                with contextlib.suppress(Exception):
                    await session.renderer.send_text(json.dumps({"type": "leave", "viewer": vid}))

    def report(self) -> dict:
        return {
            "running": self._browser is not None,
            "error": self.error,
            "sessions": [
                {
                    "name": s.name,
                    "viewers": len(s.viewers),
                    "ready": s.ready.is_set(),
                    "age": round(time.time() - s.started),
                }
                for s in self.sessions.values()
            ],
            "max_interactive": self.tier["interactive"],
        }
