// Renderer side of the TV stream. The box runs this page in headless
// Chromium; it captures its own tab and sends it to each TV that joins over
// WebRTC. Remote keys come back over a data channel and drive the page as if
// they were pressed here.

const BITRATE = { 1280: 3_000_000, 1920: 6_000_000 };

export async function start(session, tier) {
  const key = new URLSearchParams(location.search).get("key");
  const fps = tier.fps || 30;

  // getDisplayMedia needs a user gesture; the box's manager presses a key
  // once the page has loaded (Chromium runs with --auto-accept-this-tab-capture).
  await new Promise((resolve) => {
    const go = () => { window.removeEventListener("keydown", go, true); resolve(); };
    window.addEventListener("keydown", go, true);
  });
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: fps, width: tier.width, height: tier.height },
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: "include",
  });
  const track = stream.getVideoTracks()[0];
  track.contentHint = "detail";

  const peers = new Map();
  let ws = null;
  const send = (msg) => ws?.readyState === 1 && ws.send(JSON.stringify(msg));

  // Keep the capture; if the server goes away, reconnect the signalling only.
  function connect() {
    ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/rtc`);
    ws.onopen = () => send({ type: "hello", role: "renderer", session, key });
    ws.onclose = () => {
      peers.forEach((pc) => pc.close());
      peers.clear();
      setTimeout(connect, 3000);
    };
    ws.onmessage = (e) => handle(JSON.parse(e.data));
  }

  async function handle(msg) {
    if (msg.type === "join") {
      const pc = new RTCPeerConnection({ iceServers: [] });
      peers.set(msg.viewer, pc);
      const sender = pc.addTrack(track, stream);
      // Chromium's default codec (VP8), not H.264: a Sony Bravia's WebView
      // can't configure its hardware H.264 decoder for WebRTC and has no
      // software one, so it shows black.
      const channel = pc.createDataChannel("keys");
      channel.onmessage = (m) => {
        const { key: pressed } = JSON.parse(m.data);
        // Back at slow spin: tell the TV to leave the app.
        if (window.gaiaKey?.(pressed) === "exit") channel.send(JSON.stringify({ exit: true }));
        send({ type: "key", viewer: msg.viewer });
      };
      pc.onconnectionstatechange = () => {
        if (["failed", "closed"].includes(pc.connectionState)) { pc.close(); peers.delete(msg.viewer); }
      };
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc);
      const params = sender.getParameters();
      // Keep the full picture. With maintain-framerate WebRTC dropped it to
      // 320x180 with the box mostly idle.
      params.degradationPreference = "maintain-resolution";
      params.encodings = [{ maxBitrate: BITRATE[tier.width] || 6_000_000, maxFramerate: fps }];
      await sender.setParameters(params).catch(() => {});
      send({ type: "offer", viewer: msg.viewer, sdp: pc.localDescription.sdp });
    } else if (msg.type === "answer") {
      await peers.get(msg.viewer)?.setRemoteDescription({ type: "answer", sdp: msg.sdp });
    } else if (msg.type === "viewers") {
      window.gaiaIdle?.(msg.count === 0);
    } else if (msg.type === "leave") {
      peers.get(msg.viewer)?.close();
      peers.delete(msg.viewer);
    }
  }
  connect();
  document.body.dataset.streaming = "1";
}

/** Wait until every local candidate is in the description: on a LAN that's
    quick, and it saves trickling candidates through the server. */
export function gathered(pc) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { if (pc.iceGatheringState === "complete") resolve(); };
    pc.addEventListener("icegatheringstatechange", done);
    setTimeout(resolve, 2000);
  });
}
