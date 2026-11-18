// OBS property schemas for the mock core, evaluated against the current
// settings (this is where OBS "modified callbacks" are emulated: changing a
// list or a checkbox changes the visibility/enabled state of other properties).

import {
  AUDIO_INPUTS,
  AUDIO_OUTPUTS,
  MONITORS,
  VIDEO_DEVICES,
  WINDOWS,
  HOME,
  sourceDefaults,
  filterDefaults,
  transitionDefaults,
  encoderDefaults,
} from "./catalog.js";

// ------------------------------------------------------------------ builders
const base = (type, name, description, value, extra = {}) => ({
  name,
  description,
  longDescription: null,
  type,
  enabled: true,
  visible: true,
  value: value === undefined ? null : value,
  ...extra,
});

/** Builder bound to a settings object. */
function builder(s) {
  const v = (n) => s[n];
  return {
    bool: (n, d, x) => base("bool", n, d, !!v(n), x),
    int: (n, d, min, max, x = {}) => base("int", n, d, v(n), { min, max, step: x.step ?? 1, suffix: x.suffix ?? null, slider: !!x.slider, ...strip(x) }),
    float: (n, d, min, max, x = {}) => base("float", n, d, v(n), { min, max, step: x.step ?? 0.01, suffix: x.suffix ?? null, slider: !!x.slider, ...strip(x) }),
    text: (n, d, x = {}) => base("text", n, d, v(n) ?? "", { textType: x.textType ?? "default", monospace: !!x.monospace, ...strip(x) }),
    info: (n, d, infoType = "normal", x = {}) => base("text", n, d, d, { textType: "info", monospace: false, infoType, ...x }),
    path: (n, d, pathType, filter, defaultPath, x) =>
      base("path", n, d, v(n) ?? "", { pathType, filter: filter ?? null, defaultPath: defaultPath ?? null, ...x }),
    list: (n, d, items, x = {}) => {
      const fmt = x.format ?? (typeof items[0]?.[1] === "number" ? (Number.isInteger(items[0][1]) ? "int" : "float") : typeof items[0]?.[1] === "boolean" ? "bool" : "string");
      return base("list", n, d, v(n), {
        listType: x.listType ?? "list",
        format: fmt,
        items: items.map(([name, value, disabled]) => ({ name, value, disabled: !!disabled })),
        ...strip(x),
      });
    },
    color: (n, d, x) => base("color", n, d, v(n), x),
    colorAlpha: (n, d, x) => base("color_alpha", n, d, v(n), x),
    button: (n, d, x = {}) => base("button", n, d, null, { buttonType: x.buttonType ?? "default", url: x.url ?? null, ...strip(x) }),
    font: (n, d, x) => base("font", n, d, v(n), x),
    editableList: (n, d, editableListType, filter, defaultPath, x) =>
      base("editable_list", n, d, v(n) ?? [], { editableListType, filter: filter ?? null, defaultPath: defaultPath ?? null, ...x }),
    frameRate: (n, d, x) => base("frame_rate", n, d, v(n), x),
    group: (n, d, groupType, properties, x) => base("group", n, d, groupType === "checkable" ? !!v(n) : null, { groupType, properties, ...x }),
  };
}
const OWN = new Set(["step", "suffix", "slider", "textType", "monospace", "listType", "format", "buttonType", "url"]);
function strip(x) {
  const o = {};
  for (const [k, val] of Object.entries(x ?? {})) if (!OWN.has(k)) o[k] = val;
  return o;
}
const hide = (p, visible) => ((p.visible = !!visible), p);
const able = (p, enabled) => ((p.enabled = !!enabled), p);
const ld = (p, text) => ((p.longDescription = text), p);

const IMAGE_FILTER = "All Image Files (*.bmp *.tga *.png *.jpeg *.jpg *.jxr *.gif *.psd *.webp);;All Files (*.*)";
const MEDIA_FILTER =
  "Media Files (*.mp4 *.m4v *.ts *.mov *.mxf *.flv *.mkv *.avi *.mp3 *.ogg *.aac *.wav *.gif *.webm);;Video Files (*.mp4 *.m4v *.ts *.mov *.mxf *.flv *.mkv *.avi *.gif *.webm);;Audio Files (*.mp3 *.aac *.ogg *.wav);;All Files (*.*)";
const WINDOW_PRIORITY = [
  ["Window title must match", 0],
  ["Match title, otherwise find window of same type", 1],
  ["Match title, otherwise find window of same executable", 2],
];
const windowItems = () => [["", ""], ...WINDOWS.map((w) => [w.name, w.value])];

