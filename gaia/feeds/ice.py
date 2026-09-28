"""Sea-ice extent from the NSIDC Sea Ice Index (v4), against 1981–2010.

For each hemisphere: the latest daily extent, the normal for that day of the
year (the 1981–2010 median, with the 10th and 90th percentiles), and the past
120 days of both for the page's small chart.
"""

import csv
import io
from datetime import date, timedelta

import httpx

from gaia.store import Store

BASE = "https://noaadata.apps.nsidc.org/NOAA/G02135/{hemi}/daily/data/"
DAILY = "{h}_seaice_extent_daily_v4.0.csv"
CLIMATE = "{h}_seaice_extent_climatology_1981-2010_v4.0.csv"
SNAPSHOT = "ice.json"
DAYS = 120


def _rows(text: str) -> list[list[str]]:
    rows = []
    for row in csv.reader(io.StringIO(text)):
        cells = [c.strip() for c in row]
        if cells and cells[0].isdigit():
            rows.append(cells)
    return rows


def summarise(daily_csv: str, climate_csv: str) -> dict:
    series = {}
    for y, m, d, extent, *_ in _rows(daily_csv):
        series[date(int(y), int(m), int(d))] = float(extent)
    # DOY, average, std, 10th, 25th, 50th, 75th, 90th
    normal = {int(r[0]): (float(r[5]), float(r[3]), float(r[7])) for r in _rows(climate_csv)}
    latest = max(series)

    def norm(day: date) -> tuple[float, float, float]:
        return normal[min(day.timetuple().tm_yday, max(normal))]

    median, p10, p90 = norm(latest)
    start = latest - timedelta(days=DAYS)
    chart = []
    day = start
    while day <= latest:
        n = norm(day)
        chart.append([day.isoformat(), series.get(day), n[0], n[1], n[2]])
        day += timedelta(days=1)
    return {
        "date": latest.isoformat(),
        "extent": series[latest],
        "normal": median,
        "p10": p10,
        "p90": p90,
        "difference": round(series[latest] - median, 3),
        "unit": "million km²",
        # [date, extent (null when missing), median, p10, p90]
        "chart": chart,
    }


async def run(client: httpx.AsyncClient, store: Store) -> None:
    out = {}
    for hemi, h in (("north", "N"), ("south", "S")):
        base = BASE.format(hemi=hemi)
        daily = await client.get(base + DAILY.format(h=h))
        daily.raise_for_status()
        climate = await client.get(base + CLIMATE.format(h=h))
        climate.raise_for_status()
        out[hemi] = summarise(daily.text, climate.text)
    store.write_json(SNAPSHOT, out)
