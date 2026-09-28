// The event card. In a browser it floats beside its marker and follows it as
// the globe turns; on the TV it sits on the right, large enough for the sofa.

import { KINDS, SEVERITY } from "./kinds.js";
import { describe, region } from "./events.js";
import { ago, coords, dateTime, escape, kt2kmh, num } from "./format.js";

let volcanoes = null;
async function volcanoReport(id) {
  if (!volcanoes) volcanoes = fetch("/api/volcanoes").then((r) => r.json()).catch(() => []);
  const key = id.replace(/^volcano:/, "");
  return (await volcanoes).find((v) => (v.vnum || v.name) === key);
}

function stat(label, value) {
  return `<div><dt>${escape(label)}</dt><dd>${value}</dd></div>`;
}

function spark(track) {
  const kts = track.map((t) => t[3]).filter((v) => v != null);
  if (kts.length < 2) return "";
  const max = Math.max(...kts), n = kts.length, w = 300 / n;
  const bars = kts.map((k, i) => `<rect x="${(i * w + 1).toFixed(1)}" y="${(40 - (k / max) * 38).toFixed(1)}" width="${(w - 2).toFixed(1)}" height="${((k / max) * 38).toFixed(1)}" rx="1" opacity="${i === n - 1 ? 1 : 0.45}"/>`).join("");
  return `<svg class="spark" viewBox="0 0 300 40" preserveAspectRatio="none" role="img" aria-label="Wind speed every six hours, from ${kts[0]} to ${kts[n - 1]} knots">${bars}</svg>
    <div class="meta" style="display:flex;justify-content:space-between"><span>${escape(dateTime(track[0][2]))} · ${kts[0]} kt</span><span>now · ${kts[n - 1]} kt</span></div>`;
}

async function body(p, coordinates) {
  const colour = p.kind === "volcano" && p.severity ? SEVERITY[p.severity] : KINDS[p.kind].color;
  const { title, sub } = describe(p);
  let heading = title, place = sub, stats = "", extra = "", chips = "";

  // Green is "nothing unusual": only the higher alert levels earn a chip.
  if (p.severity && p.severity !== "green" && p.kind !== "volcano") chips += `<span class="chip ${p.severity}">${escape(p.severity)} alert</span>`;
  switch (p.kind) {
    case "quake":
      heading = `M${p.magnitude.toFixed(1)} earthquake`;
      place = p.place;
      stats = stat("Magnitude", `${p.magnitude.toFixed(1)} <span class="meta">${escape(p.unit || "")}</span>`)
        + stat("Depth", p.depth_km != null ? `${num(p.depth_km)} km` : "–")
        + stat("Time", escape(dateTime(p.started)));
      if (p.count > 1) extra = `<p class="report">One of ${p.count} quakes within 120 km of each other since ${escape(dateTime(p.first))}. The largest is shown.</p>`;
      if (p.felt) chips += `<span class="chip">Felt by ${num(p.felt)}</span>`;
      break;
    case "storm":
      stats = stat("Wind", p.magnitude ? `${num(p.magnitude)} kt` : "–")
        + stat("km/h", p.magnitude ? num(kt2kmh(p.magnitude)) : "–")
        + stat("Class", escape(p.category || "–"));
      if (p.track) extra = spark(p.track);
      place = `Position at ${escape(dateTime(p.updated))}`;
      break;
    case "volcano": {
      const v = await volcanoReport(p.id);
      place = p.place;
      const a = v?.alert;
      if (a?.alert_level) chips += `<span class="chip ${SEVERITYNAME(a.alert_level)}">Alert level ${escape(cap(a.alert_level))}</span>`;
      if (a?.color_code) chips += `<span class="chip">Aviation code ${escape(cap(a.color_code))}</span>`;
      if (v?.report) {
        extra = `<div class="report-label">Weekly report · ${escape(v.report.period)} · ${escape(v.report.status)}</div>
          <div class="report">${escape(v.report.text).replace(/\n\n/g, "<br><br>")}</div>`;
      }
      break;
    }
    case "fire":
      stats = stat("Area", p.magnitude ? `${num(p.magnitude)} ${escape(p.unit)}` : "–")
        + stat("Since", escape(dateTime(p.started)))
        + stat("Updated", escape(ago(p.updated)) + " ago");
      break;
    case "ice":
      stats = stat("Area", p.magnitude ? `${num(p.magnitude)} ${escape(p.unit)}` : "–")
        + stat("Tracked since", escape(dateTime(p.started)))
        + stat("Position", escape(dateTime(p.updated)));
      break;
    default:
      stats = stat("Since", escape(dateTime(p.started))) + stat("Updated", escape(dateTime(p.updated)));
  }

  const also = (p.also || []).map((a) => a.link ? ` · <a href="${escape(a.link)}" target="_blank" rel="noopener">${escape(a.source)}</a>` : "").join("");
  return `
    <div class="card-kicker"><span style="color:${colour}">${escape(KINDS[p.kind].label.replace(/s$/, ""))}${p.kind === "volcano" && p.status ? ` · ${escape(p.status.toLowerCase())}` : ""}</span>
      <button class="icon-btn" data-close aria-label="Close"><svg width="12" height="12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8"/></svg></button></div>
    <h3>${escape(heading)}</h3>
    <div class="place">${escape(place || region(p.place) || "")}</div>
    <div class="coords">${coords(coordinates)}</div>
    ${chips ? `<div class="chips">${chips}</div>` : ""}
    ${stats ? `<dl>${stats}</dl>` : ""}
    ${extra}
    <div class="source"><span>${escape(p.source)}${also}</span>${p.link ? `<a href="${escape(p.link)}" target="_blank" rel="noopener">Source</a>` : ""}</div>`;
}

const cap = (s) => s.charAt(0) + s.slice(1).toLowerCase();
const SEVERITYNAME = (level) => ({ WARNING: "red", WATCH: "orange", ADVISORY: "yellow", NORMAL: "green" })[level] || "";

export function createCard(globe, { tv = false } = {}) {
  const el = document.getElementById("card");
  let current = null;
  let token = 0;

  function place() {
    if (!current || tv) return;
    const pt = globe.screen(current.geometry.coordinates);
    if (!pt) { el.style.visibility = "hidden"; return; }
    el.style.visibility = "visible";
    const w = el.offsetWidth, h = el.offsetHeight, margin = 16;
    const right = window.innerWidth - 360, bottom = window.innerHeight - 56;
    let x = Math.min(Math.max(pt.x - 28, 280), right - w - margin);
    let y = pt.y + 28, cls = "below";
    if (y + h > bottom) { y = pt.y - 28 - h; cls = "above"; }
    y = Math.max(margin, y);
    el.className = `card ${cls}`;
    el.style.setProperty("--leader-x", `${Math.min(w - 12, Math.max(12, pt.x - x))}px`);
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  globe.map.on("move", place);
  window.addEventListener("resize", place);
  el.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) card.close(); });

  const card = {
    onClose: null,
    get current() { return current; },
    async open(feature) {
      const mine = ++token;
      current = feature;
      const html = await body(feature.properties, feature.geometry.coordinates);
      if (mine !== token) return;
      el.innerHTML = html;
      el.hidden = false;
      if (tv) {
        el.className = "card";
        el.style.transform = `translate(${window.innerWidth - el.offsetWidth - 64}px, 140px)`;
      }
      place();
    },
    close() {
      token++;
      current = null;
      el.hidden = true;
      card.onClose?.();
    },
  };
  return card;
}
