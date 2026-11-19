/**
 * The page that runs inside the camera WebView: opens the phone's camera with
 * getUserMedia and sends it to every Vexcast viewer (the `phonecam.html` browser source)
 * with WebRTC, directly over the local network.
 *
 * It's loaded with an https base URL so the WebView treats it as a secure context
 * (getUserMedia needs one). It never touches the network itself: signalling goes through
 * React Native (`postMessage` out, `window.vx.receive(msg)` in), which owns the
 * WebSocket to the core.
 *
 * In:  {type:"config", facing:"rear"|"front", deviceId?, quality:"720p"|"1080p", fps, orientation, mic, noise}
 *      {type:"controls", zoom?, torch?, focusMode?, focusDistance?, exposureMode?, exposureCompensation?,
 *                        whiteBalanceMode?, colorTemperature?}   (camera controls, applied live)
 *      {type:"view", mirror, flip, rotate, fit}                   (how Vexcast shows the image)
 *      {type:"signal", data}   (from the core: join / leave / answer / ice)
 *      {type:"reset"}          (signalling reconnected: the viewers will join again)
 * Out: {type:"signal", data}   (to the core: offer / ice / view, with `to`)
 *      {type:"devices", list:[{id,label}], current, facing}
 *      {type:"caps", caps, settings}   (what this camera can adjust, and its current values)
 *      {type:"status", phase:"starting"|"camera"|"error", error?, viewers, connected}
 */
export const PHONECAM_BASE_URL = "https://localhost/vexcast-phonecam";

export const PHONECAM_PAGE = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
  #box { position: absolute; inset: 0; overflow: hidden; }
  video { position: absolute; top: 50%; left: 50%; width: 100%; height: 100%; object-fit: contain; transform: translate(-50%, -50%); }
