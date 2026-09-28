"""Storms, wildfires, floods and icebergs from NASA EONET.

EONET's volcanoes are left out: Gaia builds its own from the Smithsonian's
weekly report and USGS HANS (gaia/feeds/volcanoes.py).

EONET keeps thousands of events "open" long after anyone updates them, most
of them small US burns. Gaia drops anything not updated for 30 days,
prescribed burns, and wildfires under 400 ha.
"""

import re
from datetime import UTC, datetime, timedelta

import httpx

from gaia.feeds import event, iso
from gaia.store import Store

URL = "https://eonet.gsfc.nasa.gov/api/v3/events?status=open"
SNAPSHOT = "eonet.json"

KIND = {"severeStorms": "storm", "wildfires": "fire", "floods": "flood", "seaLakeIce": "ice"}

ACRE_HA = 0.404686
NM2_KM2 = 3.429904
STALE = timedelta(days=30)
MIN_FIRE_HA = 400
PRESCRIBED = re.compile(r"^Prescribed|\bRX\b", re.I)


def storm_category(kt: float | None) -> str | None:
    """Saffir–Simpson from the wind in knots, as the agencies report it."""
    if kt is None:
        return None
    for floor, name in (
        (137, "Cat 5"),
        (113, "Cat 4"),
        (96, "Cat 3"),
        (83, "Cat 2"),
        (64, "Cat 1"),
        (34, "Tropical storm"),
    ):
        if kt >= floor:
            return name
    return "Tropical depression"


def normalise(payload: dict, now: datetime | None = None) -> list[dict]:
    cutoff = iso((now or datetime.now(UTC)) - STALE)
    out = []
    for e in payload.get("events", []):
        cats = [c["id"] for c in e.get("categories", [])]
        kind = next((KIND[c] for c in cats if c in KIND), None)
        points = [g for g in e.get("geometry", []) if g.get("type") == "Point"]
        if kind is None or not points:
            continue
        points.sort(key=lambda g: g["date"])
        last = points[-1]
        if last["date"] < cutoff:
            continue
        lon, lat = last["coordinates"][:2]
        value, unit = last.get("magnitudeValue"), last.get("magnitudeUnit")
        extra = {}
        if kind == "storm":
            extra["category"] = storm_category(value)
            if len(points) > 1:
                extra["track"] = [
                    [g["coordinates"][0], g["coordinates"][1], g["date"], g.get("magnitudeValue")]
                    for g in points
                ]
        elif kind == "fire":
            if PRESCRIBED.search(e["title"]):
                continue
            if value is not None and unit == "acres":
                value, unit = round(value * ACRE_HA), "ha"
            if value is not None and unit == "ha" and value < MIN_FIRE_HA:
                continue
        elif kind == "ice" and value is not None and unit == "NM^2":
            value, unit = round(value * NM2_KM2), "km²"
        source = e.get("sources") or [{}]
        out.append(
            event(
                f"eonet:{e['id']}",
                kind,
                e["title"],
                lon,
                lat,
                source=f"{source[0].get('id', 'EONET')} via NASA EONET",
                magnitude=value,
                unit=unit,
                started=points[0]["date"],
                updated=last["date"],
                link=source[0].get("url") or e.get("link"),
                **extra,
            )
        )
    return out


async def run(client: httpx.AsyncClient, store: Store) -> None:
    r = await client.get(URL)
    r.raise_for_status()
    store.write_json(SNAPSHOT, normalise(r.json()))
