// Static OBS catalog for the mock core: source/filter/transition types,
// default settings per kind, encoders, streaming services, audio devices.
// Names and ids follow OBS Studio 31 on Windows.

import os from "node:os";

export const USER = (() => {
  try {
    return os.userInfo().username || "Streamer";
  } catch {
    return "Streamer";
  }
})();
export const HOME = `C:\\Users\\${USER}`;

// ------------------------------------------------------------------ type helpers
const type = (id, name, kind, flags = {}) => ({
  id,
  name,
  kind,
  video: false,
  audio: false,
  async: false,
  interactive: false,
  controllableMedia: false,
  deprecated: false,
  icon: "custom",
  ...flags,
});

export const SOURCE_TYPES = [
  type("image_source", "Image", "input", { video: true, icon: "image" }),
  type("color_source_v3", "Color Source", "input", { video: true, icon: "color" }),
  type("slideshow_v2", "Image Slide Show", "input", { video: true, controllableMedia: true, icon: "slideshow" }),
  type("ffmpeg_source", "Media Source", "input", { video: true, audio: true, async: true, controllableMedia: true, icon: "media" }),
  type("text_gdiplus_v3", "Text (GDI+)", "input", { video: true, icon: "text" }),
  type("text_ft2_source_v2", "Text (FreeType 2)", "input", { video: true, deprecated: true, icon: "text" }),
  type("monitor_capture", "Display Capture", "input", { video: true, icon: "desktop" }),
  type("window_capture", "Window Capture", "input", { video: true, icon: "window" }),
  type("game_capture", "Game Capture", "input", { video: true, icon: "game" }),
  type("dshow_input", "Video Capture Device", "input", { video: true, audio: true, async: true, icon: "camera" }),
  type("wasapi_input_capture", "Audio Input Capture", "input", { audio: true, icon: "audio_input" }),
  type("wasapi_output_capture", "Audio Output Capture", "input", { audio: true, icon: "audio_output" }),
  type("wasapi_process_output_capture", "Application Audio Capture", "input", { audio: true, icon: "process_audio" }),
  type("browser_source", "Browser", "input", { video: true, audio: true, interactive: true, icon: "browser" }),
  type("scene", "Scene", "scene", { video: true, icon: "scene" }),
  type("audio_line", "JACK Input Client", "input", { audio: true, deprecated: true, icon: "audio_input" }),
];

const vf = (id, name) => type(id, name, "filter", { video: true });
const af = (id, name) => type(id, name, "filter", { audio: true });
export const FILTER_TYPES = [
  // Effect filters (sync video)
  vf("crop_filter", "Crop/Pad"),
  vf("color_filter_v2", "Color Correction"),
  vf("chroma_key_filter_v2", "Chroma Key"),
  vf("color_key_filter_v2", "Color Key"),
  vf("luma_key_filter_v2", "Luma Key"),
  vf("mask_filter_v2", "Image Mask/Blend"),
  vf("sharpness_filter_v2", "Sharpen"),
  vf("scroll_filter", "Scroll"),
  vf("scale_filter", "Scaling/Aspect Ratio"),
  vf("gpu_delay", "Render Delay"),
  // Audio/Video filters (async video + audio)
  type("async_delay_filter", "Video Delay (Async)", "filter", { video: true, async: true }),
  af("gain_filter", "Gain"),
  af("noise_suppress_filter_v2", "Noise Suppression"),
  af("noise_gate_filter", "Noise Gate"),
  af("compressor_filter", "Compressor"),
  af("limiter_filter", "Limiter"),
  af("expander_filter", "Expander"),
  af("upward_compressor_filter", "Upward Compressor"),
  af("basic_eq_filter", "3-Band Equalizer"),
  af("invert_polarity_filter", "Invert Polarity"),
  af("vst_filter", "VST 2.x Plug-in"),
];

