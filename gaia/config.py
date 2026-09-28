"""Settings from the environment, and the quality level the box can manage."""

import os
import re
from dataclasses import dataclass, field
from pathlib import Path

# What each quality level renders on the box for the TV stream. Browsers
# always render the full page themselves; these only shape the streams.
# Lite boxes (thin clients) don't stream at all: they serve the web page and
# nothing else, and Nexiom gives their TVs no app.
QUALITY = {
    "lite": {
        "width": 1280,
        "height": 720,
        "fps": 30,
        "wind": False,
        "live_clouds": False,
        "night_lights": False,
    },
    "standard": {
        "width": 1920,
        "height": 1080,
        "fps": 30,
        "wind": True,
        "live_clouds": True,
        "night_lights": True,
    },
    "high": {
        "width": 1920,
        "height": 1080,
        "fps": 60,
        "wind": True,
        "live_clouds": True,
        "night_lights": True,
    },
}


def detect_quality() -> str:
    """Pick a level from the hardware: a GPU render device and enough cores."""
    cores = os.cpu_count() or 1
    gpu = Path("/dev/dri/renderD128").exists()
    if gpu and cores >= 8:
        return "high"
    if gpu and cores >= 4:
        return "standard"
    return "lite"


@dataclass(frozen=True)
class Settings:
    data: Path
    quality: str
    quality_source: str  # "auto" or "set"
    stream: bool  # stream to TVs (headless Chromium); never at the Lite level
    port: int
    tiles: Path = Path("/app/tiles")  # the base map (gaia.basemap), baked into the image
    home: tuple[float, float] = field(default=(0.0, 20.0))  # where the globe opens: lon, lat

    @property
    def tier(self) -> dict:
        return QUALITY[self.quality]


ZONE_TABLES = [Path("/usr/share/zoneinfo/zone1970.tab"), Path("/usr/share/zoneinfo/zone.tab")]
COORDS = (
    r"([+-])(\d{2})(\d{2})(\d{2})?([+-])(\d{3})(\d{2})(\d{2})?"  # ISO 6709, as the tables write it
)


def home(zone: str | None = None) -> tuple[float, float]:
    """Where the globe opens: over the box's timezone (TZ), as lon, lat.

    The tz database gives each zone's city; the latitude is kept within 30
    degrees of the equator so the view is of the region, not over the pole.
    """
    zone = zone or os.environ.get("TZ", "").lstrip(":")
    for table in ZONE_TABLES:
        if not zone or not table.exists():
            continue
        for line in table.read_text().splitlines():
            cols = line.split("\t")
            if len(cols) >= 3 and cols[2] == zone:
                m = re.fullmatch(COORDS, cols[1])
                if not m:
                    break
                lat = (int(m[2]) + int(m[3]) / 60) * (-1 if m[1] == "-" else 1)
                lon = (int(m[6]) + int(m[7]) / 60) * (-1 if m[5] == "-" else 1)
                return round(lon, 1), round(max(-30.0, min(30.0, lat)), 1)
    return 0.0, 20.0


def load() -> Settings:
    wanted = os.environ.get("GAIA_QUALITY", "auto").strip().lower()
    if wanted in QUALITY:
        quality, source = wanted, "set"
    else:
        quality, source = detect_quality(), "auto"
    return Settings(
        data=Path(os.environ.get("GAIA_DATA", "/data")),
        quality=quality,
        quality_source=source,
        stream=quality != "lite"
        and os.environ.get("GAIA_STREAM", "1") not in ("0", "false", "no", "off"),
        port=int(os.environ.get("GAIA_PORT", "8040")),
        tiles=Path(os.environ.get("GAIA_TILES", "/app/tiles")),
        home=home(),
    )