// ------------------------------------------------------------------ sources
const SOURCE_PROPS = {
  monitor_capture(b, s) {
    return [
      b.list("method", "Capture Method", [
        ["Automatic", 0],
        ["DXGI Desktop Duplication", 1],
        ["Windows 10 (1903 and up)", 2],
      ]),
      b.list("monitor_id", "Display", MONITORS.map((m) => [m.name, m.id])),
      b.bool("capture_cursor", "Capture Cursor"),
      b.bool("force_sdr", "Force SDR"),
    ];
  },

  window_capture(b, s) {
    const bitblt = s.method === 1;
    return [
      b.list("window", "Window", windowItems()),
      b.list("method", "Capture Method", [
        ["Automatic", 0],
        ["BitBlt (Windows 7 and up)", 1],
        ["Windows 10 (1903 and up)", 2],
      ]),
      b.list("priority", "Window Match Priority", WINDOW_PRIORITY),
      b.bool("cursor", "Capture Cursor"),
      hide(b.bool("client_area", "Client Area"), !bitblt),
      hide(b.bool("force_sdr", "Force SDR"), !bitblt),
      hide(ld(b.bool("compatibility", "Multi-adapter Compatibility"), "Use this if the window is rendered on a different GPU than OBS."), bitblt),
    ];
  },

  game_capture(b, s) {
    const specific = s.capture_mode === "window";
    return [
      b.list("capture_mode", "Mode", [
        ["Capture any fullscreen application", "any_fullscreen"],
        ["Capture specific window", "window"],
        ["Capture foreground window with hotkey", "hotkey"],
      ]),
      hide(b.list("window", "Window", windowItems()), specific),
      hide(b.list("priority", "Window Match Priority", WINDOW_PRIORITY), specific),
      b.bool("sli_compatibility", "SLI/Crossfire Capture Mode (Slow)"),
      b.bool("capture_audio", "Capture Audio (BETA)"),
      b.bool("allow_transparency", "Allow Transparency"),
      hide(b.bool("premultiplied_alpha", "Premultiplied Alpha"), !!s.allow_transparency),
      b.bool("limit_framerate", "Limit capture framerate"),
      b.bool("capture_cursor", "Capture Cursor"),
      b.bool("anti_cheat_hook", "Use anti-cheat compatibility hook"),
      b.bool("capture_overlays", "Capture third-party overlays (such as steam)"),
      b.list("hook_rate", "Hook Rate", [
        ["Slow", 0],
        ["Normal (recommended)", 1],
        ["Fast", 2],
        ["Fastest", 3],
      ]),
      b.list("rgb10a2_space", "RGB10A2 Color Space", [
        ["sRGB", "srgb"],
        ["Rec. 2100 (PQ)", "2100pq"],
      ]),
    ];
  },

  dshow_input(b, s) {
    const custom = s.res_type === 1;
    const active = s.active !== false;
    return [
      b.list("video_device_id", "Device", [["", ""], ...VIDEO_DEVICES.map((d) => [d.name, d.id])]),
      b.button("activate", active ? "Deactivate" : "Activate"),
      b.button("video_config", "Configure Video"),
      b.button("xbar_config", "Configure Crossbar"),
      b.bool("deactivate_when_not_showing", "Deactivate when not showing"),
      b.list("res_type", "Resolution/FPS Type", [
        ["Device Default", 0],
        ["Custom", 1],
      ]),
      hide(
        b.list(
          "resolution",
          "Resolution",
          ["1920x1080", "1600x896", "1280x720", "960x540", "848x480", "640x360", "640x480"].map((r) => [r, r]),
          { listType: "editable", format: "string" },
        ),
        custom,
      ),
      able(
        b.frameRate("fps", "FPS", {
          items: [
            { name: "Match Output FPS", value: "match", disabled: false },
            { name: "60", value: "60/1", disabled: false },
            { name: "30", value: "30/1", disabled: false },
            { name: "24", value: "24/1", disabled: false },
            { name: "15", value: "15/1", disabled: false },
          ],
          min: 1,
          max: 60,
        }),
        custom,
      ),
      able(
        b.list("video_format", "Video Format", [
          ["Any", 0],
          ["NV12", 2],
          ["YUY2", 3],
          ["MJPEG", 400],
          ["H264", 401],
        ]),
        custom,
      ),
      b.list("color_space", "Color Space", [
        ["Default", "default"],
        ["Rec. 709", "709"],
        ["Rec. 601", "601"],
      ]),
      b.list("color_range", "Color Range", [
        ["Default", "default"],
        ["Limited", "partial"],
        ["Full", "full"],
      ]),
      b.list("buffering", "Buffering", [
        ["Auto-Detect", 0],
        ["Enable", 1],
        ["Disable", 2],
      ]),
      b.bool("hw_decode", "Use hardware decoding when available"),
      b.bool("flip_vertically", "Flip Vertically"),
      b.bool("autorotation", "Apply rotation data from camera (if any)"),
      b.list("audio_output_mode", "Audio Output Mode", [
        ["Capture audio only", 0],
        ["Output desktop audio (DirectSound)", 1],
        ["Output desktop audio (WaveOut)", 2],
      ]),
      b.bool("use_custom_audio_device", "Use custom audio device"),
      hide(b.list("audio_device_id", "Audio Device", [["", ""], ...AUDIO_INPUTS.map((d) => [d.name, d.id])]), !!s.use_custom_audio_device),
    ];
  },

  text_gdiplus_v3(b, s) {
    const fromFile = !!s.read_from_file;
    return [
      b.bool("read_from_file", "Read from file"),
      hide(b.path("file", "Text File", "file", "Text Files (*.txt);;All Files (*.*)", `${HOME}\\Documents`), fromFile),
      hide(b.text("text", "Text", { textType: "multiline" }), !fromFile),
      b.bool("antialiasing", "Enable Antialiasing"),
      b.list("transform", "Text Transform", [
        ["None", 0],
        ["Uppercase", 1],
        ["Lowercase", 2],
        ["Start Case", 3],
      ]),
      b.bool("vertical", "Vertical"),
      b.font("font", "Font"),
      b.color("color", "Color"),
      b.int("opacity", "Opacity", 0, 100, { slider: true, suffix: "%" }),
      b.group("gradient", "Gradient", "checkable", [
        b.color("gradient_color", "Gradient Color"),
        b.int("gradient_opacity", "Gradient Opacity", 0, 100, { slider: true, suffix: "%" }),
        b.float("gradient_dir", "Gradient Direction", 0, 360, { step: 0.1, slider: true, suffix: "°" }),
      ]),
      b.color("bk_color", "Background Color"),
      b.int("bk_opacity", "Background Opacity", 0, 100, { slider: true, suffix: "%" }),
      b.list("align", "Alignment", [
        ["Left", "left"],
        ["Center", "center"],
        ["Right", "right"],
      ]),
      b.list("valign", "Vertical Alignment", [
        ["Top", "top"],
        ["Center", "center"],
        ["Bottom", "bottom"],
      ]),
      b.group("outline", "Outline", "checkable", [
        b.int("outline_size", "Outline Size", 1, 20),
        b.color("outline_color", "Outline Color"),
        b.int("outline_opacity", "Outline Opacity", 0, 100, { slider: true, suffix: "%" }),
      ]),
      b.group("chatlog", "Chat log mode", "checkable", [b.int("chatlog_lines", "Chat log lines", 1, 1000)]),
      b.group("extents", "Use Custom Text Extents", "checkable", [
        b.int("extents_cx", "Width", 32, 8000),
        b.int("extents_cy", "Height", 32, 8000),
        b.bool("extents_wrap", "Wrap"),
      ]),
    ];
  },

  text_ft2_source_v2(b, s) {
    const fromFile = !!s.from_file;
    return [
      b.font("font", "Font"),
      hide(b.text("text", "Text", { textType: "multiline" }), !fromFile),
      b.bool("from_file", "Read from file"),
      hide(b.bool("log_mode", "Chat log mode (last 6 lines)"), fromFile),
      hide(b.int("log_lines", "Chat log lines", 1, 1000), fromFile && !!s.log_mode),
      hide(b.path("text_file", "Text File (UTF-8 or UTF-16)", "file", "Text Files (*.txt);;All Files (*.*)"), fromFile),
      b.color("color1", "Color 1"),
      b.color("color2", "Color 2"),
      b.bool("outline", "Outline"),
      b.bool("drop_shadow", "Drop Shadow"),
      b.int("custom_width", "Custom text width", 0, 4096),
      b.bool("word_wrap", "Word Wrap"),
      b.bool("antialiasing", "Enable Antialiasing"),
    ];
  },

  image_source(b) {
    return [
      b.path("file", "Image File", "file", IMAGE_FILTER, `${HOME}\\Pictures`),
      b.bool("unload", "Unload image when not showing"),
      b.bool("linear_alpha", "Apply alpha in linear space"),
    ];
  },

  color_source_v3(b) {
    return [b.colorAlpha("color", "Color"), b.int("width", "Width", 0, 4096), b.int("height", "Height", 0, 4096)];
  },

  slideshow_v2(b, s) {
    return [
      b.list("playback_behavior", "Visibility Behavior", [
        ["Always play even when not visible", "always_play"],
        ["Stop when not visible, restart when visible", "stop_restart"],
        ["Pause when not visible, unpause when visible", "pause_unpause"],
      ]),
      b.list("slide_mode", "Slide Mode", [
        ["Automatic", "mode_auto"],
        ["Manual (Use hotkeys to control slideshow)", "mode_manual"],
      ]),
      b.list("transition", "Transition", [
        ["Cut", "cut"],
        ["Fade", "fade"],
        ["Swipe", "swipe"],
        ["Slide", "slide"],
      ]),
      b.int("slide_time", "Time Between Slides", 50, 3600000, { suffix: " ms" }),
      hide(b.int("transition_speed", "Transition Speed", 0, 3600000, { suffix: " ms" }), s.transition !== "cut"),
      b.bool("loop", "Loop"),
      b.bool("hide", "Hide when slideshow is done"),
      b.bool("randomize", "Randomize Playback"),
      b.list(
        "use_custom_size",
        "Bounding Size/Aspect Ratio",
        ["Automatic", "16:9", "16:10", "4:3", "1:1", "1920x1080", "1280x720"].map((r) => [r, r]),
        { listType: "editable", format: "string" },
      ),
      b.editableList("files", "Image Files", "files_and_urls", IMAGE_FILTER, `${HOME}\\Pictures`),
    ];
  },

  ffmpeg_source(b, s) {
    const local = s.is_local_file !== false;
    return [
      b.bool("is_local_file", "Local File"),
      hide(b.path("local_file", "Local File", "file", MEDIA_FILTER, `${HOME}\\Videos`), local),
      hide(b.bool("looping", "Loop"), local),
      hide(b.int("buffering_mb", "Network Buffering", 0, 16, { slider: true, suffix: " MB" }), !local),
      hide(b.text("input", "Input"), !local),
      hide(b.text("input_format", "Input Format"), !local),
      hide(b.int("reconnect_delay_sec", "Reconnect Delay", 1, 60, { suffix: " S" }), !local),
      b.bool("restart_on_activate", "Restart playback when source becomes active"),
      b.bool("close_when_inactive", "Close file when inactive"),
      hide(b.int("speed_percent", "Speed", 1, 200, { slider: true, suffix: "%" }), local),
      b.bool("hw_decode", "Use hardware decoding when available"),
      b.bool("clear_on_media_end", "Show nothing when playback ends"),
      b.list("color_range", "YUV Color Range", [
        ["Auto", 0],
        ["Limited", 1],
        ["Full", 2],
      ]),
      b.bool("linear_alpha", "Apply alpha in linear space"),
      hide(b.bool("seekable", "Seekable"), !local),
      b.text("ffmpeg_options", "FFmpeg Options"),
    ];
  },

  browser_source(b, s) {
    const local = !!s.is_local_file;
    return [
      b.bool("is_local_file", "Local file"),
      hide(b.path("local_file", "Local file", "file", "HTML Files (*.html *.htm);;All Files (*.*)"), local),
      hide(b.text("url", "URL"), !local),
      b.int("width", "Width", 1, 8192),
      b.int("height", "Height", 1, 8192),
      b.group("fps_custom", "Use custom frame rate", "checkable", [b.int("fps", "FPS", 1, 60)]),
      b.bool("reroute_audio", "Control audio via OBS"),
      b.text("css", "Custom CSS", { textType: "multiline", monospace: true }),
      b.bool("shutdown", "Shutdown source when not visible"),
      b.bool("restart_when_active", "Refresh browser when scene becomes active"),
      b.list("webpage_control_level", "Page permissions", [
        ["No access to OBS", 0],
        ["Read access to status information of OBS", 1],
        ["Read access to user information (current Scene Collection, Transitions)", 2],
        ["Basic access to OBS (Save replay buffer, etc.)", 3],
        ["Advanced access to OBS (Change scenes, Start/Stop replay buffer, etc.)", 4],
        ["Full access to OBS (Start/Stop streaming without warning, etc.)", 5],
      ]),
      b.button("refreshnocache", "Refresh cache of current page"),
    ];
  },

  wasapi_input_capture(b) {
    return [
      b.list("device_id", "Device", [["Default", "default"], ...AUDIO_INPUTS.map((d) => [d.name, d.id])]),
      b.bool("use_device_timing", "Use Device Timestamps"),
    ];
  },
  wasapi_output_capture(b) {
    return [
      b.list("device_id", "Device", [["Default", "default"], ...AUDIO_OUTPUTS.map((d) => [d.name, d.id])]),
      b.bool("use_device_timing", "Use Device Timestamps"),
    ];
  },
  wasapi_process_output_capture(b) {
    return [b.list("window", "Window", windowItems()), b.list("priority", "Window Match Priority", WINDOW_PRIORITY)];
  },
  audio_line(b) {
    return [b.bool("startjack", "Start JACK Server")];
  },
  scene() {
    return [];
  },
};

