"""Disaster alert levels from GDACS (green, orange, red).

GDACS mostly adds a severity to events Gaia already has from USGS, EONET and
the volcano feeds (see gaia/events.py). Floods and droughts often exist only
here, so those come through as events of their own.
"""

import httpx

from gaia.feeds import event, iso, parse_time
from gaia.store import Store

URL = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;DR;WF"
SNAPSHOT = "gdacs.json"

KIND = {"EQ": "quake", "TC": "storm", "FL": "flood", "VO": "volcano", "DR": "drought", "WF": "fire"}


def normalise(payload: dict) -> list[dict]:
    out = []
    for f in payload.get("features", []):
        p = f["properties"]
        kind = KIND.get(p.get("eventtype"))
        if kind is None or not p.get("iscurrent"):
            continue
        geom = f.get("geometry") or {}
        if geom.get("type") != "Point":
            continue
        lon, lat = geom["coordinates"][:2]
        level = (p.get("alertlevel") or "").lower()
        out.append(
            event(
                f"gdacs:{p['eventtype']}{p['eventid']}",
                kind,
                p.get("name") or p.get("eventname") or kind,
                lon,
                lat,
                source="GDACS",
                place=p.get("country"),
                severity=level if level in ("green", "orange", "red") else None,
                started=iso(parse_time(p["fromdate"])) if p.get("fromdate") else None,
                updated=iso(parse_time(p["todate"])) if p.get("todate") else None,
                link=(p.get("url") or {}).get("report"),
            )
        )
    return out


async def run(client: httpx.AsyncClient, store: Store) -> None:
    r = await client.get(URL)
    r.raise_for_status()
    store.write_json(SNAPSHOT, normalise(r.json()))
