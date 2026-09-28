"""Settings from the environment, and the quality level the box can manage."""

import os
from dataclasses import dataclass
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
        "interactive": 1,
    },
    "standard": {
        "width": 1920,
        "height": 1080,
        "fps": 30,
        "wind": True,
        "live_clouds": True,
        "night_lights": True,
        "interactive": 2,
    },
    "high": {
        "width": 1920,
        "height": 1080,
        "fps": 60,
        "wind": True,
        "live_clouds": True,
        "night_lights": True,
        "interactive": 3,
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

    @property
    def tier(self) -> dict:
        return QUALITY[self.quality]


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
    )
