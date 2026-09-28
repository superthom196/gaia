// The globe: MapLibre GL in globe mode, NASA imagery underneath, Gaia's
// overlays (clouds, night, weather, wind) and the event markers on top.

import { KINDS, SEVERITY, iconImage, badgeImage } from "./kinds.js";

const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
const WORLD = [[-180, 85.0511], [180, 85.0511], [180, -85.0511], [-180, -85.0511]];
const EVENT_LAYERS = ["quakes", "icons"];
const BLANK = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function graticule(step = 30) {
  const lines = [];
  for (let lon = -180; lon < 180; lon += step) {
    const coords = [];
    for (let lat = -85; lat <= 85; lat += 5) coords.push([lon, lat]);
    lines.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } });
  }
  for (let lat = -60; lat <= 60; lat += step) {
    const coords = [];
    for (let lon = -180; lon <= 180; lon += 5) coords.push([lon, lat]);
    lines.push({ type: "Feature", properties: { equator: lat === 0 }, geometry: { type: "LineString", coordinates: coords } });
  }
  return { type: "FeatureCollection", features: lines };
}

const empty = () => ({ type: "FeatureCollection", features: [] });

export function createGlobe(container, { center = [150, 15], zoom = 1.6, interactive = true } = {}) {
  const map = new maplibregl.Map({
    container,
    center,
    zoom,
    minZoom: 0.8,
    maxZoom: 9,
    interactive,
    attributionControl: false,
    renderWorldCopies: false,
    // The TV renderer captures the page, so keep the last frame readable.
    canvasContextAttributes: { preserveDrawingBuffer: false, antialias: true },
    style: {
      version: 8,
      projection: { type: "globe" },
      sky: {
        "sky-color": "#0d0f11",
        "horizon-color": "#1c2a38",
        "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 0.55, 5, 0.25, 7, 0],
      },
      sources: {
        base: {
          type: "raster",
          tiles: [`${GIBS}/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`],
          tileSize: 256,
          maxzoom: 8,
        },
        clouds: { type: "image", url: BLANK, coordinates: WORLD },
        night: { type: "image", url: BLANK, coordinates: WORLD },
        temp: { type: "image", url: BLANK, coordinates: WORLD },
        rain: { type: "image", url: BLANK, coordinates: WORLD },
        graticule: { type: "geojson", data: graticule() },
        tracks: { type: "geojson", data: empty() },
        events: { type: "geojson", data: empty() },
        selected: { type: "geojson", data: empty() },
      },
      layers: [
        { id: "space", type: "background", paint: { "background-color": "#0d0f11" } },
        {
          id: "base", type: "raster", source: "base",
          // Muted, so the events carry the colour.
          paint: { "raster-saturation": -0.55, "raster-brightness-max": 0.78, "raster-contrast": 0.08, "raster-fade-duration": 0 },
        },
        { id: "clouds", type: "raster", source: "clouds", paint: { "raster-opacity": 0.85, "raster-fade-duration": 0 } },
        { id: "night", type: "raster", source: "night", paint: { "raster-opacity": 1, "raster-fade-duration": 0 } },
        { id: "temp", type: "raster", source: "temp", layout: { visibility: "none" }, paint: { "raster-opacity": 0.75, "raster-fade-duration": 0 } },
        { id: "rain", type: "raster", source: "rain", layout: { visibility: "none" }, paint: { "raster-opacity": 0.9, "raster-fade-duration": 0 } },
        {
          id: "graticule", type: "line", source: "graticule",
          paint: {
            "line-color": "#e8e6e1",
            "line-opacity": ["case", ["boolean", ["get", "equator"], false], 0.22, 0.1],
            "line-width": 0.6,
          },
        },
        {
          id: "tracks", type: "line", source: "tracks",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": KINDS.storm.color, "line-width": 1.4, "line-opacity": 0.75, "line-dasharray": [1, 2.5] },
        },
        {
          id: "quake-ripple", type: "circle", source: "events",
          filter: ["all", ["==", ["get", "kind"], "quake"], ["<", ["get", "hours"], 1]],
          paint: { "circle-radius": 8, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": KINDS.quake.color, "circle-stroke-width": 1.2, "circle-stroke-opacity": 0.8, "circle-pitch-alignment": "map" },
        },
        {
          id: "quakes", type: "circle", source: "events",
          filter: ["==", ["get", "kind"], "quake"],
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["get", "magnitude"], 2.5, 2.5, 4.5, 4.5, 6, 9, 7, 14, 8, 20],
            "circle-color": KINDS.quake.color,
            // Older quakes fade: a day-old one at half strength.
            "circle-opacity": ["interpolate", ["linear"], ["get", "hours"], 0, 0.55, 24, 0.3, 168, 0.12],
            "circle-stroke-color": KINDS.quake.color,
            "circle-stroke-width": 1.2,
            "circle-stroke-opacity": ["interpolate", ["linear"], ["get", "hours"], 0, 1, 24, 0.7, 168, 0.35],
            "circle-pitch-alignment": "map",
          },
        },
        {
          id: "icons", type: "symbol", source: "events",
          filter: ["!=", ["get", "kind"], "quake"],
          layout: {
            "icon-image": ["get", "icon"],
            "icon-size": ["interpolate", ["linear"], ["get", "rank"], 0, 0.42, 4, 0.62],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "symbol-sort-key": ["get", "rank"],
          },
        },
        {
          id: "badges", type: "symbol", source: "events",
          filter: [">", ["coalesce", ["get", "count"], 1], 1],
          layout: {
            "icon-image": ["concat", "badge-", ["to-string", ["get", "count"]]],
            "icon-size": 0.5,
            "icon-offset": [22, -22],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
        },
        {
          id: "selected", type: "circle", source: "selected",
          paint: { "circle-radius": 16, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.8, "circle-pitch-alignment": "map" },
        },
      ],
    },
  });

  // Marker icons: one per kind, volcanoes also one per alert colour.
  map.on("load", () => {
    for (const [kind, { color }] of Object.entries(KINDS)) {
      if (kind === "quake") continue;
      map.addImage(`icon-${kind}`, iconImage(kind, color), { pixelRatio: 1 });
    }
    for (const [sev, color] of Object.entries(SEVERITY)) {
      map.addImage(`icon-volcano-${sev}`, iconImage("volcano", color), { pixelRatio: 1 });
    }
  });
  map.on("styleimagemissing", (e) => {
    const m = /^badge-(\d+)$/.exec(e.id);
    if (m) map.addImage(e.id, badgeImage(Number(m[1])), { pixelRatio: 1 });
  });

  const handlers = { select: [] };
  const globe = {
    map,
    paused: false,
    ready: new Promise((resolve) => map.on("load", resolve)),
    on(name, fn) { handlers[name].push(fn); },

    setEvents(features) {
      const shown = features.map((f) => {
        const p = f.properties;
        const icon = p.kind === "volcano" && p.severity ? `icon-volcano-${p.severity}` : `icon-${p.kind}`;
        return { ...f, properties: { ...p, icon, members: undefined, track: undefined } };
      });
      map.getSource("events")?.setData({ type: "FeatureCollection", features: shown });
      const tracks = features
        .filter((f) => f.properties.track?.length > 1)
        .map((f) => ({
          type: "Feature",
          properties: { id: f.properties.id },
          geometry: { type: "LineString", coordinates: f.properties.track.map((t) => [t[0], t[1]]) },
        }));
      map.getSource("tracks")?.setData({ type: "FeatureCollection", features: tracks });
    },

    setImage(name, url) {
      map.getSource(name)?.updateImage({ url, coordinates: WORLD });
    },

    setVisible(layer, on) {
      if (map.getLayer(layer)) map.setLayoutProperty(layer, "visibility", on ? "visible" : "none");
    },

    select(feature) {
      map.getSource("selected")?.setData(feature ? { type: "FeatureCollection", features: [feature] } : empty());
    },

    /** Screen position of a point, or null when it's on the far side. */
    screen(lngLat) {
      const c = map.getCenter();
      const r = Math.PI / 180;
      const cos = Math.sin(c.lat * r) * Math.sin(lngLat[1] * r)
        + Math.cos(c.lat * r) * Math.cos(lngLat[1] * r) * Math.cos((lngLat[0] - c.lng) * r);
      if (cos < 0.08) return null;
      return map.project(lngLat);
    },
  };

  const pick = (e) => {
    const hit = map.queryRenderedFeatures(e.point, { layers: EVENT_LAYERS.filter((l) => map.getLayer(l)) })[0];
    handlers.select.forEach((fn) => fn(hit ? hit.properties.id : null));
  };
  map.on("click", pick);
  for (const layer of EVENT_LAYERS) {
    map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
  }

  // New quakes pulse outwards.
  const ripple = () => {
    if (!globe.paused && map.getLayer("quake-ripple")) {
      const t = (performance.now() % 2000) / 2000;
      map.setPaintProperty("quake-ripple", "circle-radius", 6 + t * 22);
      map.setPaintProperty("quake-ripple", "circle-stroke-opacity", 0.9 * (1 - t));
    }
    requestAnimationFrame(ripple);
  };
  map.once("load", ripple);

  return globe;
}
