// The TV's side of the stream. It watches the shared ambient stream until
// someone presses a button, then switches to a stream of its own and sends
// the keys there. After a few quiet minutes it goes back to the shared one.

import { gathered } from "./sender.js";

const IDLE = 5 * 60e3;
const note = document.getElementById("note");
// crypto.randomUUID needs a secure page, and TVs load Gaia over plain HTTP.
const tvId = localStorage.getItem("gaia.tv")
  || Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
localStorage.setItem("gaia.tv", tvId);

let conn = null;       // the connection whose picture is showing
let mode = "ambient";
let lastKey = 0;
const queued = [];

function connect(want) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/rtc`);
    const pc = new RTCPeerConnection({ iceServers: [] });
    // One object for the whole connection: the key channel arrives on it
    // after the picture does, so it mustn't be copied.
    const c = { ws, pc, channel: null, want, stream: null };
    pc.ondatachannel = (e) => {
      c.channel = e.channel;
      e.channel.onopen = () => { while (queued.length && want === "interactive") e.channel.send(queued.shift()); };
    };
    pc.ontrack = (e) => { c.stream = e.streams[0]; resolve(c); };
    pc.onconnectionstatechange = () => {
      if (["failed", "disconnected"].includes(pc.connectionState) && conn === c) reconnect();
    };
    ws.onopen = () => ws.send(JSON.stringify({ type: "hello", role: "viewer", want, tv: tvId }));
    ws.onmessage = async (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "offer") {
        await pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
        await pc.setLocalDescription(await pc.createAnswer());
        await gathered(pc);
        ws.send(JSON.stringify({ type: "answer", sdp: pc.localDescription.sdp }));
      } else if (msg.type === "busy") {
        reject(new Error("busy"));
      }
    };
    ws.onclose = () => { reject(new Error("closed")); if (conn && conn.ws === ws) reconnect(); };
    setTimeout(() => reject(new Error("timeout")), 30e3);
  });
}

function close(c) {
  try { c.pc.close(); } catch { /* already gone */ }
  try { c.ws.close(); } catch { /* already gone */ }
}

// Android's WebView draws a grey play button on any video without a frame,
// unless it has a poster: a transparent pixel.
const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/** A new video for the stream, shown only once its first frame is up. */
function play(stream) {
  const v = document.createElement("video");
  Object.assign(v, { autoplay: true, muted: true, playsInline: true, poster: BLANK });
  v.srcObject = stream;
  document.body.prepend(v);
  return new Promise((resolve) => {
    const shown = () => { v.classList.add("on"); resolve(v); };
    if ("requestVideoFrameCallback" in v) v.requestVideoFrameCallback(shown);
    else v.addEventListener("playing", shown, { once: true });
    v.play().catch(() => {});
    setTimeout(shown, 5000);
  });
}

let showing = null;  // the video element on screen
async function show(want) {
  const next = await connect(want);
  const video = await play(next.stream);
  const prev = conn, prevVideo = showing;
  conn = next;
  showing = video;
  mode = want;
  note.textContent = "";
  if (prevVideo && prevVideo !== video) prevVideo.remove();
  if (prev) close(prev);
}

let retrying = false;
async function reconnect() {
  if (retrying) return;
  retrying = true;
  note.textContent = "Reconnecting…";
  for (let wait = 1000; ; wait = Math.min(wait * 2, 15000)) {
    try { await show("ambient"); break; } catch (err) { console.warn("stream:", err.message); await new Promise((r) => setTimeout(r, wait)); }
  }
  retrying = false;
}

async function press(key) {
  lastKey = Date.now();
  const msg = JSON.stringify({ key });
  if (mode === "interactive" && conn?.channel?.readyState === "open") {
    conn.channel.send(msg);
    return;
  }
  queued.push(msg);
  // Already on (or on the way to) this TV's own stream: its key channel
  // sends the queue as soon as it opens. Only the shared stream switches.
  if (mode !== "ambient") return;
  mode = "switching";
  try {
    await show("interactive");
  } catch (err) {
    mode = "ambient";
    queued.length = 0;
    note.textContent = err.message === "busy" ? "Every stream on this box is in use; showing the shared view" : "";
    setTimeout(() => { note.textContent = ""; }, 4000);
  }
}

const REMOTE = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", " ", "ContextMenu", "Escape", "Backspace", "GoBack", "BrowserBack", "MediaPlayPause", "m"]);
window.addEventListener("keydown", (e) => {
  if (!REMOTE.has(e.key)) return;
  e.preventDefault();
  press(e.key);
});
// The Android TV app forwards Menu and Back this way.
window.gaiaKey = (name) => press(name);

setInterval(() => {
  if (mode === "interactive" && Date.now() - lastKey > IDLE) show("ambient").catch(() => {});
}, 15e3);

reconnect();
