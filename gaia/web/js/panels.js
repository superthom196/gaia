// The layers panel, the latest-events list, the sea-ice chart and the feed
// status in the footer.

import { KINDS, SEVERITY, glyph } from "./kinds.js";
import { describe } from "./events.js";
import { ago, date, escape, num } from "./format.js";

const $ = (id) => document.getElementById(id);

/** One layer switch: a button with aria-pressed, a glyph, a name, a count. */
function layerButton(def, on) {
  const b = document.createElement("button");
  b.className = "layer";
  b.dataset.layer = def.id;
  b.setAttribute("aria-pressed", String(on));
  const icon = def.kind ? glyph(def.kind) : `<span class="swatch" style="background:${def.swatch}"></span>`;
  b.innerHTML = `${icon}<span class="name">${escape(def.label)}</span><span class="count"></span><span class="switch" aria-hidden="true"></span>`;
  return b;
}

export function renderLayers(groups, state, onToggle) {
  for (const [containerId, defs] of Object.entries(groups)) {
    const box = $(containerId);
    box.replaceChildren(...defs.map((d) => layerButton(d, state.on(d.id))));
  }
  document.getElementById("layers-body").addEventListener("click", (e) => {
    const b = e.target.closest(".layer");
    if (!b) return;
    const on = b.getAttribute("aria-pressed") !== "true";
    b.setAttribute("aria-pressed", String(on));
    onToggle(b.dataset.layer, on);
  });
  const toggle = $("layers-toggle");
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Collapse layers" : "Expand layers");
    $("layers-body").hidden = !open;
  });
}

export function setLayerCount(id, text) {
  const el = document.querySelector(`.layer[data-layer="${id}"] .count`);
  if (el) el.textContent = text ?? "";
}

export function renderLatest(features, selectedId, onPick) {
  const list = $("latest-list");
  const now = Date.now();
  list.replaceChildren(...features.slice(0, 60).map((f) => {
    const p = f.properties;
    const { title, sub } = describe(p);
    const li = document.createElement("li");
    const sev = p.severity && p.severity !== "green"
      ? `<span class="sev" style="background:${SEVERITY[p.severity]}" title="${p.severity} alert"></span>` : "";
    li.innerHTML = `<button data-id="${escape(p.id)}" ${p.id === selectedId ? 'aria-current="true"' : ""}>
      ${glyph(p.kind, 20, p.kind === "volcano" && p.severity ? SEVERITY[p.severity] : KINDS[p.kind].color)}
      <span><span class="title">${sev}${escape(title)}</span><span class="sub">${escape(sub)}</span></span>
      <span class="ago">${ago(p.updated, now)}</span></button>`;
    return li;
  }));
  $("latest-count").textContent = `${features.length} shown`;
  list.onclick = (e) => {
    const b = e.target.closest("button[data-id]");
    if (b) onPick(b.dataset.id);
  };
}

export function renderIce(data, hemi) {
  const d = data?.[hemi];
  if (!d) return;
  $("ice-value").textContent = d.extent.toFixed(2);
  $("ice-date").textContent = `million km² · ${date(d.date)}`;
  const diff = $("ice-diff");
  diff.textContent = `${d.difference >= 0 ? "+" : "−"}${Math.abs(d.difference).toFixed(2)} vs normal`;
  diff.style.color = d.difference < 0 ? "#f0a58a" : "#9fd3c7";

  const W = 300, H = 80;
  const rows = d.chart;
  const values = rows.flatMap((r) => [r[1], r[3], r[4]]).filter((v) => v != null);
  const lo = Math.min(...values) * 0.97, hi = Math.max(...values) * 1.02;
  const x = (i) => (i / (rows.length - 1)) * W;
  const y = (v) => H - ((v - lo) / (hi - lo)) * H;
  const path = (pts) => pts.map(([a, b], i) => `${i ? "L" : "M"}${a.toFixed(1)},${b.toFixed(1)}`).join("");
  const band = path(rows.map((r, i) => [x(i), y(r[4])])) + rows.map((r, i) => [x(i), y(r[3])]).reverse().map(([a, b]) => `L${a.toFixed(1)},${b.toFixed(1)}`).join("") + "Z";
  const median = path(rows.map((r, i) => [x(i), y(r[2])]));
  const line = path(rows.map((r, i) => [i, r[1]]).filter(([, v]) => v != null).map(([i, v]) => [x(i), y(v)]));
  // A tick at the first of each month.
  const ticks = rows.map((r, i) => [r[0], i]).filter(([day]) => day.endsWith("-01"))
    .map(([day, i]) => `<line class="grid" x1="${x(i)}" x2="${x(i)}" y1="0" y2="${H}"/><text x="${x(i) + 3}" y="9">${escape(new Date(day).toLocaleString(undefined, { month: "short" }))}</text>`).join("");
  const svg = $("ice-chart");
  svg.innerHTML = `${ticks}<path class="band" d="${band}"/><path class="median" d="${median}"/><path class="line" d="${line}"/>`;
  svg.setAttribute("aria-label", `${hemi === "north" ? "Arctic" : "Antarctic"} sea ice extent over the past ${rows.length} days against the 1981–2010 range`);
}

export function renderStatus(status) {
  const feeds = status.feeds || [];
  const late = feeds.filter((f) => !f.ok);
  const text = $("status-text"), dot = document.querySelector("#status .dot"), live = $("live-dot");
  if (!late.length) {
    text.textContent = `${feeds.length} feeds OK`;
    dot.className = live.className = "dot";
  } else {
    text.textContent = `${late.length} of ${feeds.length} feeds late`;
    dot.className = live.className = `dot ${late.length > feeds.length / 2 ? "bad" : "warn"}`;
  }
  const rows = feeds.map((f) => `<tr><td><span class="dot ${f.ok ? "" : "warn"}"></span> ${escape(f.source)}</td>
    <td title="${escape(f.error || "")}">${f.age == null ? "never" : `${ago(new Date(Date.now() - f.age * 1000).toISOString())} ago`}</td></tr>`).join("");
  $("status-list").innerHTML = `<table>${rows}</table><p class="meta">Quality ${escape(status.quality)} · Gaia ${escape(status.version)}</p>`;
}

export function wireStatus() {
  const btn = $("status"), list = $("status-list");
  btn.addEventListener("click", () => {
    const open = btn.getAttribute("aria-expanded") !== "true";
    btn.setAttribute("aria-expanded", String(open));
    list.hidden = !open;
  });
}

export { num };
