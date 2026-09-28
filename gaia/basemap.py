"""The base map: Natural Earth II cut into Web Mercator tiles.

Natural Earth II (public domain, naturalearthdata.com) is a light, atlas-like
world: green and brown land with shaded relief, and pale blue water. Its
source is one equirectangular image; the image build cuts it into 256 px JPEG
tiles, `<out>/<z>/<x>/<y>.jpg` for zoom 0 to MAX_ZOOM, which the page loads
from /tiles. Beyond MAX_ZOOM the globe stretches the last level.

    python -m gaia.basemap NE2_LR_LC_SR_W_DR.tif tiles/
"""

import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

TILE = 256
MAX_ZOOM = 6  # 16384 px round the equator, about the source's 10800


def mercator_rows(size: int, src_height: int) -> np.ndarray:
    """The equirectangular source row for each row of a Mercator square."""
    y = (np.arange(size) + 0.5) / size
    lat = np.degrees(np.arctan(np.sinh(math.pi * (1 - 2 * y))))
    return np.clip(((90 - lat) / 180 * src_height).astype(int), 0, src_height - 1)


def cut(src: Path, out: Path, max_zoom: int = MAX_ZOOM) -> int:
    Image.MAX_IMAGE_PIXELS = None  # the source is 58 megapixels, on purpose
    world = Image.open(src).convert("RGB")
    count = 0
    for z in range(max_zoom + 1):
        size = TILE << z
        # Resample to this zoom's width first, so low zooms average the
        # source instead of skipping rows.
        level = np.asarray(world.resize((size, size // 2), Image.LANCZOS))
        mercator = level[mercator_rows(size, size // 2)]
        for x in range(1 << z):
            column = out / str(z) / str(x)
            column.mkdir(parents=True, exist_ok=True)
            for y in range(1 << z):
                tile = mercator[y * TILE : (y + 1) * TILE, x * TILE : (x + 1) * TILE]
                Image.fromarray(tile).save(column / f"{y}.jpg", quality=85, optimize=True)
                count += 1
    return count


if __name__ == "__main__":
    print(cut(Path(sys.argv[1]), Path(sys.argv[2])), "tiles")