// ------------------------------------------------------------------ filters
const keyColorItems = (withRed) => [
  ["Green", "green"],
  ["Blue", "blue"],
  ...(withRed ? [["Red", "red"]] : []),
  ["Magenta", "magenta"],
  ["Custom", "custom"],
];

const FILTER_PROPS = {
  crop_filter(b, s) {
    const rel = s.relative !== false;
    return [
      b.bool("relative", "Relative"),
      b.int("left", "Left", -8192, 8192),
      b.int("top", "Top", -8192, 8192),
      hide(b.int("right", "Right", -8192, 8192), rel),
      hide(b.int("bottom", "Bottom", -8192, 8192), rel),
      hide(b.int("cx", "Width", 0, 8192), !rel),
      hide(b.int("cy", "Height", 0, 8192), !rel),
    ];
  },
  color_filter_v2(b) {
    return [
      b.float("gamma", "Gamma", -3, 3, { slider: true }),
      b.float("contrast", "Contrast", -4, 4, { slider: true }),
      b.float("brightness", "Brightness", -1, 1, { slider: true, step: 0.0001 }),
      b.float("saturation", "Saturation", -1, 5, { slider: true }),
      b.float("hue_shift", "Hue Shift", -180, 180, { slider: true }),
      b.float("opacity", "Opacity", 0, 1, { slider: true, step: 0.0001 }),
      b.color("color_multiply", "Color Multiply"),
      b.color("color_add", "Color Add"),
    ];
  },
  chroma_key_filter_v2(b, s) {
    return [
      b.list("key_color_type", "Key Color Type", keyColorItems(false)),
      hide(b.color("key_color", "Key Color"), s.key_color_type === "custom"),
      b.int("similarity", "Similarity", 1, 1000, { slider: true }),
      b.int("smoothness", "Smoothness", 1, 1000, { slider: true }),
      b.int("spill", "Key Color Spill Reduction", 1, 1000, { slider: true }),
      b.float("opacity", "Opacity", 0, 1, { slider: true, step: 0.0001 }),
      b.float("contrast", "Contrast", -4, 4, { slider: true }),
      b.float("brightness", "Brightness", -1, 1, { slider: true, step: 0.0001 }),
      b.float("gamma", "Gamma", -1, 1, { slider: true }),
    ];
  },
  color_key_filter_v2(b, s) {
    return [
      b.list("key_color_type", "Key Color Type", keyColorItems(true)),
      hide(b.color("key_color", "Key Color"), s.key_color_type === "custom"),
      b.int("similarity", "Similarity", 1, 1000, { slider: true }),
      b.int("smoothness", "Smoothness", 1, 1000, { slider: true }),
      b.float("opacity", "Opacity", 0, 1, { slider: true, step: 0.0001 }),
      b.float("contrast", "Contrast", -4, 4, { slider: true }),
      b.float("brightness", "Brightness", -1, 1, { slider: true, step: 0.0001 }),
      b.float("gamma", "Gamma", -1, 1, { slider: true }),
    ];
  },
  luma_key_filter_v2(b) {
    return [
      b.float("luma_max", "Luma Max", 0, 1, { slider: true, step: 0.0001 }),
      b.float("luma_max_smooth", "Luma Max Smooth", 0, 1, { slider: true, step: 0.0001 }),
      b.float("luma_min", "Luma Min", 0, 1, { slider: true, step: 0.0001 }),
      b.float("luma_min_smooth", "Luma Min Smooth", 0, 1, { slider: true, step: 0.0001 }),
    ];
  },
  mask_filter_v2(b, s) {
    const colorType = String(s.type).startsWith("mask_color");
    return [
      b.list("type", "Type", [
        ["Alpha Mask (Color Channel)", "mask_color_alpha"],
        ["Alpha Mask (Alpha Channel)", "mask_alpha_alpha"],
        ["Blend (Multiply)", "blend_multiply"],
        ["Blend (Addition)", "blend_addition"],
        ["Blend (Subtraction)", "blend_subtraction"],
      ]),
      b.path("image_path", "Path", "file", IMAGE_FILTER, `${HOME}\\Pictures`),
      hide(b.color("color", "Color"), colorType),
      hide(b.float("opacity", "Opacity", 0, 1, { slider: true, step: 0.0001 }), colorType),
      b.bool("stretch", "Stretch Image (discard image aspect ratio)"),
    ];
  },
  sharpness_filter_v2(b) {
    return [b.float("sharpness", "Sharpness", 0, 1, { slider: true, step: 0.0001 })];
  },
  scroll_filter(b, s) {
    return [
      b.float("speed_x", "Horizontal Speed", -500, 500, { slider: true, step: 1 }),
      b.float("speed_y", "Vertical Speed", -500, 500, { slider: true, step: 1 }),
      b.bool("limit_cx", "Limit Width"),
      hide(b.int("cx", "Width", 1, 8192), !!s.limit_cx),
      b.bool("limit_cy", "Limit Height"),
      hide(b.int("cy", "Height", 1, 8192), !!s.limit_cy),
      b.bool("loop", "Loop"),
    ];
  },
  scale_filter(b) {
    return [
      b.list("sampling", "Scale Filtering", [
        ["Point", "point"],
        ["Bilinear", "bilinear"],
        ["Bicubic", "bicubic"],
        ["Lanczos", "lanczos"],
        ["Area", "area"],
      ]),
      b.list(
        "resolution",
        "Resolution",
        ["None", "Base (Canvas) Resolution", "16:9", "16:10", "4:3", "1:1", "1920x1080", "1280x720", "854x480"].map((r) => [r, r]),
        { listType: "editable", format: "string" },
      ),
      b.bool("undistort", "Undistort center of image when scaling ultrawide"),
    ];
  },
  gpu_delay(b) {
    return [b.int("delay_ms", "Delay", 0, 500, { suffix: " ms" })];
  },
  async_delay_filter(b) {
    return [b.int("delay_ms", "Delay", 0, 20000, { suffix: " ms" })];
  },
  gain_filter(b) {
    return [b.float("db", "Gain", -30, 30, { slider: true, step: 0.1, suffix: " dB" })];
  },
  noise_suppress_filter_v2(b, s) {
    const nv = String(s.method).startsWith("nvafx");
    return [
      b.list("method", "Method", [
        ["Speex (low CPU usage, low quality)", "speex"],
        ["RNNoise (good quality, more CPU usage)", "rnnoise"],
        ["NVIDIA Noise Removal", "nvafx_denoiser"],
        ["NVIDIA Room Echo Removal", "nvafx_dereverb"],
        ["NVIDIA Noise Removal + Room Echo Removal", "nvafx_dereverb_denoiser"],
      ]),
      hide(b.int("suppress_level", "Suppression Level", -60, 0, { slider: true, suffix: " dB" }), s.method === "speex"),
      hide(b.float("intensity", "Suppression Intensity", 0, 1, { slider: true }), nv),
      hide(
        b.button("nvafx_download", "Download NVIDIA Audio Effects", { buttonType: "url", url: "https://www.nvidia.com/broadcast-sdk-resources" }),
        nv,
      ),
    ];
  },
  noise_gate_filter(b) {
    return [
      b.float("close_threshold", "Close Threshold", -96, 0, { slider: true, step: 0.1, suffix: " dB" }),
      b.float("open_threshold", "Open Threshold", -96, 0, { slider: true, step: 0.1, suffix: " dB" }),
      b.int("attack_time", "Attack Time", 0, 10000, { suffix: " ms" }),
      b.int("hold_time", "Hold Time", 0, 10000, { suffix: " ms" }),
      b.int("release_time", "Release Time", 0, 10000, { suffix: " ms" }),
    ];
  },
  compressor_filter(b, s, ctx) {
    return [
      b.float("ratio", "Ratio", 1, 32, { slider: true, step: 0.5, suffix: ":1" }),
      b.float("threshold", "Threshold", -60, 0, { slider: true, step: 0.1, suffix: " dB" }),
      b.int("attack_time", "Attack", 1, 500, { suffix: " ms" }),
      b.int("release_time", "Release", 1, 1000, { suffix: " ms" }),
      b.float("output_gain", "Output Gain", -32, 32, { slider: true, step: 0.1, suffix: " dB" }),
      b.list("sidechain_source", "Sidechain/Ducking Source", [
        ["None", "none"],
        ...(ctx.sources ?? []).filter((x) => x.audio && x.uuid !== ctx.selfUuid).map((x) => [x.name, x.name]),
      ]),
    ];
  },
  limiter_filter(b) {
    return [
      b.float("threshold", "Threshold", -60, 0, { slider: true, step: 0.1, suffix: " dB" }),
      b.int("release_time", "Release", 1, 1000, { suffix: " ms" }),
    ];
  },
  expander_filter(b) {
    return [
      b.list("presets", "Presets", [
        ["Expander", "expander"],
        ["Gate", "gate"],
      ]),
      b.float("ratio", "Ratio", 1, 20, { slider: true, step: 0.1, suffix: ":1" }),
      b.float("threshold", "Threshold", -60, 0, { slider: true, step: 0.1, suffix: " dB" }),
      b.int("attack_time", "Attack", 1, 100, { suffix: " ms" }),
      b.int("release_time", "Release", 1, 1000, { suffix: " ms" }),
      b.float("output_gain", "Output Gain", -32, 32, { slider: true, step: 0.1, suffix: " dB" }),
      b.list("detector", "Detection", [
        ["RMS", "RMS"],
        ["Peak", "peak"],
      ]),
    ];
  },
  upward_compressor_filter(b) {
    return [
      b.float("ratio", "Ratio", 0, 1, { slider: true, step: 0.01, suffix: ":1" }),
      b.float("threshold", "Threshold", -60, 0, { slider: true, step: 0.1, suffix: " dB" }),
      b.int("attack_time", "Attack", 1, 100, { suffix: " ms" }),
      b.int("release_time", "Release", 1, 1000, { suffix: " ms" }),
      b.float("output_gain", "Output Gain", -32, 32, { slider: true, step: 0.1, suffix: " dB" }),
      b.int("knee_width", "Knee Width", 0, 20, { suffix: " dB" }),
    ];
  },
  basic_eq_filter(b) {
    return [
      b.float("low", "Low", -20, 20, { slider: true, step: 0.1, suffix: " dB" }),
      b.float("mid", "Mid", -20, 20, { slider: true, step: 0.1, suffix: " dB" }),
      b.float("high", "High", -20, 20, { slider: true, step: 0.1, suffix: " dB" }),
    ];
  },
  invert_polarity_filter() {
    return [];
  },
  vst_filter(b, s) {
    const plugins = [
      ["{Please select a VST plug-in}", ""],
      ["ReaComp (reacomp-standalone.dll)", "C:\\Program Files\\VSTPlugins\\ReaPlugs\\reacomp-standalone.dll"],
      ["ReaEQ (reaeq-standalone.dll)", "C:\\Program Files\\VSTPlugins\\ReaPlugs\\reaeq-standalone.dll"],
      ["TDR Nova (TDR Nova.dll)", "C:\\Program Files\\Steinberg\\VstPlugins\\TDR Nova.dll"],
    ];
    const has = !!s.plugin_path;
    return [
      b.info("vst_warning", "VST 2.x plug-ins are deprecated and may stop working in a future version. Consider VST3 or CLAP alternatives.", "warning"),
      b.list("plugin_path", "VST 2.x Plug-in", plugins),
      able(b.button("open_vst_settings", "Open Plug-in Interface"), has),
      able(b.button("close_vst_settings", "Close Plug-in Interface"), has),
      b.bool("open_when_active_vst_settings", "Open interface when source is active"),
      b.button("vst_help", "Help", { buttonType: "url", url: "https://obsproject.com/kb/vst-plugins" }),
    ];
  },
};

