// The TV's side of the stream. It watches the shared ambient stream until
// someone presses a button, then switches to a stream of its own and sends
// the keys there. After a few quiet minutes it goes back to the shared one.

import { gathered } from "./sender.js";

const IDLE = 5 * 60e3;
const video = document.getElementById("video");
const note = document.getElementById("note");
const tvId = localStorage.getItem("gaia.tv") || crypto.randomUUID();
localStorage.setItem("gaia.tv", tvId);

let conn = null;       // the connection whose picture is showing
let mode = "ambient";
let lastKey = 0;
const queued = [];

function connect(want) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/rtc`);
    const pc = new RTCPeerConnection({ iceServers: [] });
    const c = { ws, pc, channel: null, want };
    pc.ondatachannel = (e) => {
      c.channel = e.channel;
      e.channel.onopen = () => { while (queued.length && want === "interactive") e.channel.send(queued.shift()); };
    };
    pc.ontrack = (e) => resolve({ ...c, stream: e.streams[0] });
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

async function show(want) {
  const next = await connect(want);
  const prev = conn;
  conn = next;
  mode = want;
  video.srcObject = next.stream;
  await video.play().catch(() => {});
  note.textContent = "";
  if (prev) setTimeout(() => close(prev), 500);  // swap without a black frame
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
  if (mode === "switching") return;
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
