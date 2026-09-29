// Spinning, the TV remote, and the screensaver's tour.
//
// Remote (PLAN.md): left and right spin, up and down zoom, OK (or Menu) opens
// the menu, Back returns to slow spin, and Back at slow spin leaves the TV
// app. In the menu (Next event, Slow spin, then the layers) up and down move,
// OK picks, Back closes.
//
// The TV stream is one page on the box: it tours events like a screensaver
// until someone uses the remote, and goes back to touring after IDLE.

const HOME_ZOOM = 2.1;
const IDLE = 5 * 60e3;

export function createSpin(globe, { degreesPerSecond = 3 } = {}) {
  const map = globe.map;
  let on = true, held = false, last = performance.now(), resumeTimer = null;
  const frame = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (on && !held && !spin.paused && !map.isMoving()) {
      const c = map.getCenter();
      map.jumpTo({ center: [((c.lng + degreesPerSecond * dt + 540) % 360) - 180, c.lat] });
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  const changed = () => spin.onChange?.(spin.spinning);
  const spin = {
    paused: false, // a renderer nobody watches
    onChange: null,
    get on() { return on; },
    set on(v) { on = v; held = false; clearTimeout(resumeTimer); changed(); },
    /** Turning now: on, and not held by someone using the globe. */
    get spinning() { return on && !held; },
    /** Pause while someone is using the globe; carry on after a quiet spell. */
    hold(ms = 20000) {
      held = true;
      clearTimeout(resumeTimer);
      if (ms) resumeTimer = setTimeout(() => { held = false; changed(); }, ms);
      changed();
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
  document.getElementById("tv-hints").hidden = false;
  let index = -1, menuIndex = 0, lastKey = 0, idleTimer = null;
  let resting = true;  // slow spin with nothing to undo: Back leaves the app

  // The menu is the layers panel with the remote's actions on top.
  const actions = [["Next event", () => next()], ["Slow spin", () => home()]];
  const top = document.createElement("div");
  top.innerHTML = '<div class="group-label">Go to</div>';
  for (const [label, run] of actions) {
    const b = document.createElement("button");
    b.className = "layer tv-action";
    b.innerHTML = `<span class="name"></span>`;
    b.querySelector(".name").textContent = label;
    b.addEventListener("click", (e) => { e.stopPropagation(); openMenu(false); run(); });
    top.append(b);
  }
  document.getElementById("layers-body").prepend(top);
  document.querySelector("#layers h2").textContent = "Menu";

  const items = () => [...document.querySelectorAll("#layers .layer")];
  const menuOpen = () => document.body.classList.contains("menu-open");
  function focusItem(i) {
    const all = items();
    menuIndex = (i + all.length) % all.length;
    all.forEach((b, j) => b.classList.toggle("focus", j === menuIndex));
    all[menuIndex].scrollIntoView({ block: "nearest" });
  }
  function openMenu(open) {
    document.body.classList.toggle("menu-open", open);
    if (open) focusItem(0);
  }

  function goTo(feature, zoom = 3.4) {
    resting = false;
    spin.on = false;
    map.flyTo({ center: feature.geometry.coordinates, zoom, duration: 2600, essential: true });
    globe.select(feature);
    card.open(feature);
  }

  function next() {
    const all = list();
    if (!all.length) return;
    index = (index + 1) % all.length;
    goTo(all[index]);
  }

  function home() {
    card.close();
    globe.select(null);
    openMenu(false);
    map.easeTo({ zoom: HOME_ZOOM, pitch: 0, duration: 1500 });
    spin.on = true;
    resting = true;
  }

  // Someone has the remote: show the hints, pause the tour; after a quiet
  // spell, back to the screensaver.
  function inUse() {
    lastKey = Date.now();
    document.body.classList.remove("ambient");
    clearTimeout(idleTimer);
    if (ambient) idleTimer = setTimeout(() => { home(); document.body.classList.add("ambient"); }, IDLE);
  }
  if (ambient) document.body.classList.add("ambient");

  /** Returns "exit" when Back has nothing left to undo. */
  function press(action) {
    inUse();
    if (menuOpen()) {
      if (action === "up") focusItem(menuIndex - 1);
      else if (action === "down") focusItem(menuIndex + 1);
      else if (action === "ok") items()[menuIndex].click();
      else if (action === "menu" || action === "back") openMenu(false);
      return;
    }
    if (action === "back" && resting) return "exit";
    if (action !== "ok" && action !== "menu") resting = false;
    const c = map.getCenter();
    switch (action) {
      case "left": spin.on = false; map.easeTo({ center: [c.lng - 25, c.lat], duration: 600 }); break;
      case "right": spin.on = false; map.easeTo({ center: [c.lng + 25, c.lat], duration: 600 }); break;
      case "up": map.easeTo({ zoom: Math.min(8, map.getZoom() + 0.8), duration: 500 }); break;
      case "down": map.easeTo({ zoom: Math.max(1, map.getZoom() - 0.8), duration: 500 }); break;
      case "ok": case "menu": openMenu(true); break;
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

  if (ambient) tour({ goTo, home, list, busy: () => Date.now() - lastKey < IDLE });
  return { press };
}

/** Screensaver: slow spin; every minute or so, visit a recent event. */
function tour({ goTo, home, list, busy }) {
  const EVERY = 60e3, SHOW = 18e3;
  let recent = [];
  async function visit() {
    if (busy()) return;
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
      setTimeout(() => { if (!busy()) home(); }, SHOW);
    }
  }
  setTimeout(() => { visit(); setInterval(visit, EVERY); }, 20e3);
}