export const TRANSITION_TYPES = [
  type("cut_transition", "Cut", "transition", { video: true, icon: "transition" }),
  type("fade_transition", "Fade", "transition", { video: true, icon: "transition" }),
  type("slide_transition", "Slide", "transition", { video: true, icon: "transition" }),
  type("swipe_transition", "Swipe", "transition", { video: true, icon: "transition" }),
  type("obs_stinger_transition", "Stinger", "transition", { video: true, audio: true, icon: "transition" }),
  type("wipe_transition", "Luma Wipe", "transition", { video: true, icon: "transition" }),
];
export const FIXED_TRANSITIONS = new Set(["cut_transition", "fade_transition"]);

export const sourceType = (kind) => SOURCE_TYPES.find((t) => t.id === kind) ?? null;
export const filterType = (kind) => FILTER_TYPES.find((t) => t.id === kind) ?? null;
export const transitionType = (kind) => TRANSITION_TYPES.find((t) => t.id === kind) ?? null;
export const baseKind = (kind) => kind.replace(/_v\d+$/, "");

/** Filters compatible with a source (all filters when no source is given). */
export function compatibleFilters(src) {
  if (!src) return FILTER_TYPES;
  return FILTER_TYPES.filter((f) => {
    if (f.audio && !f.video) return src.audio;
    if (f.async) return src.async && src.video;
    return src.video;
  });
}

// ------------------------------------------------------------------ devices
export const MONITORS = [
  { id: "\\\\?\\DISPLAY#GSM5B7F#5&2a8c3f1d&0&UID4352#{e6f07b5f-ee97-4a90-b076-33f57bf4eaa7}", name: "LG ULTRAGEAR: 1920x1080 @ 0,0 (Primary Monitor)", w: 1920, h: 1080 },
  { id: "\\\\?\\DISPLAY#DEL41A8#5&2a8c3f1d&0&UID4353#{e6f07b5f-ee97-4a90-b076-33f57bf4eaa7}", name: "DELL U2719D: 2560x1440 @ 1920,0", w: 2560, h: 1440 },
];

export const WINDOWS = [
  { value: "Hollow Knight:UnityWndClass:hollow_knight.exe", name: "[hollow_knight.exe]: Hollow Knight", exe: "hollow_knight.exe" },
  { value: "Discord:Chrome_WidgetWin_1:Discord.exe", name: "[Discord.exe]: #general | Vexcast - Discord", exe: "Discord.exe" },
  { value: "Vexcast - Google Chrome:Chrome_WidgetWin_1:chrome.exe", name: "[chrome.exe]: Vexcast - Google Chrome", exe: "chrome.exe" },
  { value: "Spotify Premium:Chrome_WidgetWin_0:Spotify.exe", name: "[Spotify.exe]: Spotify Premium", exe: "Spotify.exe" },
  { value: "Visual Studio Code:Chrome_WidgetWin_1:Code.exe", name: "[Code.exe]: server.js - vexcast - Visual Studio Code", exe: "Code.exe" },
];

export const VIDEO_DEVICES = [
  { id: "Logitech HD Pro Webcam C920:\\\\?\\usb#vid_046d&pid_082d&mi_00#7&1b3d2f4a&0&0000#{65e8773d-8f56-11d0-a3b9-00a0c9223196}\\global", name: "Logitech HD Pro Webcam C920" },
  { id: "Elgato Facecam:\\\\?\\usb#vid_0fd9&pid_0078&mi_00#7&2c41e9b0&0&0000#{65e8773d-8f56-11d0-a3b9-00a0c9223196}\\global", name: "Elgato Facecam" },
  { id: "OBS Virtual Camera:", name: "OBS Virtual Camera" },
];

