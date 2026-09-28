// The night side: a shade over everywhere the sun is down, with NASA's Black
// Marble city lights showing through it. Redrawn every minute as a Web
// Mercator image the globe drapes over the base map.

const SIZE = 1024;
const LIGHTS = "https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap"
  + "&VERSION=1.1.1&LAYERS=VIIRS_Black_Marble&SRS=EPSG:3857"
  + "&BBOX=-20037508.34,-20037508.34,20037508.34,20037508.34"
  + `&WIDTH=${SIZE}&HEIGHT=${SIZE}&FORMAT=image/png&TIME=2016-01-01`;

/** Where the sun is overhead: declination and longitude, in radians. */
export function subsolar(when = new Date()) {
  const start = Date.UTC(when.getUTCFullYear(), 0, 1);
  const doy = (when - start) / 86400e3;
  const hours = when.getUTCHours() + when.getUTCMinutes() / 60 + when.getUTCSeconds() / 3600;
  const g = (2 * Math.PI / 365) * (doy + (hours - 12) / 24);
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const eot = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
    - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const lon = -15 * (hours - 12 + eot / 60);
  return { decl, lon: lon * Math.PI / 180 };
}

async function loadLights() {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = LIGHTS;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = c.height = SIZE;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0, SIZE, SIZE);
  return g.getImageData(0, 0, SIZE, SIZE).data;
}

export function createNight(onImage, { lights: wantLights = true } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const g = canvas.getContext("2d");
  const out = g.createImageData(SIZE, SIZE);
  // Row latitudes and column longitudes of the Mercator square.
  const sinLat = new Float32Array(SIZE), cosLat = new Float32Array(SIZE), lon = new Float32Array(SIZE);
  for (let j = 0; j < SIZE; j++) {
    const y = 1 - ((j + 0.5) / SIZE) * 2;
    const lat = Math.atan(Math.sinh(Math.PI * y));
    sinLat[j] = Math.sin(lat); cosLat[j] = Math.cos(lat);
  }
  for (let i = 0; i < SIZE; i++) lon[i] = (((i + 0.5) / SIZE) * 2 - 1) * Math.PI;

  let lights = null;
  let url = null;
  let enabled = true;

  async function draw() {
    if (!enabled) return;
    const { decl, lon: sun } = subsolar();
    const sd = Math.sin(decl), cd = Math.cos(decl);
    const cosDiff = lon.map((l) => Math.cos(l - sun));
    const px = out.data;
    for (let j = 0; j < SIZE; j++) {
      const a = sinLat[j] * sd, b = cosLat[j] * cd;
      for (let i = 0; i < SIZE; i++) {
        const cz = a + b * cosDiff[i];  // cosine of the sun's zenith angle
        // 0 in daylight, 1 once the sun is 6° below the horizon (civil dusk).
        let t = (0.05 - cz) / 0.155;
        t = t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);
        const k = (j * SIZE + i) * 4;
        let light = 0;
        if (lights && t > 0) {
          const l = (lights[k] + lights[k + 1] + lights[k + 2]) / 765;
          light = Math.max(0, l - 0.12) * 1.6 * t;
        }
        const shade = 0.62 * t;
        const alpha = Math.min(1, shade + light);
        // Premultiplied mix of the shade (near-black blue) and warm lights.
        const w = alpha > 0 ? light / alpha : 0;
        px[k] = 6 + w * 249;
        px[k + 1] = 8 + w * 202;
        px[k + 2] = 14 + w * 130;
        px[k + 3] = alpha * 255;
      }
    }
    g.putImageData(out, 0, 0);
    const blob = await new Promise((r) => canvas.toBlob(r));
    const next = URL.createObjectURL(blob);
    onImage(next);
    if (url) setTimeout(() => URL.revokeObjectURL(url), 5000);
    url = next;
  }

  if (wantLights) {
    loadLights().then((data) => { lights = data; draw(); }).catch(() => {});
  }
  draw();
  setInterval(draw, 60e3);
  return {
    set enabled(on) { enabled = on; if (on) draw(); },
  };
}
