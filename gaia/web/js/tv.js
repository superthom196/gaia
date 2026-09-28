// Spinning, the TV remote, and the screensaver's tour.
//
// Remote (PLAN.md): left and right spin, up and down zoom, OK flies to the
// next event and opens its card, Menu opens the layers, Back returns to slow
// spin. In the layers menu the arrows move the focus and OK switches a layer.

const HOME_ZOOM = 2.1;

export function createSpin(globe, { degreesPerSecond = 3 } = {}) {
  const map = globe.map;
  let on = true, held = false, last = performance.now(), resumeTimer = null;
  const frame = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (on && !held && !map.isMoving()) {
      const c = map.getCenter();
      map.jumpTo({ center: [((c.lng + degreesPerSecond * dt + 540) % 360) - 180, c.lat] });
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  const spin = {
    get on() { return on; },
    set on(v) { on = v; held = false; },
    /** Pause while someone is using the globe; carry on after a quiet spell. */
    hold(ms = 20000) {
      held = true;
      clearTimeout(resumeTimer);
      if (ms) resumeTimer = setTimeout(() => { held = false; }, ms);
    },
  };
  for (const ev of ["mousedown", "wheel", "touchstart"]) {
    map.getCanvas().addEventListener(ev, () => spin.hold(), { passive: true });
  }
  return spin;
}

const KEY = {
  ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down",
  Enter: "ok", " ": "ok", MediaPlayPause: "ok",
  ContextMenu: "menu", m: "menu", M: "menu", F1: "menu",
  Escape: "back", Backspace: "back", GoBack: "back", BrowserBack: "back",
};

export function setupTv({ globe, card, spin, list, ambient }) {
  const map = globe.map;
  document.body.classList.add("tv");
  if (ambient) document.body.classList.add("ambient");
  document.getElementById("tv-hints").hidden = !!ambient;
  let index = -1, menuIndex = 0;

  const layers = () => [...document.querySelectorAll("#layers .layer")];
  const menuOpen = () => document.body.classList.contains("menu-open");
  function focusLayer(i) {
    const all = layers();
    menuIndex = (i + all.length) % all.length;
    all.forEach((b, j) => b.classList.toggle("focus", j === menuIndex));
    all[menuIndex].scrollIntoView({ block: "nearest" });
  }
  function openMenu(open) {
    document.body.classList.toggle("menu-open", open);
    if (open) focusLayer(menuIndex);
  }

  function goTo(feature, zoom = 3.4) {
    spin.on = false;
    map.flyTo({ center: feature.geometry.coordinates, zoom, duration: 2600, essential: true });
    globe.select(feature);
    card.open(feature);
  }

  function next() {
    const items = list();
    if (!items.length) return;
    index = (index + 1) % items.length;
    goTo(items[index]);
  }

  function home() {
    card.close();
    globe.select(null);
    openMenu(false);
    map.easeTo({ zoom: HOME_ZOOM, pitch: 0, duration: 1500 });
    spin.on = true;
  }

  function press(action) {
    if (menuOpen()) {
      if (action === "up") focusLayer(menuIndex - 1);
      else if (action === "down") focusLayer(menuIndex + 1);
      else if (action === "ok") layers()[menuIndex].click();
      else if (action === "menu" || action === "back") openMenu(false);
      return;
    }
    const c = map.getCenter();
    switch (action) {
      case "left": spin.on = false; map.easeTo({ center: [c.lng - 25, c.lat], duration: 600 }); break;
      case "right": spin.on = false; map.easeTo({ center: [c.lng + 25, c.lat], duration: 600 }); break;
      case "up": map.easeTo({ zoom: Math.min(8, map.getZoom() + 0.8), duration: 500 }); break;
      case "down": map.easeTo({ zoom: Math.max(1, map.getZoom() - 0.8), duration: 500 }); break;
      case "ok": next(); break;
      case "menu": openMenu(true); break;
      case "back": home(); break;
    }
  }

  window.addEventListener("keydown", (e) => {
    const action = KEY[e.key];
    if (!action) return;
    e.preventDefault();
    press(action);
  });
  // The TV app forwards keys the WebView can't see (Menu, Back) this way.
  window.gaiaKey = (name) => press(KEY[name] || name);

  if (ambient) tour({ goTo, home, list });
  return { press };
}

/** Screensaver: slow spin; every minute or so, visit a recent event. */
function tour({ goTo, home, list }) {
  const EVERY = 60e3, SHOW = 18e3;
  let recent = [];
  async function visit() {
    const items = list().slice(0, 40);
    if (items.length) {
      // Prefer severe and recent events, and don't repeat the last few.
      const scored = items
        .filter((f) => !recent.includes(f.properties.id))
        .map((f) => [f, (1 + f.properties.rank * 2) / (1 + f.properties.hours / 12) * (0.6 + Math.random() * 0.8)])
        .sort((a, b) => b[1] - a[1]);
      const pick = (scored[0] || [items[0]])[0];
      recent = [pick.properties.id, ...recent].slice(0, 6);
      goTo(pick, 3);
      setTimeout(home, SHOW);
    }
  }
  setTimeout(() => { visit(); setInterval(visit, EVERY); }, 20e3);
}