export const AUDIO_INPUTS = [
  { id: "{0.0.1.00000000}.{5f8a3c21-7b4e-4d2a-9c61-0e3b8f2a1d47}", name: "Micrófono (Shure MV7)" },
  { id: "{0.0.1.00000000}.{9e2d4b18-3a6c-47f0-b815-6c2a9d3e0f12}", name: "Micrófono (Realtek(R) Audio)" },
  { id: "{0.0.1.00000000}.{c41a7e60-2f9b-4b3d-8e07-5d1f6a8b2c93}", name: "Micrófono (HyperX Cloud II Wireless)" },
  { id: "{0.0.1.00000000}.{1b7f2e94-6d3a-4c58-a0e2-7f9c3b5d8e16}", name: "CABLE Output (VB-Audio Virtual Cable)" },
];

export const AUDIO_OUTPUTS = [
  { id: "{0.0.0.00000000}.{8c3e1f72-4a5b-49d6-b1e8-2f7a9c0d3e51}", name: "Altavoces (Realtek(R) Audio)" },
  { id: "{0.0.0.00000000}.{2d9b6a13-7e4c-4f81-9a35-c6e0b8f1d274}", name: "Auriculares (HyperX Cloud II Wireless)" },
  { id: "{0.0.0.00000000}.{f6a14c3d-9b2e-4e70-85d1-3a7c2e9f0b68}", name: "LG ULTRAGEAR (NVIDIA High Definition Audio)" },
  { id: "{0.0.0.00000000}.{4e7c9a21-3f5d-4b86-a2c9-8d1e6f0a3b75}", name: "CABLE Input (VB-Audio Virtual Cable)" },
];

// ------------------------------------------------------------------ default settings
const GDI_FONT = { face: "Arial", style: "Regular", size: 256, flags: 0 };

export const SOURCE_DEFAULTS = {
  image_source: { file: "", unload: false, linear_alpha: false },
  color_source_v3: { color: 0xffd1d1d1, width: 1920, height: 1080 },
  slideshow_v2: {
    playback_behavior: "always_play",
    slide_mode: "mode_auto",
    transition: "fade",
    transition_speed: 700,
    slide_time: 8000,
    loop: true,
    hide: false,
    randomize: false,
    use_custom_size: "Automatic",
    files: [],
  },
  ffmpeg_source: {
    is_local_file: true,
    local_file: "",
    looping: false,
    restart_on_activate: true,
    buffering_mb: 2,
    input: "",
    input_format: "",
    reconnect_delay_sec: 10,
    hw_decode: false,
    clear_on_media_end: true,
    close_when_inactive: false,
    speed_percent: 100,
    color_range: 0,
    linear_alpha: false,
    seekable: false,
    ffmpeg_options: "",
  },
  text_gdiplus_v3: {
    text: "",
    read_from_file: false,
    file: "",
    antialiasing: true,
    transform: 0,
    vertical: false,
    font: GDI_FONT,
    color: 0xffffffff,
    opacity: 100,
    gradient: false,
    gradient_color: 0xffffffff,
    gradient_opacity: 100,
    gradient_dir: 90,
    bk_color: 0xff000000,
    bk_opacity: 0,
    align: "left",
    valign: "top",
    outline: false,
    outline_size: 2,
    outline_color: 0xffffffff,
    outline_opacity: 100,
    chatlog: false,
    chatlog_lines: 6,
    extents: false,
    extents_cx: 100,
    extents_cy: 100,
    extents_wrap: true,
  },
  text_ft2_source_v2: {
    text: "",
    font: { face: "Sans Serif", style: "", size: 32, flags: 0 },
    color1: 0xffffffff,
    color2: 0xffffffff,
    outline: false,
    drop_shadow: false,
    from_file: false,
    text_file: "",
    log_mode: false,
    log_lines: 6,
    word_wrap: false,
    custom_width: 0,
    antialiasing: true,
  },
  monitor_capture: { method: 0, monitor_id: MONITORS[0].id, capture_cursor: true, force_sdr: false },
  window_capture: { window: "", method: 0, priority: 2, cursor: true, client_area: true, force_sdr: false, compatibility: false },
  game_capture: {
    capture_mode: "any_fullscreen",
    window: "",
    priority: 2,
    sli_compatibility: false,
    capture_audio: false,
    capture_cursor: true,
    allow_transparency: false,
    premultiplied_alpha: false,
    limit_framerate: false,
    capture_overlays: false,
    anti_cheat_hook: true,
    hook_rate: 1,
    rgb10a2_space: "srgb",
  },
  dshow_input: {
    video_device_id: VIDEO_DEVICES[0].id,
    active: true,
    res_type: 0,
    resolution: "1280x720",
    fps: { numerator: 30, denominator: 1 },
    video_format: 0,
    color_space: "default",
    color_range: "default",
    buffering: 0,
    deactivate_when_not_showing: false,
    flip_vertically: false,
    autorotation: true,
    hw_decode: false,
    audio_output_mode: 0,
    use_custom_audio_device: false,
    audio_device_id: "",
  },
  wasapi_input_capture: { device_id: "default", use_device_timing: false },
  wasapi_output_capture: { device_id: "default", use_device_timing: true },
  wasapi_process_output_capture: { window: "", priority: 2 },
  browser_source: {
    is_local_file: false,
    local_file: "",
    url: "https://obsproject.com/browser-source",
    width: 800,
    height: 600,
    fps_custom: false,
    fps: 30,
    reroute_audio: false,
    css: "body { background-color: rgba(0, 0, 0, 0); margin: 0px auto; overflow: hidden; }",
    shutdown: false,
    restart_when_active: false,
    webpage_control_level: 1,
  },
  scene: {},
  audio_line: { startjack: false },
};

