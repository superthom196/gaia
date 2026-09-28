// Gaia's page. The same page serves browsers (?), the TV (?tv=1), the
// screensaver (?tv=1&ambient=1), and the box's renderer (&render=<session>),
// which streams it to a TV.

import { createGlobe } from "./globe.js";
import { createNight } from "./night.js";
import { createWind } from "./wind.js";
import { createCard } from "./card.js";
import { createSpin, setupTv } from "./tv.js";
import { visible } from "./events.js";
import { KINDS } from "./kinds.js";
import { renderIce, renderLatest, renderLayers, renderStatus, setLayerCount, wireStatus } from "./panels.js";
import { time } from "./format.js";

const params = new URLSearchParams(location.search);
const TV = params.has("tv");
const AMBIENT = params.has("ambient");
const RENDER = params.get("render");
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";

const config = await fetch("/api/config").then((r) => r.json()).catch(() => ({ tier: {} }));
// The box's quality level shapes only what it renders for a TV stream.
const tier = RENDER ? config.tier : { wind: true, night_lights: true };

const LAYERS = {
  "event-layers": ["quake", "volcano", "storm", "fire", "flood", "ice", "drought"].map((k) => ({ id: k, kind: k, label: KINDS[k].label })),
  "ice-layers": [
    { id: "seaice", label: "Sea ice", swatch: "linear-gradient(90deg,#1d3b5c,#e8f6ff)" },
    { id: "snow", label: "Snow cover", swatch: "linear-gradient(90deg,#3a4654,#ffffff)" },
  ],
  "weather-layers": [
    { id: "clouds", label: "Clouds", swatch: "linear-gradient(90deg,#26303b,#f4f6ff)" },
    ...(tier.wind ? [{ id: "wind", label: "Wind", swatch: "linear-gradient(90deg,#2a2e33,#e8e6e1)" }] : []),
    { id: "temp", label: "Temperature", swatch: "linear-gradient(90deg,#3c6ec8,#e1e6e1,#cd3c32)" },
    { id: "rain", label: "Rain", swatch: "linear-gradient(90deg,#12324a,#5ab4f0,#f0faff)" },
  ],
  "sky-layers": [
    { id: "night", label: "Day and night", swatch: "linear-gradient(90deg,#e8e6e1 50%,#0d0f11 50%)" },
    { id: "graticule", label: "Grid", swatch: "repeating-linear-gradient(90deg,#555 0 1px,transparent 1px 5px)" },
  ],
};
const DEFAULT_ON = new Set(["quake", "volcano", "storm", "fire", "flood", "clouds", "wind", "graticule"]);

// Browsers remember their layers; the TV and the renderer always start fresh.
const saved = !TV && !RENDER ? JSON.parse(localStorage.getItem("gaia.layers") || "null") : null;
const state = {
  layers: Object.fromEntries(Object.values(LAYERS).flat().map((d) => [d.id, saved ? !!saved[d.id] : DEFAULT_ON.has(d.id)])),
  quakeMag: 4.5,
  quakeHours: 24,
  on(id) { return !!this.layers[id]; },
};
const save = () => { if (!TV && !RENDER) localStorage.setItem("gaia.layers", JSON.stringify(state.layers)); };

// The globe opens over the box's own region (from its timezone).
const globe = createGlobe("map", { center: config.home || [0, 20], zoom: TV ? 2.1 : 2.05, basemap: config.basemap });
const map = globe.map;
const card = createCard(globe, { tv: TV });
const spin = createSpin(globe, { degreesPerSecond: TV ? 2 : 3 });

let all = [], shown = [], selected = null;

function refreshEvents() {
  shown = visible(all, state);
  globe.setEvents(shown);
  if (!TV) renderLatest(shown, selected, select);
  const counts = {};
  for (const f of shown) counts[f.properties.kind] = (counts[f.properties.kind] || 0) + (f.properties.count || 1);
  for (const k of Object.keys(KINDS)) setLayerCount(k, state.layers[k] ? String(counts[k] || 0) : "");
}

function find(id) {
  return shown.find((f) => f.properties.id === id || f.properties.members?.includes(id));
}

function select(id) {
  const feature = id && find(id);
  selected = feature ? feature.properties.id : null;
  document.querySelectorAll("#latest-list button").forEach((b) => b.toggleAttribute("aria-current", b.dataset.id === selected));
  if (!feature) { card.close(); globe.select(null); return; }
  globe.select(feature);
  spin.hold(0);
  if (!globe.screen(feature.geometry.coordinates) || map.getZoom() < 1.4) {
    map.easeTo({ center: feature.geometry.coordinates, duration: 1200 });
  }
  card.open(feature);
}
card.onClose = () => {
  selected = null;
  globe.select(null);
  document.querySelectorAll("#latest-list button[aria-current]").forEach((b) => b.removeAttribute("aria-current"));
  if (!TV) spin.hold();
};
globe.on("select", (id) => (id ? select(id) : card.current && card.close()));

