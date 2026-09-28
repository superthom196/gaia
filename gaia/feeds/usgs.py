"""Earthquakes from the USGS: every M2.5+ quake of the past week.

The page filters (M4.5+ over the past day by default) and groups swarms
itself, so the snapshot keeps the whole week.
"""

import httpx

from gaia.feeds import event, from_ms
from gaia.store import Store

URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson"
SNAPSHOT = "quakes.json"


def normalise(geojson: dict) -> list[dict]:
    out = []
    for f in geojson.get("features", []):
        p = f["properties"]
        lon, lat, depth = (f["geometry"]["coordinates"] + [None])[:3]
        mag = p.get("mag")
        if mag is None:
            continue
        out.append(
            event(
                f"usgs:{f['id']}",
                "quake",
                f"M{mag:.1f} · {p.get('place') or 'Unknown place'}",
                lon,
                lat,
                source="USGS",
                place=p.get("place"),
                # PAGER's alert level, set only for quakes that may do damage.
                severity=p.get("alert"),
                magnitude=round(mag, 1),
                unit=p.get("magType"),
                started=from_ms(p["time"]),
                updated=from_ms(p.get("updated") or p["time"]),
                link=p.get("url"),
                depth_km=None if depth is None else round(depth, 1),
                felt=p.get("felt"),
            )
        )
    return out


async def run(client: httpx.AsyncClient, store: Store) -> None:
    r = await client.get(URL)
    r.raise_for_status()
    store.write_json(SNAPSHOT, normalise(r.json()))