export const FILTER_DEFAULTS = {
  crop_filter: { relative: true, left: 0, top: 0, right: 0, bottom: 0, cx: 0, cy: 0 },
  color_filter_v2: { gamma: 0, contrast: 0, brightness: 0, saturation: 0, hue_shift: 0, opacity: 1, color_multiply: 0xffffff, color_add: 0x000000 },
  chroma_key_filter_v2: { key_color_type: "green", key_color: 0x00ff00, similarity: 400, smoothness: 80, spill: 100, opacity: 1, contrast: 0, brightness: 0, gamma: 0 },
  color_key_filter_v2: { key_color_type: "green", key_color: 0x00ff00, similarity: 80, smoothness: 50, opacity: 1, contrast: 0, brightness: 0, gamma: 0 },
  luma_key_filter_v2: { luma_max: 1, luma_max_smooth: 0, luma_min: 0, luma_min_smooth: 0 },
  mask_filter_v2: { type: "mask_color_alpha", image_path: "", color: 0xffffff, opacity: 1, stretch: false },
  sharpness_filter_v2: { sharpness: 0.08 },
  scroll_filter: { speed_x: 0, speed_y: 0, limit_cx: false, cx: 100, limit_cy: false, cy: 100, loop: true },
  scale_filter: { sampling: "bicubic", resolution: "None", undistort: false },
  gpu_delay: { delay_ms: 0 },
  async_delay_filter: { delay_ms: 0 },
  gain_filter: { db: 0 },
  noise_suppress_filter_v2: { method: "rnnoise", suppress_level: -30, intensity: 1 },
  noise_gate_filter: { open_threshold: -26, close_threshold: -32, attack_time: 25, hold_time: 200, release_time: 150 },
  compressor_filter: { ratio: 10, threshold: -18, attack_time: 6, release_time: 60, output_gain: 0, sidechain_source: "none" },
  limiter_filter: { threshold: -6, release_time: 60 },
  expander_filter: { presets: "expander", ratio: 2, threshold: -40, attack_time: 10, release_time: 50, output_gain: 0, detector: "RMS" },
  upward_compressor_filter: { ratio: 0.5, threshold: -20, attack_time: 10, release_time: 50, output_gain: 0, knee_width: 10 },
  basic_eq_filter: { low: 0, mid: 0, high: 0 },
  invert_polarity_filter: {},
  vst_filter: { plugin_path: "", open_when_active_vst_settings: false },
};

