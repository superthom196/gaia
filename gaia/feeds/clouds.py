"""Near-live clouds, day and night, from geostationary infrared.

NASA GIBS serves the clean infrared band (13) of GOES-East, GOES-West and
Himawari-9 every 10 minutes, coloured with an enhancement table: grey for
warm surfaces and low cloud, colours for cold cloud tops. Gaia turns that
back into cloud cover (white, with alpha), blends the three satellites where
they overlap, and writes one Web Mercator PNG. Europe, Africa and the Indian
Ocean (Meteosat) aren't in GIBS, so they stay clear.
"""

import io
from datetime import UTC, datetime

import httpx
import numpy as np
from PIL import Image

from gaia import textures
from gaia.feeds import iso
from gaia.store import Store

WMS = (
    "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap"
    "&VERSION=1.3.0&LAYERS={layer}&CRS=EPSG:4326&BBOX=-90,-180,90,180"
    "&WIDTH={w}&HEIGHT={h}&FORMAT=image/png&TRANSPARENT=true"
)
SATELLITES = [  # layer, sub-satellite longitude
    ("GOES-East_ABI_Band13_Clean_Infrared", -75.2),
    ("GOES-West_ABI_Band13_Clean_Infrared", -137.2),
    ("Himawari_AHI_Band13_Clean_Infrared", 140.7),
]
WIDTH, HEIGHT = 2048, 1024
SIZE = 2048  # output Mercator square


def cover(rgba: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Cloud cover 0..1 and data mask 0..1 from one enhanced-IR image."""
    r, g, b = (rgba[..., i].astype(np.float32) for i in range(3))
    alpha = rgba[..., 3].astype(np.float32) / 255
    grey = (np.abs(r - g) < 8) & (np.abs(g - b) < 8)
    # On the grey part of the table, lighter is colder: clear ocean sits near
    # 90-110, mid cloud near 200. Everything coloured is colder still.
    t = np.clip((r - 112) / (200 - 112), 0, 1)
    t = t * t * (3 - 2 * t)
    return np.where(grey, t * 0.92, 0.97) * alpha, alpha


def composite(images: list[tuple[np.ndarray, float]]) -> np.ndarray:
    lon = np.radians((np.arange(WIDTH) + 0.5) / WIDTH * 360 - 180)[None, :]
    lat = np.radians(90 - (np.arange(HEIGHT) + 0.5) / HEIGHT * 180)[:, None]
    num = np.zeros((HEIGHT, WIDTH), np.float32)
    den = np.zeros((HEIGHT, WIDTH), np.float32)
    for rgba, sub_lon in images:
        c, mask = cover(rgba)
        # Feather each disc towards its edge, where the satellite looks at
        # the Earth side-on and the picture smears, so the seams don't show.
        cos_d = np.cos(lat) * np.cos(lon - np.radians(sub_lon))
        dist = np.degrees(np.arccos(np.clip(cos_d, -1, 1)))
        w = np.clip((72 - dist) / 14, 0, 1) * mask
        # GIBS cuts the discs off square near the poles; fade out before that.
        w *= np.clip((78 - np.abs(np.degrees(lat))) / 12, 0, 1)
        num += c / np.maximum(mask, 1e-6) * w
        den += w
    return np.where(den > 0, num / np.maximum(den, 1e-6), 0)


async def fetch_image(client: httpx.AsyncClient, layer: str) -> np.ndarray:
    r = await client.get(WMS.format(layer=layer, w=WIDTH, h=HEIGHT))
    r.raise_for_status()
    if not r.headers.get("content-type", "").startswith("image/"):
        raise ValueError(f"{layer}: not an image")
    return np.asarray(Image.open(io.BytesIO(r.content)).convert("RGBA"))


async def run(client: httpx.AsyncClient, store: Store) -> None:
    images = []
    for layer, sub_lon in SATELLITES:
        images.append((await fetch_image(client, layer), sub_lon))
    amount = textures.to_mercator(composite(images), SIZE)
    rgba = np.empty((SIZE, SIZE, 4), np.uint8)
    rgba[..., :3] = 255
    rgba[..., 3] = (amount * 255).astype(np.uint8)
    store.write_bytes("clouds.png", textures.png(rgba))
    store.write_json(
        "clouds.json", {"fetched": iso(datetime.now(UTC)), "satellites": [s[0] for s in SATELLITES]}
    )
