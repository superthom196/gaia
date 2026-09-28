"""Volcano activity: the Smithsonian's weekly report and USGS alert levels.

The Global Volcanism Program's weekly report (published on Wednesdays)
names every volcano with notable activity that week, with a paragraph of
text. USGS HANS gives the current alert level and aviation colour code for
US volcanoes that are above normal. The two are joined on the Smithsonian
volcano number, which both use.
"""

import html
import re
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime

import httpx

from gaia.feeds import iso
from gaia.store import Store

GVP_URL = "https://volcano.si.edu/news/WeeklyVolcanoRSS.xml"
HANS_URL = "https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes"
HANS_VOLCANO = "https://volcanoes.usgs.gov/hans-public/api/volcano/getVolcano/{vnum}"
GVP_SNAPSHOT = "gvp.json"
HANS_SNAPSHOT = "hans.json"
HANS_PLACES = "hans_places.json"  # vnum -> [lon, lat, region]; volcanoes don't move

GEORSS = "{http://www.georss.org/georss}point"
TITLE = re.compile(
    r"^(?P<name>.+?) \((?P<country>[^)]+)\) - Report for (?P<period>.+?) - (?P<status>.+)$"
)


def clean_text(raw: str) -> str:
    """The report's description is HTML-in-XML; keep plain paragraphs."""
    text = html.unescape(raw or "")
    text = re.sub(r"<br\s*/?>|</p>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    paras = [re.sub(r"\s+", " ", p).strip() for p in text.split("\n")]
    return "\n\n".join(p for p in paras if p)


def parse_gvp(xml: bytes) -> list[dict]:
    root = ET.fromstring(xml)
    out = []
    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()
        m = TITLE.match(title)
        point = (item.findtext(GEORSS) or "").split()
        if not m or len(point) != 2:
            continue
        # The volcano number sits in the item's anchor (#vn_332010), which
        # is on <guid> in some items and on <link> in others.
        anchors = [(item.findtext(tag) or "").strip() for tag in ("guid", "link")]
        link = next((a for a in anchors if "#vn_" in a), anchors[1])
        vnum = link.rsplit("#vn_", 1)[1] if "#vn_" in link else None
        text = clean_text(item.findtext("description") or "")
        source = None
        if "\n\nSource:" in f"\n\n{text}":
            text, source = text.rsplit("Source:", 1)
            text, source = text.strip(), source.strip()
        pub = item.findtext("pubDate")
        out.append(
            {
                "vnum": vnum,
                "name": m["name"],
                "country": m["country"],
                "period": m["period"],
                "status": m["status"],
                "lon": float(point[1]),
                "lat": float(point[0]),
                "text": text,
                "report_source": source,
                "link": link,
                "published": iso(parsedate_to_datetime(pub)) if pub else None,
            }
        )
    return out


async def run_gvp(client: httpx.AsyncClient, store: Store) -> None:
    r = await client.get(GVP_URL)
    r.raise_for_status()
    reports = parse_gvp(r.content)
    if not reports:
        raise ValueError("weekly report has no volcanoes")
    store.write_json(GVP_SNAPSHOT, reports)


async def run_hans(client: httpx.AsyncClient, store: Store) -> None:
    r = await client.get(HANS_URL)
    r.raise_for_status()
    places = store.read_json(HANS_PLACES, {}) or {}
    out = []
    for v in r.json():
        vnum = v["vnum"]
        if vnum not in places:
            rv = await client.get(HANS_VOLCANO.format(vnum=vnum))
            rv.raise_for_status()
            info = rv.json()
            places[vnum] = [info["longitude"], info["latitude"], info.get("region")]
        lon, lat, region = places[vnum]
        out.append(
            {
                "vnum": vnum,
                "name": v["volcano_name"],
                "lon": lon,
                "lat": lat,
                "region": region,
                "alert_level": v.get("alert_level"),
                "color_code": v.get("color_code"),
                "observatory": v.get("obs_fullname"),
                "notice": v.get("notice_url"),
                "sent": v.get("sent_utc", "").replace(" ", "T") + "Z"
                if v.get("sent_utc")
                else None,
            }
        )
    store.write_json(HANS_PLACES, places)
    store.write_json(HANS_SNAPSHOT, out)
