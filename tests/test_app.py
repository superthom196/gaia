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
