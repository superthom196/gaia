// The TV's side of the stream. It plays the box's one stream (Gaia is
// watched in one place at a time) and sends the remote's keys back to it
// over the stream's data channel. When Back has nothing left to undo on the
// box, the box says so and the TV app closes.

import { gathered } from "./sender.js";

const note = document.getElementById("note");

let conn = null;       // the connection whose picture is showing
const queued = [];     // keys pressed before the key channel opened

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/rtc`);
    const pc = new RTCPeerConnection({ iceServers: [] });
    // One object for the whole connection: the key channel arrives on it
    // after the picture does, so it mustn't be copied.
    const c = { ws, pc, channel: null, stream: null };
    pc.ondatachannel = (e) => {
      c.channel = e.channel;
      e.channel.onopen = () => { while (queued.length) e.channel.send(queued.shift()); };
      e.channel.onmessage = (m) => { if (JSON.parse(m.data).exit) leave(); };
    };
    pc.ontrack = (e) => { c.stream = e.streams[0]; resolve(c); };
    pc.onconnectionstatechange = () => {
      if (["failed", "disconnected"].includes(pc.connectionState) && conn === c) reconnect();
    };
    ws.onopen = () => ws.send(JSON.stringify({ type: "hello", role: "viewer" }));
    ws.onmessage = async (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "offer") {
        await pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
        await pc.setLocalDescription(await pc.createAnswer());
        await gathered(pc);
        ws.send(JSON.stringify({ type: "answer", sdp: pc.localDescription.sdp }));
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
async function show() {
  const next = await connect();
  const video = await play(next.stream);
  const prev = conn, prevVideo = showing;
  conn = next;
  showing = video;
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
    try { await show(); break; } catch (err) { console.warn("stream:", err.message); await new Promise((r) => setTimeout(r, wait)); }
  }
  retrying = false;
}

const BACK = new Set(["Escape", "Backspace", "GoBack", "BrowserBack"]);

/** Back to the TV's launcher (the Android app's bridge; nothing in a browser). */
function leave() {
  window.GaiaApp?.exit();
}

function press(key) {
  const msg = JSON.stringify({ key });
  if (conn?.channel?.readyState === "open") conn.channel.send(msg);
  else if (BACK.has(key)) leave();  // no stream to steer: Back just leaves
  else queued.push(msg);
}

const REMOTE = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", " ", "ContextMenu", "Escape", "Backspace", "GoBack", "BrowserBack", "MediaPlayPause", "m"]);
window.addEventListener("keydown", (e) => {
  if (!REMOTE.has(e.key)) return;
  e.preventDefault();
  press(e.key);
});
// The Android TV app forwards Menu and Back this way.
window.gaiaKey = (name) => press(name);

reconnect();
