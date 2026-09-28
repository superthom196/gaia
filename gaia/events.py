"""One list of current events from every feed, with duplicates removed.

USGS, EONET and the volcano feeds are the primary sources. GDACS reports
many of the same events; a GDACS event that matches one of them (same kind,
close enough) only lends it its alert level and a link. One that matches
nothing is kept as an event of its own, apart from quakes, which USGS
already covers.
"""

from gaia.feeds import event, km_between
from gaia.store import Store

# How far apart two reports of the same event can be. Storm positions are
# taken at different times by different agencies, so they get more room.
MATCH_KM = {"storm": 600, "flood": 500, "drought": 1500, "fire": 150, "volcano": 50, "quake": 50}

HANS_SEVERITY = {"WARNING": "red", "WATCH": "orange", "ADVISORY": "yellow", "NORMAL": "green"}


def volcanoes(gvp: list[dict], hans: list[dict]) -> list[dict]:
    """The weekly report's volcanoes plus any US volcano HANS has raised."""
    by_vnum: dict[str, dict] = {}
    for r in gvp:
        key = r["vnum"] or r["name"]
        by_vnum[key] = {
            "vnum": r["vnum"],
            "name": r["name"],
            "country": r["country"],
            "lon": r["lon"],
            "lat": r["lat"],
            "report": r,
        }
    for h in hans:
        v = by_vnum.setdefault(
            h["vnum"],
            {
                "vnum": h["vnum"],
                "name": h["name"],
                "country": "United States",
                "lon": h["lon"],
                "lat": h["lat"],
                "report": None,
            },
        )
        v["alert"] = h
    return sorted(by_vnum.values(), key=lambda v: v["name"])


def volcano_events(vols: list[dict]) -> list[dict]:
    out = []
    for v in vols:
        report, alert = v.get("report"), v.get("alert")
        out.append(
            event(
                f"volcano:{v['vnum'] or v['name']}",
                "volcano",
                v["name"],
                v["lon"],
                v["lat"],
                source=" · ".join(
                    filter(
                        None,
                        [
                            "Smithsonian GVP" if report else None,
                            f"USGS {alert['observatory']}"
                            if alert and alert.get("observatory")
                            else None,
                        ],
                    )
                ),
                place=v["country"],
                severity=HANS_SEVERITY.get((alert or {}).get("alert_level")),
                started=(report or {}).get("published") or (alert or {}).get("sent"),
                updated=(alert or {}).get("sent") or (report or {}).get("published"),
                link=(report or {}).get("link") or (alert or {}).get("notice"),
                status=(report or {}).get("status"),
                alert_level=(alert or {}).get("alert_level"),
                color_code=(alert or {}).get("color_code"),
            )
        )
    return out


def merge(primary: list[dict], gdacs: list[dict]) -> list[dict]:
    rank = {None: 0, "green": 1, "yellow": 2, "orange": 3, "red": 4}
    kept = []
    for g in gdacs:
        gp = g["properties"]
        near = [
            (km_between(p["geometry"]["coordinates"], g["geometry"]["coordinates"]), p)
            for p in primary
            if p["properties"]["kind"] == gp["kind"]
        ]
        near = [n for n in near if n[0] <= MATCH_KM[gp["kind"]]]
        if near:
            match = min(near, key=lambda n: n[0])[1]["properties"]
            if rank[gp["severity"]] > rank[match["severity"]]:
                match["severity"] = gp["severity"]
            match.setdefault("also", []).append({"source": "GDACS", "link": gp["link"]})
        elif gp["kind"] != "quake":
            kept.append(g)
    return primary + kept


def collect(store: Store) -> dict:
    vols = volcanoes(store.read_json("gvp.json", []) or [], store.read_json("hans.json", []) or [])
    primary = [
        *(store.read_json("quakes.json", []) or []),
        *(store.read_json("eonet.json", []) or []),
        *volcano_events(vols),
    ]
    # Work on copies: the snapshots are cached and shared between requests.
    primary = [{**f, "properties": dict(f["properties"])} for f in primary]
    features = merge(primary, store.read_json("gdacs.json", []) or [])
    features.sort(key=lambda f: f["properties"]["updated"] or "", reverse=True)
    return {"type": "FeatureCollection", "features": features}
