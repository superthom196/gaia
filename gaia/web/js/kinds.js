// Each kind of event has its own colour and shape. Severity shows as size.

export const KINDS = {
  quake: { label: "Earthquakes", color: "#e2c044" },
  volcano: { label: "Volcanoes", color: "#e5534b" },
  storm: { label: "Storms", color: "#5aa9e6" },
  fire: { label: "Wildfires", color: "#f0883e" },
  flood: { label: "Floods", color: "#3fb8a9" },
  ice: { label: "Icebergs", color: "#cde6f2" },
  drought: { label: "Droughts", color: "#b89968" },
};

export const SEVERITY = { green: "#57ab5a", yellow: "#d9b43c", orange: "#e0823d", red: "#e5534b" };
export const SEVERITY_RANK = { green: 1, yellow: 2, orange: 3, red: 4 };

// Shapes as SVG path data in a 20×20 box, centred on (10, 10).
export const SHAPES = {
  quake: null, // drawn as a circle
  volcano: "M10 3 L17.5 16 L2.5 16 Z",
  storm: null, // drawn as a spiral
  fire: "M10 2.5 C13.5 6.5 16 9 16 12 A6 6 0 0 1 4 12 C4 9 6.5 6.5 10 2.5 Z",
  flood: "M10 3 C13 7.5 15.5 10 15.5 12.5 A5.5 5.5 0 0 1 4.5 12.5 C4.5 10 7 7.5 10 3 Z",
  ice: "M10 3.5 L16.5 10 L10 16.5 L3.5 10 Z",
  drought: "M4 4 H16 V16 H4 Z",
};

/** An inline SVG glyph for lists and the layers panel. */
export function glyph(kind, size = 18, color = KINDS[kind].color) {
  const s = `width="${size}" height="${size}" viewBox="0 0 20 20" class="glyph" aria-hidden="true"`;
  if (kind === "quake") {
    return `<svg ${s}><circle cx="10" cy="10" r="6" fill="${color}" fill-opacity="0.35" stroke="${color}" stroke-width="1.6"/></svg>`;
  }
  if (kind === "storm") {
    return `<svg ${s}><g fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"><circle cx="10" cy="10" r="2.4"/><path d="M9 3 A7 7 0 0 1 17 11"/><path d="M11 17 A7 7 0 0 1 3 9"/></g></svg>`;
  }
  return `<svg ${s}><path d="${SHAPES[kind]}" fill="${color}" stroke="#0d0f11" stroke-width="1"/></svg>`;
}

/** Draw a marker icon for the globe (MapLibre's addImage wants pixels). */
export function iconImage(kind, color, px = 40) {
  const c = document.createElement("canvas");
  c.width = c.height = px;
  const g = c.getContext("2d");
  g.scale(px / 20, px / 20);
  g.lineJoin = "round";
  if (kind === "storm") {
    g.strokeStyle = color;
    g.lineWidth = 2.2;
    g.lineCap = "round";
    g.beginPath(); g.arc(10, 10, 2.4, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(10, 10, 7, -Math.PI * 0.6, Math.PI * 0.1); g.stroke();
    g.beginPath(); g.arc(10, 10, 7, Math.PI * 0.4, Math.PI * 1.1); g.stroke();
  } else {
    const p = new Path2D(SHAPES[kind]);
    g.fillStyle = color;
    g.strokeStyle = "rgba(8,9,11,0.85)";
    g.lineWidth = 1.2;
    g.fill(p);
    g.stroke(p);
  }
  return g.getImageData(0, 0, px, px);
}

/** A small count badge for quake swarms. */
export function badgeImage(n, px = 2) {
  const text = String(n);
  const w = (10 + text.length * 7) * px, h = 16 * px;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  g.fillStyle = "#e2c044";
  g.beginPath(); g.roundRect(0, 0, w, h, h / 2); g.fill();
  g.fillStyle = "#16130a";
  g.font = `600 ${11 * px}px "Plex Mono", ui-monospace, monospace`;
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(text, w / 2, h / 2 + px * 0.5);
  return g.getImageData(0, 0, w, h);
}
