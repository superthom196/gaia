"""Turning world grids into images the globe can drape.

The globe takes still images in Web Mercator (the square from 85.05°S to
85.05°N), so grids that arrive in plain latitude/longitude are resampled
here before they are written as PNGs.
"""

import io
import math

import numpy as np
from PIL import Image

MERCATOR_LAT = 85.0511287798


def mercator_rows(size: int) -> np.ndarray:
    """Latitude (degrees) at the centre of each row of a Mercator square."""
    y = 1 - (np.arange(size) + 0.5) / size * 2  # +1 at the top, -1 at the bottom
    return np.degrees(np.arctan(np.sinh(math.pi * y)))


def to_mercator(grid: np.ndarray, size: int, lat_top: float = 90, lat_bottom: float = -90):
    """Resample an equirectangular grid (rows from lat_top down, columns from
    180°W eastwards) onto a size×size Mercator square, nearest neighbour."""
    rows = grid.shape[0]
    lats = mercator_rows(size)
    idx = np.clip(((lat_top - lats) / (lat_top - lat_bottom) * rows).astype(int), 0, rows - 1)
    cols = np.clip((np.arange(size) + 0.5) / size * grid.shape[1], 0, grid.shape[1] - 1)
    return grid[idx][:, cols.astype(int)]


def png(array: np.ndarray) -> bytes:
    """uint8 array (H, W), (H, W, 3) or (H, W, 4) to PNG bytes."""
    mode = "L" if array.ndim == 2 else {3: "RGB", 4: "RGBA"}[array.shape[2]]
    buf = io.BytesIO()
    Image.fromarray(array.astype(np.uint8), mode).save(buf, "PNG", optimize=True)
    return buf.getvalue()


def ramp(values: np.ndarray, stops: list[tuple[float, tuple[int, int, int, int]]]) -> np.ndarray:
    """Colour a grid by linear interpolation between (value, RGBA) stops."""
    xs = [s[0] for s in stops]
    out = np.empty((*values.shape, 4), np.float32)
    for c in range(4):
        out[..., c] = np.interp(values, xs, [s[1][c] for s in stops])
    return out.astype(np.uint8)
