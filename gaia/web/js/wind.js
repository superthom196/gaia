// Wind particles. Thousands of points drift with the GFS 10 m wind and leave
// fading trails, drawn on a Web Mercator canvas the globe drapes as an
// animated source. The idea follows mapbox/webgl-wind (ISC licence); this is
// a small CPU version of it.

const SIZE = 1024;
const WORLD = [[-180, 85.0511], [180, 85.0511], [180, -85.0511], [-180, -85.0511]];
const MAX_LAT = 80;

export async function createWind(map, { particles = 5000, before } = {}) {
  const meta = await (await fetch("/api/weather/wind.json", { cache: "no-cache" })).json();
  const img = new Image();
  img.src = `/api/weather/wind.png?run=${encodeURIComponent(meta.run)}`;
  await img.decode();
  const w = img.naturalWidth, h = img.naturalHeight;
  const read = document.createElement("canvas");
  read.width = w; read.height = h;
  const rg = read.getContext("2d", { willReadFrequently: true });
  rg.drawImage(img, 0, 0);
  const px = rg.getImageData(0, 0, w, h).data;
  const U = new Float32Array(w * h), V = new Float32Array(w * h);
  const span = meta.max - meta.min;
  for (let i = 0; i < w * h; i++) {
    U[i] = meta.min + (px[i * 4] / 255) * span;
    V[i] = meta.min + (px[i * 4 + 1] / 255) * span;
  }

  // Bilinear sample at (lon, lat); columns start at 180°W, rows at 90°N.
  function sample(lon, lat) {
    const x = ((lon + 180) / 360) * w, y = ((90 - lat) / 180) * (h - 1);
    const x0 = Math.floor(x), y0 = Math.min(h - 2, Math.floor(y));
    const fx = x - x0, fy = y - y0;
    const a = y0 * w + (x0 % w), b = y0 * w + ((x0 + 1) % w);
    const c = a + w, d = b + w;
    const lerp = (A) => (A[a] * (1 - fx) + A[b] * fx) * (1 - fy) + (A[c] * (1 - fx) + A[d] * fx) * fy;
    return [lerp(U), lerp(V)];
  }

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const g = canvas.getContext("2d");
  const lon = new Float32Array(particles), lat = new Float32Array(particles), age = new Uint16Array(particles);
  const spawn = (i) => {
    lon[i] = Math.random() * 360 - 180;
    // Even over the sphere, not over the map.
    lat[i] = (Math.asin(Math.random() * 2 - 1) * 180) / Math.PI * (MAX_LAT / 90);
    age[i] = Math.floor(Math.random() * 80);
  };
  for (let i = 0; i < particles; i++) spawn(i);

  const mx = (l) => ((l + 180) / 360) * SIZE;
  const my = (l) => {
    const r = (l * Math.PI) / 180;
    return ((1 - Math.log(Math.tan(Math.PI / 4 + r / 2)) / Math.PI) / 2) * SIZE;
  };

  let running = false;
  function step() {
    if (!running) return;
    g.globalCompositeOperation = "destination-in";
    g.fillStyle = "rgba(0,0,0,0.96)";
    g.fillRect(0, 0, SIZE, SIZE);
    g.globalCompositeOperation = "source-over";
    g.lineWidth = 1;
    g.strokeStyle = "rgba(232,230,225,0.45)";
    g.beginPath();
    for (let i = 0; i < particles; i++) {
      const [u, v] = sample(lon[i], lat[i]);
      const k = 0.012;
      const nlon = lon[i] + (u * k) / Math.max(0.2, Math.cos((lat[i] * Math.PI) / 180));
      const nlat = lat[i] + v * k;
      if (++age[i] > 100 || Math.abs(nlat) > MAX_LAT || nlon < -180 || nlon > 180 || Math.random() < 0.002) {
        spawn(i);
        continue;
      }
      g.moveTo(mx(lon[i]), my(lat[i]));
      g.lineTo(mx(nlon), my(nlat));
      lon[i] = nlon; lat[i] = nlat;
    }
    g.stroke();
    requestAnimationFrame(step);
  }

  map.addSource("wind", { type: "canvas", canvas, coordinates: WORLD, animate: true });
  map.addLayer({ id: "wind", type: "raster", source: "wind", paint: { "raster-opacity": 0.8, "raster-fade-duration": 0 } }, before);

  const control = {
    run: meta.run,
    set enabled(on) {
      map.setLayoutProperty("wind", "visibility", on ? "visible" : "none");
      const src = map.getSource("wind");
      if (on && !running) { running = true; src.play(); step(); }
      if (!on && running) { running = false; src.pause(); g.clearRect(0, 0, SIZE, SIZE); }
    },
  };
  return control;
}