</style>
</head>
<body>
<div id="box"><video id="v" autoplay muted playsinline></video></div>
<script>
(function () {
  var video = document.getElementById("v");
  var box = document.getElementById("box");
  var cfg = null;
  var view = { mirror: false, flip: false, rotate: 0, fit: "contain" };
  var controls = {};
  var stream = null;
  var peers = {};          // viewer id -> RTCPeerConnection
  var waiting = {};        // viewers that joined before the camera was ready
  var applying = Promise.resolve();

  function post(m) { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
  function signal(m) { post({ type: "signal", data: m }); }

  function status(phase, error) {
    var ids = Object.keys(peers);
    var connected = ids.filter(function (id) { return peers[id].connectionState === "connected"; }).length;
    post({ type: "status", phase: phase, error: error || null, viewers: ids.length, connected: connected });
  }
  var phase = "starting";
  function report(p, e) { phase = p; status(p, e); }

  /** The preview shows exactly what Vexcast will show (same mirror / flip / rotation). */
  function layout() {
    var r = ((view.rotate || 0) % 360 + 360) % 360;
    var side = r === 90 || r === 270;
    var w = box.clientWidth, h = box.clientHeight;
    video.style.width = (side ? h : w) + "px";
    video.style.height = (side ? w : h) + "px";
    video.style.objectFit = view.fit === "cover" ? "cover" : "contain";
    video.style.transform = "translate(-50%, -50%) rotate(" + r + "deg) scale(" + (view.mirror ? -1 : 1) + "," + (view.flip ? -1 : 1) + ")";
  }
  window.addEventListener("resize", layout);

  function sendView(id) { signal({ to: Number(id), type: "view", mirror: !!view.mirror, flip: !!view.flip, rotate: view.rotate || 0, fit: view.fit || "contain" }); }

  function bitrate() {
    var base = cfg && cfg.quality === "1080p" ? 8000000 : 4000000;
    return cfg && cfg.fps >= 50 ? Math.round(base * 1.5) : base;
  }

  function tuneSenders(pc) {
    pc.getSenders().forEach(function (s) {
      if (!s.track || s.track.kind !== "video" || !s.getParameters) return;
      var p = s.getParameters();
      if (!p.encodings || !p.encodings.length) p.encodings = [{}];
      p.encodings[0].maxBitrate = bitrate();
      p.encodings[0].maxFramerate = (cfg && cfg.fps) || 30;
      s.setParameters(p).catch(function () {});
    });
  }

  function closePeer(id) {
    var pc = peers[id];
    if (pc) { try { pc.close(); } catch (e) {} }
    delete peers[id];
  }

  async function startPeer(id) {
    if (!stream) { waiting[id] = true; return; }
    closePeer(id);
    var pc = new RTCPeerConnection({ iceServers: [] });
    peers[id] = pc;
    stream.getTracks().forEach(function (t) { pc.addTrack(t, stream); });
    pc.onicecandidate = function (e) { if (e.candidate) signal({ to: Number(id), type: "ice", candidate: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = function () {
      if (peers[id] !== pc) return;
      if (pc.connectionState === "connected") tuneSenders(pc);
      if (pc.connectionState === "failed") {
        // Try again once the network settles (Wi-Fi roaming, the PC's firewall prompt…).
        closePeer(id);
        setTimeout(function () { if (!peers[id]) startPeer(id); }, 2000);
      }
      status(phase);
    };
    sendView(id);
    var offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    signal({ to: Number(id), type: "offer", sdp: pc.localDescription.sdp });
    status(phase);
  }

  function constraints() {
    var dims = cfg.quality === "1080p" ? [1920, 1080] : [1280, 720];
    var land = cfg.orientation !== "portrait";
    var fps = cfg.fps || 30;
    var v = { width: { ideal: land ? dims[0] : dims[1] }, height: { ideal: land ? dims[1] : dims[0] }, frameRate: { ideal: fps, max: fps } };
    if (cfg.deviceId) v.deviceId = { exact: cfg.deviceId };
    else v.facingMode = { ideal: cfg.facing === "front" ? "user" : "environment" };
    var clean = cfg.noise !== false;
    var a = cfg.mic ? { echoCancellation: clean, noiseSuppression: clean, autoGainControl: true } : false;
    return { video: v, audio: a };
  }

  function videoTrack() { return stream && stream.getVideoTracks()[0]; }

  /** What the camera lets us adjust (zoom, torch, focus…), only the parts we have controls for. */
  function reportCaps() {
    var t = videoTrack();
    if (!t) return;
    var caps = {}, settings = {};
    try { caps = t.getCapabilities ? t.getCapabilities() : {}; } catch (e) {}
    try { settings = t.getSettings ? t.getSettings() : {}; } catch (e) {}
    var keys = ["zoom", "torch", "focusMode", "focusDistance", "exposureMode", "exposureCompensation", "whiteBalanceMode", "colorTemperature", "frameRate", "width", "height", "backgroundBlur"];
    var c = {}, s = {};
    keys.forEach(function (k) {
      if (caps[k] !== undefined) c[k] = caps[k];
      if (settings[k] !== undefined) s[k] = settings[k];
    });
    post({ type: "caps", caps: c, settings: s });
  }

  async function applyControls(next) {
    var t = videoTrack();
    if (!t || !t.applyConstraints) return;
    var caps = {};
    try { caps = t.getCapabilities ? t.getCapabilities() : {}; } catch (e) {}
    var adv = {};
    Object.keys(next).forEach(function (k) {
      if (next[k] === undefined || next[k] === null) return;
      if (caps[k] === undefined && k !== "torch") return;
      adv[k] = next[k];
    });
    // A manual value only applies in manual mode (and the other way round).
    if (adv.focusDistance !== undefined && caps.focusMode && caps.focusMode.indexOf("manual") >= 0 && adv.focusMode === undefined) adv.focusMode = "manual";
    if (adv.colorTemperature !== undefined && caps.whiteBalanceMode && caps.whiteBalanceMode.indexOf("manual") >= 0 && adv.whiteBalanceMode === undefined) adv.whiteBalanceMode = "manual";
    if (!Object.keys(adv).length) return;
    try { await t.applyConstraints({ advanced: [adv] }); }
    catch (e) {
      // One unsupported value shouldn't block the rest: try them one by one.
      for (var k in adv) { var one = {}; one[k] = adv[k]; try { await t.applyConstraints({ advanced: [one] }); } catch (e2) {} }
    }
    reportCaps();
  }

  async function listDevices(track) {
    try {
      var all = await navigator.mediaDevices.enumerateDevices();
      var cams = all.filter(function (d) { return d.kind === "videoinput"; }).map(function (d, i) {
        return { id: d.deviceId, label: d.label || String((cfg && cfg.label) || "Camera {n}").replace("{n}", String(i + 1)) };
      });
      var s = track && track.getSettings ? track.getSettings() : {};
      post({ type: "devices", list: cams, current: s.deviceId || null, facing: s.facingMode || null });
    } catch (e) {}
  }

  async function apply(next) {
    var old = cfg;
    cfg = next;
    // Another camera: don't carry over the previous one's zoom, torch, focus…
    if (old && (old.facing !== next.facing || old.deviceId !== next.deviceId)) controls = {};
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return report("error", "unsupported");
    report("starting");
    // Phones can't open two cameras at once: release the current one first.
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints());
    } catch (e) {
      // A camera id from another session or an impossible size / frame rate: fall back to the basics.
      if (cfg.deviceId || (e && e.name === "OverconstrainedError")) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: cfg.facing === "front" ? "user" : "environment" }, audio: !!cfg.mic });
        } catch (e2) { e = e2; }
      }
      if (!stream) return report("error", (e && e.name) || "error");
    }
    video.srcObject = stream;
    layout();
    var track = videoTrack();
    listDevices(track);
    // Keep zoom / torch / focus… across camera switches when the new camera allows them.
    if (Object.keys(controls).length) await applyControls(controls);
    reportCaps();
    // Some phones fill in the capabilities a moment after the camera starts.
    setTimeout(reportCaps, 800);

    var audioChanged = !old || old.mic !== cfg.mic;
    var ids = Object.keys(peers);
    if (audioChanged) {
      // Adding or removing the mic changes the session: renegotiate with every viewer.
      ids.forEach(function (id) { startPeer(id); });
    } else {
      ids.forEach(function (id) {
        var pc = peers[id];
        pc.getSenders().forEach(function (snd) {
          if (!snd.track) return;
          var t = snd.track.kind === "audio" ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];
          if (t) snd.replaceTrack(t).catch(function () { startPeer(id); });
        });
        tuneSenders(pc);
      });
    }
    Object.keys(waiting).forEach(function (id) { delete waiting[id]; startPeer(id); });
    report("camera");
  }

  function onSignal(m) {
    if (m.type === "join") startPeer(String(m.peer)).catch(function () { closePeer(String(m.peer)); });
    else if (m.type === "leave") { closePeer(String(m.peer)); delete waiting[String(m.peer)]; status(phase); }
    else if (m.type === "answer" && peers[m.from]) peers[m.from].setRemoteDescription({ type: "answer", sdp: m.sdp }).catch(function () {});
    else if (m.type === "ice" && peers[m.from] && m.candidate) peers[m.from].addIceCandidate(m.candidate).catch(function () {});
  }

  window.vx = {
    receive: function (m) {
      if (m.type === "config") applying = applying.then(function () { return apply(m); }).catch(function () {});
      else if (m.type === "controls") {
        Object.keys(m).forEach(function (k) { if (k !== "type") controls[k] = m[k]; });
        applying = applying.then(function () { return applyControls(controls); }).catch(function () {});
      } else if (m.type === "view") {
        view = { mirror: !!m.mirror, flip: !!m.flip, rotate: m.rotate || 0, fit: m.fit || "contain" };
        layout();
        Object.keys(peers).forEach(sendView);
      }
      else if (m.type === "signal") onSignal(m.data);
      else if (m.type === "reset") { Object.keys(peers).forEach(closePeer); waiting = {}; status(phase); }
    },
  };
  post({ type: "ready" });
})();
</script>
</body>
</html>`;