export const TRANSITION_DEFAULTS = {
  cut_transition: {},
  fade_transition: {},
  slide_transition: { direction: "left" },
  swipe_transition: { direction: "left", swipe_in: false },
  obs_stinger_transition: {
    path: "",
    tp_type: "time",
    transition_point: 1000,
    transition_point_frame: 30,
    hw_decode: true,
    preload: false,
    track_matte_enabled: false,
    track_matte_layout: 0,
    invert_matte: false,
    audio_monitoring: 0,
    audio_fade_style: 0,
  },
  wipe_transition: { luma_image: "linear-h.png", luma_softness: 0.03, luma_invert: false },
};

const clone = (v) => structuredClone(v);
export const sourceDefaults = (kind) => clone(SOURCE_DEFAULTS[kind] ?? {});
export const filterDefaults = (kind) => clone(FILTER_DEFAULTS[kind] ?? {});
export const transitionDefaults = (kind) => clone(TRANSITION_DEFAULTS[kind] ?? {});

// ------------------------------------------------------------------ encoders
export const ENCODERS = [
  { id: "obs_x264", name: "x264", codec: "h264", type: "video", hardware: false, deprecated: false },
  { id: "jim_nvenc", name: "NVIDIA NVENC H.264", codec: "h264", type: "video", hardware: true, deprecated: false },
  { id: "jim_hevc_nvenc", name: "NVIDIA NVENC HEVC", codec: "hevc", type: "video", hardware: true, deprecated: false },
  { id: "jim_av1_nvenc", name: "NVIDIA NVENC AV1", codec: "av1", type: "video", hardware: true, deprecated: false },
  { id: "obs_qsv11_v2", name: "QuickSync H.264", codec: "h264", type: "video", hardware: true, deprecated: false },
  { id: "ffmpeg_aac", name: "FFmpeg AAC", codec: "aac", type: "audio", hardware: false, deprecated: false },
  { id: "ffmpeg_opus", name: "FFmpeg Opus", codec: "opus", type: "audio", hardware: false, deprecated: false },
];

const NVENC_DEFAULTS = {
  rate_control: "CBR",
  bitrate: 6000,
  max_bitrate: 12000,
  cqp: 20,
  keyint_sec: 2,
  preset2: "p5",
  tune: "hq",
  multipass: "qres",
  profile: "high",
  lookahead: false,
  psycho_aq: true,
  bf: 2,
  gpu: 0,
  repeat_headers: false,
};

export const ENCODER_DEFAULTS = {
  obs_x264: { rate_control: "CBR", bitrate: 6000, use_bufsize: false, buffer_size: 6000, crf: 23, keyint_sec: 2, preset: "veryfast", profile: "high", tune: "", x264opts: "" },
  jim_nvenc: NVENC_DEFAULTS,
  jim_hevc_nvenc: { ...NVENC_DEFAULTS, profile: "main" },
  jim_av1_nvenc: { ...NVENC_DEFAULTS, profile: "main", bf: 0 },
  obs_qsv11_v2: { rate_control: "CBR", bitrate: 6000, max_bitrate: 12000, cqp: 23, icq_quality: 23, keyint_sec: 2, target_usage: "TU4", profile: "high", bframes: 3, latency: "normal" },
  ffmpeg_aac: { bitrate: 160 },
  ffmpeg_opus: { bitrate: 160 },
};
export const encoderDefaults = (id) => clone(ENCODER_DEFAULTS[id] ?? {});