// ------------------------------------------------------------------ transitions
const DIRECTIONS = [
  ["Left", "left"],
  ["Right", "right"],
  ["Up", "up"],
  ["Down", "down"],
];
const TRANSITION_PROPS = {
  cut_transition: () => [],
  fade_transition: () => [],
  slide_transition: (b) => [b.list("direction", "Direction", DIRECTIONS)],
  swipe_transition: (b) => [b.list("direction", "Direction", DIRECTIONS), b.bool("swipe_in", "Swipe In")],
  obs_stinger_transition(b, s) {
    const frames = s.tp_type === "frame";
    return [
      b.path("path", "Video File", "file", MEDIA_FILTER, `${HOME}\\Videos`),
      b.list("tp_type", "Transition Point Type", [
        ["Time (milliseconds)", "time"],
        ["Frame", "frame"],
      ]),
      hide(b.int("transition_point", "Transition Point", 0, 120000, { suffix: " ms" }), !frames),
      hide(b.int("transition_point_frame", "Transition Point", 0, 120000, { suffix: " frames" }), frames),
      b.bool("hw_decode", "Use hardware decoding when available"),
      b.bool("preload", "Preload video to RAM"),
      b.group("track_matte_enabled", "Use a Track Matte", "checkable", [
        b.list("track_matte_layout", "Layout", [
          ["Same file, side-by-side (stinger then track matte)", 0],
          ["Same file, stacked (stinger on top, track matte on bottom)", 1],
          ["Separate file (warning: matte can get out of sync)", 2],
          ["Mask only", 3],
        ]),
        b.bool("invert_matte", "Invert Matte"),
      ]),
      b.list("audio_monitoring", "Audio Monitoring", [
        ["Monitor Off", 0],
        ["Monitor Only (mute output)", 1],
        ["Monitor and Output", 2],
      ]),
      b.list("audio_fade_style", "Audio Fade Style", [
        ["Fade out to transition point then fade in", 0],
        ["Crossfade", 1],
      ]),
    ];
  },
  wipe_transition(b) {
    const lumas = [
      "barndoor-botleft",
      "barndoor-h",
      "barndoor-topleft",
      "barndoor-v",
      "blinds-h",
      "box-botleft",
      "box-botright",
      "box-topleft",
      "box-topright",
      "burst",
      "checkerboard-small",
      "circles",
      "clock",
      "cloud",
      "curtain",
      "fan",
      "fractal",
      "iris",
      "linear-h",
      "linear-topleft",
      "linear-topright",
      "linear-v",
      "parallel-zigzag-h",
      "parallel-zigzag-v",
      "sinus9",
      "spiral",
      "square",
      "squares",
      "stripes",
      "strips-h",
      "strips-v",
      "watercolor",
      "zigzag-h",
      "zigzag-v",
    ];
    const title = (n) => n.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return [
      b.list("luma_image", "Image", lumas.map((l) => [title(l), `${l}.png`])),
      b.float("luma_softness", "Softness", 0, 1, { slider: true }),
      b.bool("luma_invert", "Invert"),
    ];
  },
};

