import json
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

from gaia import events, textures
from gaia.feeds import eonet, gdacs, ice, km_between, usgs, volcanoes

FIX = Path(__file__).parent / "fixtures"
NOW = datetime(2026, 9, 28, 10, tzinfo=UTC)


def load(name):
    return json.loads((FIX / name).read_text())


def test_usgs_events_have_the_common_shape():
    out = usgs.normalise(load("usgs.geojson"))
    assert len(out) == 5
    p = out[0]["properties"]
    assert p["kind"] == "quake"
    assert p["title"].startswith(f"M{p['magnitude']:.1f} · ")
    assert p["started"].endswith("Z") and p["link"].startswith("https://earthquake.usgs.gov")
    assert set(p) >= {
        "id",
        "kind",
        "title",
        "place",
        "severity",
        "magnitude",
        "unit",
        "started",
        "updated",
        "source",
        "link",
    }


def test_eonet_storm_keeps_its_track_and_category():
    out = eonet.normalise(load("eonet.json"), now=NOW)
    nolo = next(f["properties"] for f in out if f["properties"]["title"] == "Hurricane Nolo")
    assert nolo["kind"] == "storm"
    assert nolo["category"] == "Cat 4"  # 135 kt
    assert len(nolo["track"]) > 10
    assert nolo["track"][-1][3] == nolo["magnitude"]


def test_eonet_converts_units_and_drops_prescribed_burns():
    out = {
        f["properties"]["title"]: f["properties"]
        for f in eonet.normalise(load("eonet.json"), now=NOW)
    }
    assert not any(t.startswith("Prescribed") for t in out)
    assert out["Wildfire Davis Coulee, Big Horn, Montana"]["unit"] == "ha"
    assert out["Iceberg B22A"]["unit"] == "km²"


def test_eonet_drops_events_nobody_updated_for_a_month():
    later = datetime(2027, 1, 1, tzinfo=UTC)
    assert eonet.normalise(load("eonet.json"), now=later) == []


def test_storm_categories():
    assert eonet.storm_category(20) == "Tropical depression"
    assert eonet.storm_category(40) == "Tropical storm"
    assert eonet.storm_category(113) == "Cat 4"
    assert eonet.storm_category(160) == "Cat 5"


def test_gvp_weekly_report_parses():
    reports = volcanoes.parse_gvp((FIX / "gvp.xml").read_bytes())
    kilauea = next(r for r in reports if r["name"] == "Kilauea")
    assert kilauea["vnum"] == "332010"
    assert kilauea["country"] == "United States"
    assert kilauea["status"] == "Continuing Eruptive Activity"
    assert round(kilauea["lat"], 2) == 19.42 and round(kilauea["lon"], 2) == -155.29
    assert "Halema" in kilauea["text"] and "<" not in kilauea["text"]
    assert kilauea["report_source"].startswith("US Geological Survey")


def test_gdacs_matches_add_severity_instead_of_duplicates():
    storms = eonet.normalise(load("eonet.json"), now=NOW)
    alerts = gdacs.normalise(load("gdacs.geojson"))
    merged = events.merge([dict(f, properties=dict(f["properties"])) for f in storms], alerts)
    titles = [f["properties"]["title"] for f in merged]
    assert len(titles) == len(set(titles))
    # Floods only GDACS knows about come through as events of their own.
    assert any(f["properties"]["kind"] == "flood" for f in merged)


def test_volcanoes_join_report_and_alert_on_vnum():
    reports = volcanoes.parse_gvp((FIX / "gvp.xml").read_bytes())
    hans = [
        {
            "vnum": "332010",
            "name": "Kilauea",
            "lon": -155.287,
            "lat": 19.421,
            "region": "HI",
            "alert_level": "WATCH",
            "color_code": "ORANGE",
            "observatory": "Hawaiian Volcano Observatory",
            "notice": "https://example",
            "sent": "2026-09-27T19:16:03Z",
        }
    ]
    vols = events.volcanoes(reports, hans)
    assert len(vols) == len(reports)
    ev = {f["properties"]["title"]: f["properties"] for f in events.volcano_events(vols)}
    assert ev["Kilauea"]["severity"] == "orange"
    assert ev["Kilauea"]["alert_level"] == "WATCH"
    assert ev["Krakatau"]["severity"] is None


def test_sea_ice_summary_against_normal():
    out = ice.summarise((FIX / "N_daily.csv").read_text(), (FIX / "N_clim.csv").read_text())
    assert out["date"] == "2026-09-26"
    assert out["extent"] == 5.164
    assert out["p10"] < out["normal"] < out["p90"]
    assert out["difference"] == round(out["extent"] - out["normal"], 3)
    assert out["chart"][-1][0] == out["date"] and len(out["chart"]) == ice.DAYS + 1


def test_distance():
    assert round(km_between([0, 0], [0, 1])) == 111


def test_mercator_resampling_keeps_the_equator_in_the_middle():
    grid = np.tile(np.linspace(90, -90, 181)[:, None], (1, 360))  # value = latitude
    merc = textures.to_mercator(grid, 256)
    assert abs(merc[128, 0]) < 1.5
    assert merc[0, 0] > 84 and merc[-1, 0] < -84
