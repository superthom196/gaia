import time

import pytest
from fastapi.testclient import TestClient

from gaia import config
from gaia.app import create_app


@pytest.fixture
def client(tmp_path):
    settings = config.Settings(
        data=tmp_path, quality="lite", quality_source="set", stream=False, port=0
    )
    app = create_app(settings, start_feeds=False)
    with TestClient(app) as c:
        yield c


def test_page_and_health(client):
    assert client.get("/health").json() == {"ok": True}
    assert "<title>Gaia</title>" in client.get("/").text


def test_empty_box_serves_empty_events(client):
    assert client.get("/api/events").json() == {"type": "FeatureCollection", "features": []}


def test_weather_is_503_until_fetched_and_rejects_other_names(client):
    assert client.get("/api/weather/wind.png").status_code == 503
    assert client.get("/api/weather/secrets.txt").status_code == 404
    assert client.get("/api/weather/..%2Fstatus.json").status_code == 404


def test_status_lists_every_feed(client):
    store = client.app.state.store
    store.write_json("status.json", {})
    body = client.get("/api/status").json()
    assert body["quality"] == "lite"
    assert body["stream"] is False
    names = {f["name"] for f in body["feeds"]}
    assert {"quakes", "eonet", "gdacs", "clouds", "weather"} <= names
    assert all(f["ok"] is False for f in body["feeds"])


def test_status_marks_fresh_feeds_ok(client):
    scheduler = client.app.state.scheduler
    scheduler.status["quakes"] = {"last_success": time.time()}
    quakes = next(f for f in client.get("/api/status").json()["feeds"] if f["name"] == "quakes")
    assert quakes["ok"] is True


def test_quality_detection_respects_override(monkeypatch):
    monkeypatch.setenv("GAIA_QUALITY", "high")
    assert config.load().quality == "high"
    assert config.load().stream is True


def test_lite_never_streams(monkeypatch):
    monkeypatch.setenv("GAIA_QUALITY", "lite")
    monkeypatch.setenv("GAIA_STREAM", "1")
    assert config.load().stream is False
    monkeypatch.setenv("GAIA_QUALITY", "standard")
    monkeypatch.setenv("GAIA_STREAM", "0")
    assert config.load().stream is False
    monkeypatch.setenv("GAIA_QUALITY", "auto")
    assert config.load().quality_source == "auto"


def test_home_follows_the_timezone(tmp_path):
    table = tmp_path / "zone.tab"
    table.write_text(
        "# comment\nGB\t+513030-0000731\tEurope/London\nAU\t-3352+15113\tAustralia/Sydney\n"
    )
    config.ZONE_TABLES[:] = [table]
    try:
        assert config.home("Europe/London") == (-0.1, 30.0)  # latitude kept within 30
        assert config.home("Australia/Sydney") == (151.2, -30.0)
        assert config.home("Nowhere/Else") == (0.0, 20.0)
    finally:
        config.ZONE_TABLES[:] = [
            config.Path("/usr/share/zoneinfo/zone1970.tab"),
            config.Path("/usr/share/zoneinfo/zone.tab"),
        ]


def test_config_gives_home_and_serves_the_base_map(tmp_path):
    tiles = tmp_path / "tiles"
    (tiles / "0" / "0").mkdir(parents=True)
    (tiles / "0" / "0" / "0.jpg").write_bytes(b"\xff\xd8jpeg")
    settings = config.Settings(
        data=tmp_path,
        quality="lite",
        quality_source="set",
        stream=False,
        port=0,
        tiles=tiles,
        home=(-0.1, 30.0),
    )
    with TestClient(create_app(settings, start_feeds=False)) as c:
        body = c.get("/api/config").json()
        assert body["home"] == [-0.1, 30.0]
        assert body["basemap"] == "/tiles/{z}/{x}/{y}.jpg"
        tile = c.get("/tiles/0/0/0.jpg")
        assert tile.status_code == 200 and "max-age" in tile.headers["cache-control"]


def test_no_tiles_means_no_base_map_url(client):
    assert client.get("/api/config").json()["basemap"] is None