// ---- layers ----
const tiles = {
  seaice: `${GIBS}/AMSRU2_Sea_Ice_Concentration_12km/default/default/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`,
  snow: `${GIBS}/MODIS_Terra_NDSI_Snow_Cover/default/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`,
};
let wind = null, night = null;

async function applyLayer(id, on) {
  if (id in KINDS) { refreshEvents(); return; }
  if (id in tiles) {
    if (on && !map.getSource(id)) {
      map.addSource(id, { type: "raster", tiles: [tiles[id]], tileSize: 256, maxzoom: id === "seaice" ? 6 : 8 });
      map.addLayer({ id, type: "raster", source: id, paint: { "raster-opacity": 0.85, "raster-fade-duration": 0 } }, "night");
    }
    globe.setVisible(id, on);
    return;
  }
  if (id === "wind") {
    if (on && !wind) {
      try { wind = await createWind(map, { particles: TV ? 3500 : 5000, before: "graticule" }); } catch { return; }
    }
    if (wind) wind.enabled = on;
    return;
  }
  if (id === "temp" || id === "rain") {
    if (on) globe.setImage(id, `/api/weather/${id}.png?h=${Math.floor(Date.now() / 3600e3)}`);
    globe.setVisible(id, on);
    return;
  }
  if (id === "night") {
    globe.setVisible("night", on);
    if (night) night.enabled = on;
    return;
  }
  globe.setVisible(id, on);
}

renderLayers(LAYERS, state, (id, on) => {
  state.layers[id] = on;
  save();
  applyLayer(id, on);
});
document.getElementById("quake-mag").addEventListener("change", (e) => { state.quakeMag = Number(e.target.value); refreshEvents(); });
document.getElementById("quake-window").addEventListener("change", (e) => { state.quakeHours = Number(e.target.value); refreshEvents(); });

// ---- data ----
async function loadEvents() {
  try {
    all = (await (await fetch("/api/events")).json()).features;
    refreshEvents();
  } catch { /* keep what's shown; the footer reports stale feeds */ }
}

let hemi = "north", ice = null;
async function loadIce() {
  try { ice = await (await fetch("/api/ice")).json(); renderIce(ice, hemi); } catch { /* retry next hour */ }
}
document.querySelectorAll("#ice .seg button").forEach((b) => b.addEventListener("click", () => {
  hemi = b.dataset.hemi;
  document.querySelectorAll("#ice .seg button").forEach((o) => o.setAttribute("aria-pressed", String(o === b)));
  renderIce(ice, hemi);
}));

async function loadStatus() {
  try { renderStatus(await (await fetch("/api/status")).json()); } catch { /* next time */ }
}

let cloudsAt = null;
async function loadClouds() {
  try {
    const meta = await (await fetch("/api/weather/clouds.json", { cache: "no-cache" })).json();
    if (meta.fetched !== cloudsAt) {
      cloudsAt = meta.fetched;
      globe.setImage("clouds", `/api/weather/clouds.png?t=${encodeURIComponent(meta.fetched)}`);
    }
  } catch { /* not fetched yet */ }
}

const tick = () => { document.getElementById("clock").textContent = time(Date.now()); };
tick();
setInterval(tick, 15e3);
wireStatus();

await globe.ready;
night = createNight((url) => globe.setImage("night", url), { lights: tier.night_lights !== false });
for (const [id, on] of Object.entries(state.layers)) if (!(id in KINDS)) applyLayer(id, on);

await Promise.all([loadEvents(), loadIce(), loadStatus(), loadClouds()]);
setInterval(loadEvents, 60e3);
setInterval(loadStatus, 60e3);
setInterval(loadIce, 3600e3);
setInterval(loadClouds, 5 * 60e3);
setInterval(() => ["temp", "rain"].forEach((id) => state.layers[id] && applyLayer(id, true)), 3600e3);

document.getElementById("zoom-in").onclick = () => map.easeTo({ zoom: map.getZoom() + 0.8 });
document.getElementById("zoom-out").onclick = () => map.easeTo({ zoom: map.getZoom() - 0.8 });
const spinBtn = document.getElementById("spin");
spinBtn.onclick = () => {
  spin.on = !spin.on;
  spinBtn.setAttribute("aria-pressed", String(spin.on));
};

if (TV) setupTv({ globe, card, spin, list: () => shown, ambient: AMBIENT });
// A renderer with no TV watching stops animating, so the box sits idle.
window.gaiaIdle = (idle) => {
  spin.paused = globe.paused = idle;
  if (wind) wind.enabled = !idle && state.layers.wind;
};
if (RENDER) import("./sender.js").then((m) => m.start(RENDER, config.tier));
window.gaia = { globe, state, get shown() { return shown; }, select };
document.body.dataset.ready = "1";
