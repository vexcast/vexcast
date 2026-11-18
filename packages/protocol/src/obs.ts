/**
 * Vexcast protocol v2 — production model, built on libobs (the OBS Studio core).
 *
 * Mirrors `crates/vexcast-core/src/obs/model.rs` (serde camelCase).
 * Concepts and names follow OBS Studio so the UI can offer everything OBS offers.
 */

export type Uuid = string;

// ---------------------------------------------------------------- geometry

export interface Vec2 {
  x: number;
  y: number;
}

export interface Crop {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** OBS alignment bitmask: LEFT=1, RIGHT=2, TOP=4, BOTTOM=8, CENTER=0. */
export type Alignment = number;
export const ALIGN = { CENTER: 0, LEFT: 1, RIGHT: 2, TOP: 4, BOTTOM: 8 } as const;

export type BoundsType = "none" | "stretch" | "scale_inner" | "scale_outer" | "scale_to_width" | "scale_to_height" | "max_only";
export type BlendMode = "normal" | "additive" | "subtract" | "screen" | "multiply" | "lighten" | "darken";
export type BlendMethod = "default" | "srgb_off";
export type ScaleFilter = "disable" | "point" | "bicubic" | "bilinear" | "lanczos" | "area";

// ---------------------------------------------------------------- properties (generic settings UI)

export type PropertyType =
  | "bool"
  | "int"
  | "float"
  | "text"
  | "path"
  | "list"
  | "color"
  | "color_alpha"
  | "button"
  | "font"
  | "editable_list"
  | "frame_rate"
  | "group";

export interface ListItem {
  name: string;
  value: string | number | boolean | null;
  disabled: boolean;
}

/**
 * One OBS property. `value` is the current value from the object's settings
 * (font: {face, style, size, flags}; color: 0xAABBGGRR int like OBS;
 * editable_list: [{value, selected, hidden}]; frame_rate: {numerator, denominator}).
 */
export interface Property {
  name: string;
  description: string;
  longDescription: string | null;
  type: PropertyType;
  enabled: boolean;
  visible: boolean;
  value: unknown;
  // int / float
  min?: number;
  max?: number;
  step?: number;
  suffix?: string | null;
  slider?: boolean;
  // text
  textType?: "default" | "password" | "multiline" | "info";
  monospace?: boolean;
  infoType?: "normal" | "warning" | "error";
  // path
  pathType?: "file" | "file_save" | "directory";
  filter?: string | null;
  defaultPath?: string | null;
  // list
  listType?: "editable" | "list" | "radio";
  format?: "int" | "float" | "string" | "bool";
  items?: ListItem[];
  // editable_list
  editableListType?: "strings" | "files" | "files_and_urls";
  // button
  buttonType?: "default" | "url";
  url?: string | null;
  // group
  groupType?: "normal" | "checkable";
  properties?: Property[];
}

// ---------------------------------------------------------------- source types

export interface SourceType {
  id: string;
  name: string;
  kind: "input" | "filter" | "transition" | "scene";
  video: boolean;
  audio: boolean;
  async: boolean;
  /** Can be interacted with (browser source). */
  interactive: boolean;
  /** Media controls (play/pause/…). */
  controllableMedia: boolean;
  deprecated: boolean;
  /** "image" | "color" | "slideshow" | "audio_input" | "audio_output" | "desktop" | "window" | "game" | "camera" | "text" | "media" | "browser" | "process_audio" | "custom" | ... */
  icon: string;
}

// ---------------------------------------------------------------- sources, filters, scenes

export type MonitoringType = "none" | "monitor_only" | "monitor_and_output";
export type MediaState = "none" | "playing" | "opening" | "buffering" | "paused" | "stopped" | "ended" | "error";

export interface FilterInfo {
  uuid: Uuid;
  name: string;
  kind: string;
  kindName: string;
  enabled: boolean;
  settings: Record<string, unknown>;
}

export interface SourceInfo {
  uuid: Uuid;
  name: string;
  kind: string;
  kindName: string;
  /** Unversioned id (e.g. "color_source" for "color_source_v3"). */
  baseKind: string;
  settings: Record<string, unknown>;
  video: boolean;
  audio: boolean;
  async: boolean;
  interactive: boolean;
  controllableMedia: boolean;
  /** Current native size (0 when unknown / audio only). */
  width: number;
  height: number;
  enabled: boolean;
  /** Linear multiplier (OBS volume, 0..~31.6 = +30 dB, 1 = 0 dB). */
  volume: number;
  /** Volume in dB; -100 means silence (-inf). */
  volumeDb: number;
  muted: boolean;
  monitoring: MonitoringType;
  syncOffsetMs: number;
  /** 0 = full left, 0.5 = center, 1 = full right. */
  balance: number;
  /** Audio track bitmask (track 1 = bit 0 … track 6 = bit 5). */
  mixers: number;
  forceMono: boolean;
  /** Push-to-mute / push-to-talk. */
  pushToMute: boolean;
  pushToMuteDelayMs: number;
  pushToTalk: boolean;
  pushToTalkDelayMs: number;
  filters: FilterInfo[];
  /** Global audio device slot ("desktop1" | "desktop2" | "mic1".."mic4") or null. */
  globalSlot: string | null;
  mediaState: MediaState | null;
  /** Number of scenes using it. */
  refs: number;
}

export interface SceneItem {
  id: number;
  sourceUuid: Uuid;
  /** Source name (for convenience). */
  name: string;
  visible: boolean;
  locked: boolean;
  pos: Vec2;
  rot: number;
  scale: Vec2;
  alignment: Alignment;
  boundsType: BoundsType;
  boundsAlignment: Alignment;
  bounds: Vec2;
  /** Crop to bounds (OBS 30+). */
  cropToBounds: boolean;
  crop: Crop;
  blendMode: BlendMode;
  blendMethod: BlendMethod;
  scaleFilter: ScaleFilter;
  /** Source base size (before scale/crop). */
  sourceWidth: number;
  sourceHeight: number;
  isGroup: boolean;
  /** Group children (when isGroup). */
  items?: SceneItem[];
  /** Show/hide transitions. */
  showTransition: { kind: string | null; durationMs: number };
  hideTransition: { kind: string | null; durationMs: number };
}

export interface SceneInfo {
  uuid: Uuid;
  name: string;
  /** Bottom-most first (OBS order). */
  items: SceneItem[];
  /** Scene filters (effect filters applied to the whole scene). */
  filters: FilterInfo[];
  /**
   * When the vertical canvas is enabled: uuid of this scene's vertical twin (its own items/layout
   * on the 9:16 canvas, listed in AppState.verticalScenes). Edit it with the normal item endpoints.
   */
  verticalSceneUuid: Uuid | null;
}

export interface TransitionInfo {
  uuid: Uuid;
  name: string;
  kind: string;
  kindName: string;
  fixed: boolean;
  settings: Record<string, unknown>;
}

export interface SceneCollection {
  name: string;
  current: boolean;
}

// ---------------------------------------------------------------- settings (OBS "Settings" window)

export interface VideoSettings {
  baseWidth: number;
  baseHeight: number;
  outputWidth: number;
  outputHeight: number;
  fpsNum: number;
  fpsDen: number;
  downscaleFilter: "bilinear" | "area" | "bicubic" | "lanczos";
  colorFormat: "NV12" | "I420" | "I444" | "P010" | "I010" | "P216" | "P416" | "BGRA";
  colorSpace: "601" | "709" | "sRGB" | "2100PQ" | "2100HLG";
  colorRange: "partial" | "full";
  sdrWhiteLevel: number;
  hdrNominalPeakLevel: number;
  /** Second 9:16 canvas (vertical). */
  verticalEnabled: boolean;
  verticalWidth: number;
  verticalHeight: number;
}

export interface AudioDevice {
  id: string;
  name: string;
}

export interface AudioSettings {
  sampleRate: 44100 | 48000;
  channels: "mono" | "stereo" | "2.1" | "4.0" | "4.1" | "5.1" | "7.1";
  /** Global devices: device id, "default" or "disabled". */
  desktop1: string;
  desktop2: string;
  mic1: string;
  mic2: string;
  mic3: string;
  mic4: string;
  monitoringDeviceId: string;
  monitoringDeviceName: string;
  meterDecayRate: "fast" | "medium" | "slow";
  peakMeterType: "sample" | "true_peak";
  lowLatencyBuffering: boolean;
  trackNames: string[]; // 6 names
}

export interface EncoderType {
  id: string;
  name: string;
  codec: string; // "h264" | "hevc" | "av1" | "aac" | "opus" | ...
  type: "video" | "audio";
  hardware: boolean;
  deprecated: boolean;
}

export interface OutputSettings {
  mode: "simple" | "advanced";
  // --- streaming encoder
  streamEncoder: string; // e.g. "jim_nvenc" / "obs_x264"
  streamEncoderSettings: Record<string, unknown>;
  streamAudioEncoder: string; // "ffmpeg_aac"
  streamAudioBitrate: number;
  streamAudioTrack: number; // 1..6
  // --- recording
  recordingPath: string;
  recordingFormat: "mkv" | "mp4" | "mov" | "flv" | "ts" | "hybrid_mp4" | "fragmented_mp4" | "fragmented_mov";
  recordingFilenameFormat: string; // "%CCYY-%MM-%DD %hh-%mm-%ss"
  recordingEncoder: string; // "" = same as stream
  recordingEncoderSettings: Record<string, unknown>;
  recordingTracks: number; // bitmask
  recordingRescale: { width: number; height: number } | null;
  overwriteIfExists: boolean;
  autoRemux: boolean;
  splitFile: { mode: "off" | "time" | "size" | "manual"; minutes: number; megabytes: number };
  // --- replay buffer
  replayBufferEnabled: boolean;
  replayBufferSeconds: number;
  replayBufferMaxMb: number;
  // --- streaming network
  reconnect: boolean;
  reconnectRetryDelaySec: number;
  reconnectMaxRetries: number;
  streamDelaySec: number; // 0 = off
  streamDelayPreserve: boolean;
  bindIp: string; // "default"
  dynamicBitrate: boolean;
  lowLatencyMode: boolean;
}

export interface StreamService {
  name: string;
  servers: { name: string; url: string }[];
  /** Recommended maxima from rtmp-services. */
  recommended: { maxVideoBitrate?: number; maxAudioBitrate?: number; keyint?: number } | null;
  /** Ingest protocol (RTMP/RTMPS/SRT/RIST/WHIP/HLS). */
  protocol: string;
}

export interface AdvancedSettings {
  processPriority: "high" | "above_normal" | "normal" | "below_normal" | "idle";
  renderer: "d3d11" | "opengl" | "metal";
  browserHwAccel: boolean;
  hotkeyFocusBehavior: "never" | "focused" | "unfocused";
  autoRemux: boolean;
  confirmOnExit: boolean;
}

export interface Hotkey {
  id: number;
  name: string;
  description: string;
  /** Registerer: "frontend" | source/output/encoder name. */
  owner: string;
  bindings: { key: string; ctrl: boolean; shift: boolean; alt: boolean; command: boolean }[];
}

// ---------------------------------------------------------------- outputs & stats

export type OutputState = "idle" | "starting" | "active" | "reconnecting" | "stopping" | "error";

export interface Destination {
  id: Uuid;
  name: string;
  /** Service name from rtmp-services ("Twitch", "YouTube - RTMPS", …) or "Custom". */
  service: string;
  server: string;
  /** Masked in API responses; send a new value to change it. */
  streamKey: string;
  enabled: boolean;
  canvas: "horizontal" | "vertical";
  /** Optional per-destination encoder override (null = shared encoder). */
  encoderOverride: { encoder: string; settings: Record<string, unknown> } | null;
}

export interface OutputStatus {
  id: string; // destination id | "record" | "replay" | "virtualcam"
  state: OutputState;
  kbps: number;
  totalBytes: number;
  droppedFrames: number;
  totalFrames: number;
  congestion: number; // 0..1
  durationMs: number;
  error: string | null;
}

export interface Stats {
  fps: number;
  targetFps: number;
  cpu: number;
  memoryMb: number;
  diskFreeGb: number | null;
  averageRenderMs: number;
  renderSkipped: number;
  renderTotal: number;
  encodingSkipped: number;
  encodingTotal: number;
  outputs: OutputStatus[];
}

export interface EngineStatus {
  ready: boolean;
  obsVersion: string | null;
  error: string | null;
  streaming: boolean;
  streamStartedAt: number | null;
  recording: boolean;
  recordingPaused: boolean;
  recordingStartedAt: number | null;
  lastRecordingPath: string | null;
  replayBufferActive: boolean;
  virtualCamActive: boolean;
  studioMode: boolean;
  /** Rehearsal: streaming to Twitch without publishing (bandwidth test mode). */
  rehearsal: boolean;
  serverTime: number;
}

// ---------------------------------------------------------------- audio meters

export interface AudioLevel {
  sourceUuid: Uuid;
  /** Per channel, dBFS (-inf → -100). */
  magnitude: number[];
  peak: number[];
  inputPeak: number[];
}
