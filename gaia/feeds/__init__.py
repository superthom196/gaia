"""The feeds, and the one event shape they all turn their data into.

Every event is a GeoJSON Point feature with the same properties, whatever its
source: `id`, `kind`, `title`, `place`, `severity`, `magnitude`, `unit`,
`started`, `updated`, `source`, `link`, plus optional `track` (storms) and
`detail` (anything kind-specific).
"""

import math
from datetime import UTC, datetime

KINDS = ("quake", "volcano", "storm", "fire", "flood", "ice", "drought")
SEVERITIES = ("green", "yellow", "orange", "red")


def event(
    id: str,
    kind: str,
    title: str,
    lon: float,
    lat: float,
    *,
    source: str,
    place: str | None = None,
    severity: str | None = None,
    magnitude: float | None = None,
    unit: str | None = None,
    started: str | None = None,
    updated: str | None = None,
    link: str | None = None,
    **extra,
) -> dict:
    assert kind in KINDS, kind
    assert severity in (None, *SEVERITIES), severity
    props = {
        "id": id,
        "kind": kind,
        "title": title,
        "place": place,
        "severity": severity,
        "magnitude": magnitude,
        "unit": unit,
        "started": started,
        "updated": updated or started,
        "source": source,
        "link": link,
    }
    props.update(extra)
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [round(lon, 4), round(lat, 4)]},
        "properties": props,
    }


def iso(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def from_ms(ms: int) -> str:
    return iso(datetime.fromtimestamp(ms / 1000, UTC))


def parse_time(s: str) -> datetime:
    """ISO 8601 with or without a zone; no zone means UTC."""
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def km_between(a: list[float], b: list[float]) -> float:
    """Great-circle distance between two [lon, lat] points."""
    lon1, lat1, lon2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return 6371 * 2 * math.asin(math.sqrt(min(1.0, h)))