// ------------------------------------------------------------------ services
export const SERVICES = [
  {
    name: "Twitch",
    protocol: "RTMP",
    recommended: { maxVideoBitrate: 6000, maxAudioBitrate: 320, keyint: 2 },
    servers: [
      { name: "Auto (Recommended)", url: "rtmp://live.twitch.tv/app" },
      { name: "Europe: Madrid, Spain", url: "rtmp://mad01.contribute.live-video.net/app" },
      { name: "Europe: Paris, France", url: "rtmp://cdg10.contribute.live-video.net/app" },
      { name: "Europe: Frankfurt, Germany", url: "rtmp://fra05.contribute.live-video.net/app" },
      { name: "NA: Ashburn, VA", url: "rtmp://iad05.contribute.live-video.net/app" },
      { name: "South America: Sao Paulo, Brazil", url: "rtmp://sao03.contribute.live-video.net/app" },
      { name: "NA: Queretaro, Mexico", url: "rtmp://qro01.contribute.live-video.net/app" },
    ],
  },
  {
    name: "YouTube - RTMPS",
    protocol: "RTMPS",
    recommended: { maxVideoBitrate: 51000, maxAudioBitrate: 160, keyint: 2 },
    servers: [
      { name: "Primary YouTube ingest server", url: "rtmps://a.rtmps.youtube.com:443/live2" },
      { name: "Backup YouTube ingest server", url: "rtmps://b.rtmps.youtube.com:443/live2?backup=1" },
    ],
  },
  {
    name: "Kick",
    protocol: "RTMPS",
    recommended: { maxVideoBitrate: 8000, maxAudioBitrate: 192, keyint: 2 },
    servers: [{ name: "Default", url: "rtmps://fa723fc1b171.global-contribute.live-video.net/app" }],
  },
  {
    name: "Facebook Live",
    protocol: "RTMPS",
    recommended: { maxVideoBitrate: 6000, maxAudioBitrate: 128, keyint: 2 },
    servers: [{ name: "Default", url: "rtmps://rtmp-api.facebook.com:443/rtmp/" }],
  },
  {
    name: "TikTok",
    protocol: "RTMP",
    recommended: { maxVideoBitrate: 6000, maxAudioBitrate: 160, keyint: 2 },
    servers: [{ name: "Default", url: "rtmp://push-rtmp-l11-va01.tiktokcdn.com/stage/" }],
  },
  {
    name: "X (Twitter)",
    protocol: "RTMPS",
    recommended: { maxVideoBitrate: 9000, maxAudioBitrate: 128, keyint: 3 },
    servers: [
      { name: "US West: California", url: "rtmps://ca.pscp.tv:443/x" },
      { name: "EU West: Frankfurt", url: "rtmps://de.pscp.tv:443/x" },
      { name: "South America: Sao Paulo", url: "rtmps://br.pscp.tv:443/x" },
    ],
  },
  {
    name: "Restream.io",
    protocol: "RTMP",
    recommended: null,
    servers: [
      { name: "Autodetect", url: "rtmp://live.restream.io/live" },
      { name: "EU-Central (Frankfurt, DE)", url: "rtmp://frankfurt.restream.io/live" },
      { name: "EU-West (Madrid, ES)", url: "rtmp://madrid.restream.io/live" },
      { name: "US-East (Washington, DC)", url: "rtmp://washington.restream.io/live" },
    ],
  },
];

// ------------------------------------------------------------------ hotkeys
/**
 * Hotkeys are derived from the current state (scenes, sources, items), like
 * OBS registers them per object. Ids are stable per (owner, name).
 */
const hotkeyIds = new Map();
let nextHotkeyId = 1;
const hotkeyBindings = new Map();
const hkId = (owner, name) => {
  const key = `${owner}\u0000${name}`;
  if (!hotkeyIds.has(key)) hotkeyIds.set(key, nextHotkeyId++);
  return hotkeyIds.get(key);
};