// ------------------------------------------------------------------ encoders
const nvencProps = (profiles) => (b, s) => {
  const rc = s.rate_control;
  return [
    b.list("rate_control", "Rate Control", [
      ["CBR", "CBR"],
      ["VBR", "VBR"],
      ["CQP", "CQP"],
      ["Lossless", "lossless"],
    ]),
    hide(b.int("bitrate", "Bitrate", 50, 300000, { step: 50, suffix: " Kbps" }), rc === "CBR" || rc === "VBR"),
    hide(b.int("max_bitrate", "Maximum Bitrate", 50, 300000, { step: 50, suffix: " Kbps" }), rc === "VBR"),
    hide(b.int("cqp", "CQ Level", 1, 51), rc === "CQP"),
    b.int("keyint_sec", "Keyframe Interval (0 = auto)", 0, 10, { suffix: " s" }),
    b.list("preset2", "Preset", [
      ["P1: Fastest (Lowest Quality)", "p1"],
      ["P2: Faster (Lower Quality)", "p2"],
      ["P3: Fast (Low Quality)", "p3"],
      ["P4: Medium (Medium Quality)", "p4"],
      ["P5: Slow (Good Quality)", "p5"],
      ["P6: Slower (Better Quality)", "p6"],
      ["P7: Slowest (Best Quality)", "p7"],
    ]),
    b.list("tune", "Tuning", [
      ["High Quality", "hq"],
      ["Low Latency", "ll"],
      ["Ultra Low Latency", "ull"],
    ]),
    b.list("multipass", "Multipass Mode", [
      ["Single Pass", "disabled"],
      ["Two Passes (Quarter Resolution)", "qres"],
      ["Two Passes (Full Resolution)", "fullres"],
    ]),
    b.list("profile", "Profile", profiles),
    ld(b.bool("lookahead", "Look-ahead"), "Enables dynamic B-frames. Improves quality at the cost of more GPU usage."),
    ld(b.bool("psycho_aq", "Adaptive Quantization"), "Enables Temporal Adaptive Quantization, which improves quality in motion scenes."),
    b.int("gpu", "GPU", 0, 8),
    b.int("bf", "Max B-frames", 0, 4),
    b.bool("repeat_headers", "Repeat headers"),
  ];
};
const ENCODER_PROPS = {
  jim_nvenc: nvencProps([
    ["high", "high"],
    ["main", "main"],
    ["baseline", "baseline"],
  ]),
  jim_hevc_nvenc: nvencProps([
    ["main", "main"],
    ["main10", "main10"],
  ]),
  jim_av1_nvenc: nvencProps([["main", "main"]]),
  obs_x264(b, s) {
    const rc = s.rate_control;
    return [
      b.list("rate_control", "Rate Control", [
        ["CBR", "CBR"],
        ["ABR", "ABR"],
        ["VBR", "VBR"],
        ["CRF", "CRF"],
      ]),
      hide(b.int("bitrate", "Bitrate", 50, 10000000, { step: 50, suffix: " Kbps" }), rc !== "CRF"),
      hide(b.bool("use_bufsize", "Use Custom Buffer Size"), rc !== "CRF"),
      hide(b.int("buffer_size", "Buffer Size", 0, 10000000, { suffix: " Kb" }), rc !== "CRF" && !!s.use_bufsize),
      hide(b.int("crf", "CRF", 0, 51), rc === "CRF" || rc === "VBR"),
      b.int("keyint_sec", "Keyframe Interval (0 = auto)", 0, 20, { suffix: " s" }),
      b.list(
        "preset",
        "CPU Usage Preset (higher = less CPU)",
        ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow", "placebo"].map((p) => [p, p]),
      ),
      b.list("profile", "Profile", [
        ["(None)", ""],
        ["baseline", "baseline"],
        ["main", "main"],
        ["high", "high"],
      ]),
      b.list(
        "tune",
        "Tune",
        [["(None)", ""], ...["film", "animation", "grain", "stillimage", "psnr", "ssim", "fastdecode", "zerolatency"].map((t) => [t, t])],
      ),
      b.text("x264opts", "x264 Options (separated by space)"),
    ];
  },
  obs_qsv11_v2(b, s) {
    const rc = s.rate_control;
    return [
      b.list("target_usage", "Target Usage", [
        ["TU1: Slowest (Best Quality)", "TU1"],
        ["TU2: Slower", "TU2"],
        ["TU3: Slow", "TU3"],
        ["TU4: Balanced (Medium Quality)", "TU4"],
        ["TU5: Fast", "TU5"],
        ["TU6: Faster", "TU6"],
        ["TU7: Fastest (Best Speed)", "TU7"],
      ]),
      b.list("profile", "Profile", [
        ["high", "high"],
        ["main", "main"],
        ["baseline", "baseline"],
      ]),
      b.int("keyint_sec", "Keyframe Interval (0 = auto)", 0, 20, { suffix: " s" }),
      b.list("rate_control", "Rate Control", [
        ["CBR", "CBR"],
        ["VBR", "VBR"],
        ["CQP", "CQP"],
        ["ICQ", "ICQ"],
      ]),
      hide(b.int("bitrate", "Bitrate", 50, 10000000, { step: 50, suffix: " Kbps" }), rc === "CBR" || rc === "VBR"),
      hide(b.int("max_bitrate", "Max Bitrate", 50, 10000000, { step: 50, suffix: " Kbps" }), rc === "VBR"),
      hide(b.int("cqp", "QP", 1, 51), rc === "CQP"),
      hide(b.int("icq_quality", "ICQ Quality", 1, 51), rc === "ICQ"),
      b.list("latency", "Latency", [
        ["Normal", "normal"],
        ["Low", "low"],
        ["Ultra Low", "ultra-low"],
      ]),
      b.int("bframes", "B-frames", 0, 3),
    ];
  },
  ffmpeg_aac(b) {
    return [b.list("bitrate", "Bitrate", [64, 96, 128, 160, 192, 224, 256, 288, 320].map((r) => [String(r), r]))];
  },
  ffmpeg_opus(b) {
    return [b.list("bitrate", "Bitrate", [64, 96, 128, 160, 192, 256, 320, 512].map((r) => [String(r), r]))];
  },
};

// ------------------------------------------------------------------ public API
const evaluate = (table, defaults) => (kind, settings, ctx = {}) => {
  const fn = table[kind];
  if (!fn) return [];
  const s = { ...defaults(kind), ...(settings ?? {}) };
  return fn(builder(s), s, ctx);
};

export const sourceProperties = evaluate(SOURCE_PROPS, sourceDefaults);
export const filterProperties = evaluate(FILTER_PROPS, filterDefaults);
export const transitionProperties = evaluate(TRANSITION_PROPS, transitionDefaults);
export const encoderProperties = evaluate(ENCODER_PROPS, encoderDefaults);

/** Find a property by name, searching inside groups. */
export function findProperty(props, name) {
  for (const p of props) {
    if (p.name === name) return p;
    if (p.properties) {
      const f = findProperty(p.properties, name);
      if (f) return f;
    }
  }
  return null;
}
