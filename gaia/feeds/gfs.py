"""Wind, temperature and rain from NOAA's GFS model (1° grid).

The NOMADS filter cuts the four fields Gaia needs out of the newest run,
three hours ahead (so the rain rate is a real forecast value, not zero):
10 m wind (UGRD, VGRD), 2 m temperature (TMP) and precipitation rate (PRATE).
Runs come out every 6 hours, about 4 hours late.

Written for the page:
- `wind.png` + `wind.json`: plain latitude/longitude, u in red and v in
  green, scaled to the range in the JSON. The wind particles read it
  (after mapbox/webgl-wind, ISC licence).
- `temp.png`, `rain.png`: ready-coloured Web Mercator overlays.
"""

import tempfile
from datetime import UTC, datetime, timedelta

import httpx
import numpy as np

from gaia import textures
from gaia.feeds import iso
from gaia.store import Store

FILTER = (
    "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_1p00.pl"
    "?dir=%2Fgfs.{day}%2F{hour:02d}%2Fatmos&file=gfs.t{hour:02d}z.pgrb2.1p00.f003"
    "&var_UGRD=on&var_VGRD=on&var_TMP=on&var_PRATE=on"
    "&lev_10_m_above_ground=on&lev_2_m_above_ground=on&lev_surface=on"
)
OVERLAY = 1024

TEMP_STOPS = [  # °C
    (-45, (80, 60, 160, 210)),
    (-25, (60, 110, 200, 200)),
    (-5, (120, 190, 230, 180)),
    (5, (225, 230, 225, 150)),
    (15, (240, 205, 120, 170)),
    (25, (235, 140, 70, 190)),
    (35, (205, 60, 50, 210)),
    (45, (140, 20, 40, 220)),
]
RAIN_STOPS = [  # mm/h
    (0.0, (70, 150, 230, 0)),
    (0.1, (70, 150, 230, 0)),
    (0.5, (80, 170, 240, 110)),
    (2, (90, 200, 255, 170)),
    (6, (170, 235, 255, 210)),
    (15, (240, 250, 255, 235)),
]


def recent_runs(now: datetime) -> list[datetime]:
    """The last few 6-hourly runs, newest first."""
    base = now.replace(minute=0, second=0, microsecond=0)
    base -= timedelta(hours=base.hour % 6)
    return [base - timedelta(hours=6 * i) for i in range(5)]


def decode(grib: bytes) -> dict[str, np.ndarray]:
    import eccodes

    fields = {}
    with tempfile.TemporaryFile() as f:
        f.write(grib)
        f.seek(0)
        while (h := eccodes.codes_grib_new_from_file(f)) is not None:
            try:
                name = eccodes.codes_get(h, "shortName")
                ni, nj = eccodes.codes_get(h, "Ni"), eccodes.codes_get(h, "Nj")
                values = eccodes.codes_get_values(h).reshape(nj, ni)
                # GFS starts at 0°E; roll so columns start at 180°W.
                fields[name] = np.roll(values, ni // 2, axis=1)
            finally:
                eccodes.codes_release(h)
    missing = {"10u", "10v", "2t", "prate"} - fields.keys()
    if missing:
        raise ValueError(f"GFS file lacks {sorted(missing)}")
    return fields


def write(fields: dict[str, np.ndarray], run: datetime, store: Store) -> None:
    u, v = fields["10u"], fields["10v"]
    lo = float(np.floor(min(u.min(), v.min())))
    hi = float(np.ceil(max(u.max(), v.max())))
    scale = lambda a: np.round((a - lo) / (hi - lo) * 255)  # noqa: E731
    wind = np.zeros((*u.shape, 3), np.uint8)
    wind[..., 0], wind[..., 1] = scale(u), scale(v)
    meta = {"run": iso(run), "valid": iso(run + timedelta(hours=3)), "source": "NOAA GFS"}
    store.write_bytes("wind.png", textures.png(wind))
    store.write_json(
        "wind.json", {**meta, "min": lo, "max": hi, "width": u.shape[1], "height": u.shape[0]}
    )

    temp_c = textures.to_mercator(fields["2t"] - 273.15, OVERLAY)
    store.write_bytes("temp.png", textures.png(textures.ramp(temp_c, TEMP_STOPS)))
    store.write_json("temp.json", {**meta, "unit": "°C", "stops": TEMP_STOPS})

    rain_mm_h = textures.to_mercator(fields["prate"] * 3600, OVERLAY)
    store.write_bytes("rain.png", textures.png(textures.ramp(rain_mm_h, RAIN_STOPS)))
    store.write_json("rain.json", {**meta, "unit": "mm/h", "stops": RAIN_STOPS})


async def run(client: httpx.AsyncClient, store: Store) -> None:
    have = (store.read_json("wind.json") or {}).get("run")
    for run_time in recent_runs(datetime.now(UTC)):
        if have and iso(run_time) <= have:
            return  # already on the newest run that exists
        r = await client.get(FILTER.format(day=run_time.strftime("%Y%m%d"), hour=run_time.hour))
        if r.status_code == 200 and r.content[:4] == b"GRIB":
            write(decode(r.content), run_time, store)
            return
    raise ValueError("no recent GFS run available")