const key = (k, mods = {}) => ({ key: k, ctrl: false, shift: false, alt: false, command: false, ...mods });
// Seed a few bindings like a real profile.
const SEED_BINDINGS = {
  "frontend\u0000OBSBasic.StartStreaming": [key("OBS_KEY_F9", { ctrl: true })],
  "frontend\u0000OBSBasic.StopStreaming": [key("OBS_KEY_F9", { ctrl: true, shift: true })],
  "frontend\u0000OBSBasic.StartRecording": [key("OBS_KEY_F10", { ctrl: true })],
  "frontend\u0000OBSBasic.StopRecording": [key("OBS_KEY_F10", { ctrl: true, shift: true })],
  "frontend\u0000ReplayBuffer.Save": [key("OBS_KEY_F8")],
  "Mic/Aux\u0000libobs.push-to-talk": [key("OBS_KEY_V")],
};

export function hotkeysFor(state) {
  const out = [];
  const add = (owner, name, description) => {
    const id = hkId(owner, name);
    if (!hotkeyBindings.has(id)) hotkeyBindings.set(id, structuredClone(SEED_BINDINGS[`${owner}\u0000${name}`] ?? []));
    out.push({ id, name, description, owner, bindings: hotkeyBindings.get(id) });
  };
  const fe = [
    ["OBSBasic.StartStreaming", "Start Streaming"],
    ["OBSBasic.StopStreaming", "Stop Streaming"],
    ["OBSBasic.ForceStopStreaming", "Stop Streaming (discard delay)"],
    ["OBSBasic.StartRecording", "Start Recording"],
    ["OBSBasic.StopRecording", "Stop Recording"],
    ["OBSBasic.PauseRecording", "Pause Recording"],
    ["OBSBasic.UnpauseRecording", "Unpause Recording"],
    ["OBSBasic.SplitFile", "Split Recording"],
    ["OBSBasic.StartReplayBuffer", "Start Replay Buffer"],
    ["OBSBasic.StopReplayBuffer", "Stop Replay Buffer"],
    ["ReplayBuffer.Save", "Save Replay"],
    ["OBSBasic.StartVirtualCam", "Start Virtual Camera"],
    ["OBSBasic.StopVirtualCam", "Stop Virtual Camera"],
    ["OBSBasic.EnablePreview", "Enable Preview"],
    ["OBSBasic.DisablePreview", "Disable Preview"],
    ["OBSBasic.Transition", "Transition"],
    ["OBSBasic.ResetStats", "Reset Stats"],
    ["OBSBasic.Screenshot", "Screenshot Output"],
    ["OBSBasic.SelectedSourceScreenshot", "Screenshot Selected Source"],
  ];
  for (const [n, d] of fe) add("frontend", n, d);
  for (const sc of state.scenes) {
    add(sc.name, "OBSBasic.SelectScene", "Switch to scene");
    const walk = (items) => {
      for (const it of items) {
        add(sc.name, `libobs.show_scene_item.${it.id}`, `Show '${it.name}'`);
        add(sc.name, `libobs.hide_scene_item.${it.id}`, `Hide '${it.name}'`);
        if (it.items) walk(it.items);
      }
    };
    walk(sc.items);
  }
  for (const s of state.sources) {
    if (s.audio) {
      add(s.name, "libobs.mute", "Mute");
      add(s.name, "libobs.unmute", "Unmute");
      add(s.name, "libobs.push-to-mute", "Push-to-mute");
      add(s.name, "libobs.push-to-talk", "Push-to-talk");
    }
    if (s.controllableMedia) {
      add(s.name, "MediaSource.Restart", "Restart");
      add(s.name, "MediaSource.Play", "Play");
      add(s.name, "MediaSource.Pause", "Pause");
      add(s.name, "MediaSource.Stop", "Stop");
    }
  }
  return out;
}

export function setHotkeyBindings(id, bindings) {
  hotkeyBindings.set(id, (bindings ?? []).map((b) => key(String(b.key ?? ""), { ctrl: !!b.ctrl, shift: !!b.shift, alt: !!b.alt, command: !!b.command })));
}
