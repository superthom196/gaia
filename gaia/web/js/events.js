// What's shown: the layers switched on, quakes filtered by magnitude and age,
// and quake swarms grouped into one marker ("6 quakes near Tadine").

import { SEVERITY_RANK } from "./kinds.js";
import { kt2kmh, num } from "./format.js";

const SWARM_KM = 120;

export function km(a, b) {
  const r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The last part of a USGS place ("231 km WSW of Port McNeill, Canada" -> "Canada"). */
export function region(place) {
  if (!place) return "";
  const parts = place.split(",");
  return parts[parts.length - 1].trim().replace(/ region$/, "");
}

function swarms(quakes) {
  const byMag = [...quakes].sort((a, b) => b.properties.magnitude - a.properties.magnitude);
  const taken = new Set();
  const leaders = [];
  for (const q of byMag) {
    if (taken.has(q)) continue;
    const members = byMag.filter((o) => !taken.has(o) && km(q.geometry.coordinates, o.geometry.coordinates) <= SWARM_KM);
    members.forEach((m) => taken.add(m));
    const times = members.map((m) => m.properties.started).sort();
    leaders.push({
      ...q,
      properties: {
        ...q.properties,
        count: members.length,
        members: members.map((m) => m.properties.id),
        first: times[0],
        // The swarm is as recent as its latest quake.
        updated: times[times.length - 1],
      },
    });
  }
  return leaders;
}

export function visible(all, state, now = Date.now()) {
  const quakes = [], rest = [];
  for (const f of all) {
    const p = f.properties;
    if (!state.layers[p.kind]) continue;
    if (p.kind === "quake") {
      if (p.magnitude < state.quakeMag) continue;
      if (now - new Date(p.started) > state.quakeHours * 3600e3) continue;
      quakes.push(f);
    } else {
      rest.push(f);
    }
  }
  const out = [...swarms(quakes), ...rest].map((f) => ({
    ...f,
    properties: {
      ...f.properties,
      rank: SEVERITY_RANK[f.properties.severity] || 0,
      hours: (now - new Date(f.properties.updated || f.properties.started)) / 3600e3,
    },
  }));
  out.sort((a, b) => (b.properties.updated || "").localeCompare(a.properties.updated || ""));
  return out;
}

/** Title and one-line summary for lists and the TV. */
export function describe(p) {
  switch (p.kind) {
    case "quake": {
      const where = region(p.place) || p.place;
      if (p.count > 1) return { title: `M${p.magnitude.toFixed(1)} · ${where}`, sub: `${p.count} quakes · largest ${p.place}` };
      return { title: `M${p.magnitude.toFixed(1)} · ${where}`, sub: `${p.place}${p.depth_km != null ? ` · ${num(p.depth_km)} km deep` : ""}` };
    }
    case "storm":
      return {
        title: p.title,
        sub: p.magnitude ? `${p.category} · ${num(p.magnitude)} kt (${kt2kmh(p.magnitude)} km/h)` : p.source,
      };
    case "volcano":
      return {
        title: p.title,
        sub: [p.place, p.alert_level ? `alert ${p.alert_level.toLowerCase()}` : p.status?.toLowerCase()].filter(Boolean).join(" · "),
      };
    case "fire":
      return { title: p.title.replace(/^Wildfire /, ""), sub: p.magnitude ? `Wildfire · ${num(p.magnitude)} ${p.unit}` : "Wildfire" };
    case "ice":
      return { title: p.title, sub: p.magnitude ? `${num(p.magnitude)} ${p.unit}` : "Iceberg" };
    default:
      return { title: p.title, sub: [p.place, p.severity && `${p.severity} alert`].filter(Boolean).join(" · ") };
  }
}
