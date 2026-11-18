import type {
  HealthReport,
  SessionListItem,
  StreamSession,
  Macro,
  HfFile,
  HfModel,
  HubModelKind,
  HubRuntimeId,
  HubStatus,
  PiperVoice,
  AccountPlatform,
  AdvancedSettings,
  AiSettings,
  AlertEvent,
  AlertType,
  AppState,
  AudioDevice,
  AudioSettings,
  BotSettings,
  ChatConnection,
  ChatMessage,
  ChatPlatform,
  Destination,
  EncoderType,
  GeneralSettings,
  Hotkey,
  OAuthStart,
  StreamCategory,
  StreamInfo,
  OutputSettings,
  PairingInfo,
  RemoteDevice,
  Property,
  SceneItem,
  ServerEvent,
  SourceInfo,
  SourceType,
  Stats,
  StreamService,
  TransitionInfo,
  UpdateInfo,
  Uuid,
  VideoSettings,
  WidgetSettings,
} from "./types";
import { API_PREFIX } from "./types";

export interface ClientOptions {
  /** e.g. "http://127.0.0.1:7420" */
  baseUrl: string;
  token?: string;
  /** Custom WebSocket implementation (React Native provides a global one). */
  WebSocketImpl?: typeof WebSocket;
  /** Remote apps: a stable id + a readable name, so the PC can list, name and block this device. */
  device?: { id: string; name: string };
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Listener = (event: ServerEvent) => void;

export type TransformAction =
  | "reset"
  | "fit"
  | "stretch"
  | "center"
  | "center_h"
  | "center_v"
  | "flip_h"
  | "flip_v"
  | "rotate_cw"
  | "rotate_ccw"
  | "rotate_180";

export type OrderAction = "up" | "down" | "top" | "bottom";
export type MediaAction = "play" | "pause" | "restart" | "stop" | "next" | "previous";

/**
 * Typed client for the Vexcast core API (v2, libobs). Works in browsers,
 * Tauri webviews, React Native and Node 18+.
 */
export class VexcastClient {
  readonly baseUrl: string;
  token: string | undefined;
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private connListeners = new Set<(connected: boolean) => void>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private WS: typeof WebSocket;
  private device: { id: string; name: string } | undefined;

  constructor(opts: ClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.token = opts.token;
    this.WS = opts.WebSocketImpl ?? (globalThis as any).WebSocket;
    this.device = opts.device;
  }

  /** Headers identifying the device (remote apps). */
  private deviceHeaders(h: Record<string, string>) {
    if (this.device) {
      h["X-Vexcast-Device"] = this.device.id;
      h["X-Vexcast-Device-Name"] = encodeURIComponent(this.device.name);
    }
    return h;
  }

  // ------------------------------------------------------------------ http
  url(path: string, withToken = false): string {
    const u = `${this.baseUrl}${path}`;
    if (!withToken || !this.token) return u;
    let out = u + (u.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(this.token);
    if (this.device) out += `&device=${encodeURIComponent(this.device.id)}&device_name=${encodeURIComponent(this.device.name)}`;
    return out;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    this.deviceHeaders(headers);
    const res = await fetch(`${this.baseUrl}${API_PREFIX}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      let msg = res.statusText;
      try {
        const j = await res.json();
        msg = j.error ?? msg;
      } catch {
        /* ignore */
      }
      throw new ApiError(res.status, msg);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  get = <T>(p: string) => this.request<T>("GET", p);
  post = <T>(p: string, b?: unknown) => this.request<T>("POST", p, b ?? {});
  patch = <T>(p: string, b: unknown) => this.request<T>("PATCH", p, b);
  put = <T>(p: string, b: unknown) => this.request<T>("PUT", p, b);
  del = <T>(p: string) => this.request<T>("DELETE", p);

  // ------------------------------------------------------------------ state
  getState = () => this.get<AppState>("/state");
  health = () => this.get<{ ok: boolean; version: string; app: string; name: string; serverTime: number }>("/health");
  getStats = () => this.get<Stats>("/stats");

  // ------------------------------------------------------------------ catalog
  sourceTypes = () => this.get<SourceType[]>("/obs/source-types");
  /** Properties of a source type's defaults (for the "create source" dialog before it exists). */
  typeDefaults = (kind: string) => this.get<Record<string, unknown>>(`/obs/source-types/${encodeURIComponent(kind)}/defaults`);
  audioDevices = (kind: "input" | "output") => this.get<AudioDevice[]>(`/obs/audio-devices?kind=${kind}`);
  /** Audio monitoring output devices (Settings › Audio › Monitoring Device). */
  monitoringDevices = () => this.get<AudioDevice[]>("/obs/monitoring-devices");
  encoders = () => this.get<EncoderType[]>("/obs/encoders");
  /** Encoder property schema, evaluated against the given settings. */
  encoderProperties = (id: string, settings: Record<string, unknown> = {}) =>
    this.post<Property[]>(`/obs/encoders/${encodeURIComponent(id)}/properties`, { settings });
  services = () => this.get<StreamService[]>("/obs/services");
  transitionTypes = () => this.get<SourceType[]>("/obs/transition-types");
  filterTypes = (sourceUuid?: Uuid) => this.get<SourceType[]>(`/obs/filter-types${sourceUuid ? `?source=${sourceUuid}` : ""}`);

  // ------------------------------------------------------------------ scene collections
  createSceneCollection = (name: string) => this.post<void>("/collections", { name });
  switchSceneCollection = (name: string) => this.post<void>(`/collections/${encodeURIComponent(name)}/activate`);
  /** Copy a collection (scenes, sources, filters) under a new name and switch to it. */
  duplicateSceneCollection = (name: string, newName: string) => this.post<void>(`/collections/${encodeURIComponent(name)}/duplicate`, { name: newName });
  renameSceneCollection = (name: string, newName: string) => this.patch<void>(`/collections/${encodeURIComponent(name)}`, { name: newName });
  deleteSceneCollection = (name: string) => this.del<void>(`/collections/${encodeURIComponent(name)}`);
  /** Importable scene collections found on this PC: OBS Studio (obs-studio/basic/scenes) and Streamlabs Desktop (slobs-client/SceneCollections). */
  /** Install an overlay pack (Streamlabs `.overlay`, a pack's collection `.json`, or the pack folder) as a new collection. */
  installTheme = (path: string, name?: string) => this.post<{ name: string }>("/collections/install-theme", { path, name });
  /** Export the current scene collection with its files, alerts and widget looks as a .vxoverlay package. */
  exportOverlay = (path: string) => this.post<{ files: number }>("/collections/export-overlay", { path });
  /** Replace old "all alerts" browser sources by one source per enabled alert. */
  splitAlertSources = () => this.post<{ created: number }>("/alerts/split-sources");
  /** Point screen captures to the main monitor and webcams to the first camera (when unset), and put the main screen under game captures. */
  setupDevices = () => this.post<{ screensAdded: number; devicesSet: number }>("/collections/setup-devices");
  /** Rebuild a scene's 9:16 twin from its 16:9 layout: "auto" (camera on top, game in the middle, info below) or "fit" (whole scene scaled). */
  arrangeVertical = (sceneUuid: Uuid, mode: "auto" | "tiktok" | "fit" = "auto", background?: Uuid) => this.post<{ items: number }>(`/scenes/${sceneUuid}/arrange-vertical`, { mode, background });
  obsCollections = () => this.get<{ name: string; path: string; app: "obs" | "streamlabs" }[]>("/collections/obs");
  /** Import an OBS scene collection file as a new Vexcast collection. */
  importObsCollection = (path: string, name?: string) => this.post<{ name: string }>("/collections/import", { path, name });

  // ------------------------------------------------------------------ scenes
  createScene = (name: string) => this.post<{ uuid: Uuid }>("/scenes", { name });
  renameScene = (uuid: Uuid, name: string) => this.patch<void>(`/scenes/${uuid}`, { name });
  duplicateScene = (uuid: Uuid, name: string) => this.post<{ uuid: Uuid }>(`/scenes/${uuid}/duplicate`, { name });
  deleteScene = (uuid: Uuid) => this.del<void>(`/scenes/${uuid}`);
  reorderScenes = (uuids: Uuid[]) => this.post<void>("/scenes/reorder", { uuids });
  /** Make program (uses the current transition). In studio mode this sets the preview instead unless `program` is true. */
  setProgramScene = (uuid: Uuid, force = false) => this.post<void>(`/scenes/${uuid}/program${force ? "?force=1" : ""}`);
  setPreviewScene = (uuid: Uuid) => this.post<void>(`/scenes/${uuid}/preview`);
  setStudioMode = (enabled: boolean) => this.post<void>("/studio-mode", { enabled });
  /** Studio mode: transition preview → program. */
  transitionToProgram = () => this.post<void>("/studio-mode/transition");

  // ------------------------------------------------------------------ scene items
  addSourceToScene = (sceneUuid: Uuid, sourceUuid: Uuid) => this.post<SceneItem>(`/scenes/${sceneUuid}/items`, { sourceUuid });
  /** Partial transform/state update (pos, rot, scale, alignment, bounds*, crop, visible, locked, blend*, scaleFilter…). */
  updateItem = (sceneUuid: Uuid, itemId: number, patch: Partial<SceneItem>) => this.patch<SceneItem>(`/scenes/${sceneUuid}/items/${itemId}`, patch);
  transformItem = (sceneUuid: Uuid, itemId: number, action: TransformAction) =>
    this.post<SceneItem>(`/scenes/${sceneUuid}/items/${itemId}/transform`, { action });
  orderItem = (sceneUuid: Uuid, itemId: number, action: OrderAction) => this.post<void>(`/scenes/${sceneUuid}/items/${itemId}/order`, { action });
  /** Bottom-most first. */
  reorderItems = (sceneUuid: Uuid, itemIds: number[]) => this.post<void>(`/scenes/${sceneUuid}/items/reorder`, { ids: itemIds });
  removeItem = (sceneUuid: Uuid, itemId: number) => this.del<void>(`/scenes/${sceneUuid}/items/${itemId}`);
  /** Copy/paste transform between items. */
  copyTransform = (sceneUuid: Uuid, itemId: number) => this.post<void>(`/scenes/${sceneUuid}/items/${itemId}/copy-transform`);
  pasteTransform = (sceneUuid: Uuid, itemId: number) => this.post<SceneItem>(`/scenes/${sceneUuid}/items/${itemId}/paste-transform`);
  groupItems = (sceneUuid: Uuid, itemIds: number[], name: string) => this.post<SceneItem>(`/scenes/${sceneUuid}/group`, { ids: itemIds, name });
  ungroupItem = (sceneUuid: Uuid, itemId: number) => this.post<void>(`/scenes/${sceneUuid}/items/${itemId}/ungroup`);

  // ------------------------------------------------------------------ sources
  /** Create an input. If sceneUuid is given, adds it to that scene (fitted like OBS). */
  createSource = (input: { name: string; kind: string; settings?: Record<string, unknown>; sceneUuid?: Uuid }) =>
    this.post<SourceInfo>("/sources", input);
  /** Partial: name, enabled, volume, volumeDb, muted, monitoring, syncOffsetMs, balance, mixers, forceMono, pushTo*. */
  updateSource = (uuid: Uuid, patch: Partial<SourceInfo>) => this.patch<SourceInfo>(`/sources/${uuid}`, patch);
  deleteSource = (uuid: Uuid) => this.del<void>(`/sources/${uuid}`);
  duplicateSource = (uuid: Uuid, name: string, sceneUuid?: Uuid) => this.post<SourceInfo>(`/sources/${uuid}/duplicate`, { name, sceneUuid });
  /** Full property schema with current values. */
  sourceProperties = (uuid: Uuid) => this.get<Property[]>(`/sources/${uuid}/properties`);
  /** Merge settings (OBS obs_source_update) and get the refreshed schema (lists/visibility may change). */
  updateSourceSettings = (uuid: Uuid, settings: Record<string, unknown>) => this.patch<Property[]>(`/sources/${uuid}/settings`, settings);
  /** Reset settings to defaults. */
  resetSourceSettings = (uuid: Uuid) => this.post<Property[]>(`/sources/${uuid}/settings/reset`);
  clickSourceButton = (uuid: Uuid, property: string) => this.post<Property[]>(`/sources/${uuid}/properties/${encodeURIComponent(property)}/click`);
  mediaAction = (uuid: Uuid, action: MediaAction) => this.post<void>(`/sources/${uuid}/media`, { action });
  /** Send interaction to an interactive source (browser): mouse/keyboard. */
  interact = (uuid: Uuid, event: Record<string, unknown>) => this.post<void>(`/sources/${uuid}/interact`, event);
  /** Single JPEG of one source (for properties/filters previews). */
  sourceSnapshotUrl = (uuid: Uuid) => this.url(`${API_PREFIX}/sources/${uuid}/snapshot.jpg?t=${Date.now()}`, true);

  // filters
  addFilter = (sourceUuid: Uuid, kind: string, name: string) => this.post<{ uuid: Uuid }>(`/sources/${sourceUuid}/filters`, { kind, name });
  updateFilter = (sourceUuid: Uuid, filterUuid: Uuid, patch: { name?: string; enabled?: boolean }) =>
    this.patch<void>(`/sources/${sourceUuid}/filters/${filterUuid}`, patch);
  filterProperties = (sourceUuid: Uuid, filterUuid: Uuid) => this.get<Property[]>(`/sources/${sourceUuid}/filters/${filterUuid}/properties`);
  updateFilterSettings = (sourceUuid: Uuid, filterUuid: Uuid, settings: Record<string, unknown>) =>
    this.patch<Property[]>(`/sources/${sourceUuid}/filters/${filterUuid}/settings`, settings);
  clickFilterButton = (sourceUuid: Uuid, filterUuid: Uuid, property: string) =>
    this.post<Property[]>(`/sources/${sourceUuid}/filters/${filterUuid}/properties/${encodeURIComponent(property)}/click`);
  removeFilter = (sourceUuid: Uuid, filterUuid: Uuid) => this.del<void>(`/sources/${sourceUuid}/filters/${filterUuid}`);
  /** Top-most (first applied) first, like OBS's filter list. */
  reorderFilters = (sourceUuid: Uuid, filterUuids: Uuid[]) => this.post<void>(`/sources/${sourceUuid}/filters/reorder`, { uuids: filterUuids });

  // ------------------------------------------------------------------ transitions
  addTransition = (kind: string, name: string) => this.post<TransitionInfo>("/transitions", { kind, name });
  setCurrentTransition = (uuid: Uuid) => this.post<void>(`/transitions/${uuid}/current`);
  setTransitionDuration = (ms: number) => this.put<void>("/transitions/duration", { ms });
  transitionProperties = (uuid: Uuid) => this.get<Property[]>(`/transitions/${uuid}/properties`);
  updateTransitionSettings = (uuid: Uuid, settings: Record<string, unknown>) => this.patch<Property[]>(`/transitions/${uuid}/settings`, settings);
  renameTransition = (uuid: Uuid, name: string) => this.patch<void>(`/transitions/${uuid}`, { name });
  removeTransition = (uuid: Uuid) => this.del<void>(`/transitions/${uuid}`);

  // ------------------------------------------------------------------ settings
  setVideo = (s: Partial<VideoSettings>) => this.put<VideoSettings>("/settings/video", s);
  setAudio = (s: Partial<AudioSettings>) => this.put<AudioSettings>("/settings/audio", s);
  setOutput = (s: Partial<OutputSettings>) => this.put<OutputSettings>("/settings/output", s);
  setAdvanced = (s: Partial<AdvancedSettings>) => this.put<AdvancedSettings>("/settings/advanced", s);
  setWidgets = (s: DeepPartial<WidgetSettings>) => this.put<WidgetSettings>("/settings/widgets", s);
  setAi = (s: DeepPartial<AiSettings>) => this.put<AiSettings>("/settings/ai", s);
  setBot = (s: Partial<BotSettings>) => this.put<BotSettings>("/settings/bot", s);
  setGeneral = (s: Partial<GeneralSettings>) => this.put<GeneralSettings>("/settings/general", s);
  hotkeys = () => this.get<Hotkey[]>("/hotkeys");
  setHotkey = (id: number, bindings: Hotkey["bindings"]) => this.put<void>(`/hotkeys/${id}`, { bindings });

  // ------------------------------------------------------------------ outputs
  createDestination = (d: Omit<Destination, "id">) => this.post<Destination>("/destinations", d);
  updateDestination = (id: Uuid, patch: Partial<Destination>) => this.patch<Destination>(`/destinations/${id}`, patch);
  deleteDestination = (id: Uuid) => this.del<void>(`/destinations/${id}`);
  startStream = () => this.post<void>("/stream/start");
  /** Rehearsal: stream to Twitch in bandwidth-test mode (nobody can watch it). */
  startRehearsal = () => this.post<void>("/stream/rehearsal");
  /** Replace the macro list (their hotkeys follow). */
  setMacros = (macros: Macro[]) => this.put<Macro[]>("/macros", macros);
  runMacro = (id: string) => this.post<void>(`/macros/${id}/run`);
  getHealth = () => this.get<HealthReport>("/stream-health");
  /** Translate a chat message (kept and broadcast as chat_translated). text null = already in that language. */
  translateChat = (id: string, to?: string) => this.post<{ text: string | null }>("/chat/translate", { id, to });
  /** Stream reports: newest first (the live one included while streaming). */
  listSessions = () => this.get<SessionListItem[]>("/sessions");
  getSession = (id: string) => this.get<StreamSession>(`/sessions/${encodeURIComponent(id)}`);
  deleteSession = (id: string) => this.del<void>(`/sessions/${encodeURIComponent(id)}`);
  /** AI takeaways about a stream (saved with it). */
  sessionInsights = (id: string) => this.post<{ text: string }>(`/sessions/${encodeURIComponent(id)}/insights`);
  /** Short AI summary of the recent chat. */
  chatSummary = () => this.post<{ text: string }>("/chat/summary");
  fixHealth = (id: string) => this.post<{ message: string }>("/stream-health/fix", { id });
  stopStream = () => this.post<void>("/stream/stop");
  startRecording = () => this.post<void>("/record/start");
  stopRecording = () => this.post<void>("/record/stop");
  pauseRecording = (paused: boolean) => this.post<void>("/record/pause", { paused });
  splitRecording = () => this.post<void>("/record/split");
  startReplayBuffer = () => this.post<void>("/replay/start");
  stopReplayBuffer = () => this.post<void>("/replay/stop");
  saveReplay = () => this.post<{ path: string | null }>("/replay/save");
  startVirtualCam = () => this.post<void>("/virtualcam/start");
  stopVirtualCam = () => this.post<void>("/virtualcam/stop");
  screenshot = (sourceUuid?: Uuid) => this.post<{ path: string }>("/screenshot", { sourceUuid });

  // ------------------------------------------------------------------ chat
  chatHistory = () => this.get<ChatMessage[]>("/chat/history");
  recentAlerts = () => this.get<AlertEvent[]>("/alerts/recent");
  setChatConnection = (c: Pick<ChatConnection, "platform" | "channel" | "enabled" | "token">) => this.put<ChatConnection[]>("/chat/connections", c);
  sendChat = (text: string, platforms?: ChatPlatform[]) => this.post<void>("/chat/send", { text, platforms });
  deleteChatMessage = (id: string) => this.post<void>("/chat/delete", { id });
  /** Show a chat message on stream (highlight widget). */
  highlightChatMessage = (id: string) => this.post<void>("/chat/highlight", { id });
  clearChatHighlight = () => this.del<void>("/chat/highlight");
  /** Fonts the scenes' texts use (from themes) and whether Windows has them installed. */
  themeFonts = () => this.get<{ file: string; family: string; installed: boolean }[]>("/fonts/theme");
  /** Install those fonts for this Windows user and switch the texts to them. */
  installThemeFonts = () => this.post<{ installed: string[] }>("/fonts/theme", {});
  /** Loyalty points leaderboard (search by name). */
  loyalty = (q = "", limit = 100) => this.get<{ viewers: import("./types").LoyaltyRow[]; total: number }>(`/loyalty?q=${encodeURIComponent(q)}&limit=${limit}`);
  setLoyalty = (key: string, points: number) => this.post<void>("/loyalty/set", { key, points });
  resetLoyalty = () => this.post<void>("/loyalty/reset", {});
  /** Chat poll counted on every platform (viewers type the option number). */
  poll = () => this.get<import("./types").Poll | null>("/poll");
  startPoll = (p: { question: string; options: string[]; durationSec: number; announce: boolean; prediction?: boolean }) => this.post<import("./types").Poll>("/poll", p);
  endPoll = () => this.post<import("./types").Poll | null>("/poll/end", {});
  clearPoll = () => this.del<void>("/poll");
  /** Song requests: the queue played by the songs overlay. */
  songs = () => this.get<import("./types").SongQueue>("/songs");
  addSong = (url: string) => this.post<import("./types").Song>("/songs", { url });
  nextSong = () => this.post<void>("/songs/next", {});
  pauseSongs = (paused: boolean) => this.post<void>("/songs/pause", { paused });
  songVolume = (volume: number) => this.post<void>("/songs/volume", { volume });
  removeSong = (id: string) => this.del<void>(`/songs/${encodeURIComponent(id)}`);
  clearSongs = () => this.del<void>("/songs");
  /** Counters (deaths, wins…) and the countdown / subathon timer. */
  setCounters = (list: import("./types").Counter[]) => this.put<import("./types").Counter[]>("/counters", list);
  addCounter = (id: string, delta: number) => this.post<{ value: number }>(`/counters/${encodeURIComponent(id)}/add`, { delta });
  setCounterValue = (id: string, value: number) => this.post<{ value: number }>(`/counters/${encodeURIComponent(id)}/set`, { value });
  setCountdown = (c: import("./types").Countdown) => this.put<import("./types").Countdown>("/countdown", c);
  countdown = (action: "start" | "add" | "pause" | "resume" | "stop", seconds = 0) => this.post<import("./types").Countdown>("/countdown", { action, seconds });
  /** Giveaway: viewers join with a keyword on every platform. */
  giveaway = () => this.get<import("./types").Giveaway | null>("/giveaway");
  startGiveaway = (g: { title: string; keyword: string; cost: number; subTickets: number; announce: boolean }) => this.post<import("./types").Giveaway>("/giveaway", g);
  closeGiveaway = () => this.post<import("./types").Giveaway | null>("/giveaway/close", {});
  drawGiveaway = () => this.post<import("./types").Giveaway>("/giveaway/draw", {});
  clearGiveaway = () => this.del<void>("/giveaway");
  /** Settle a prediction: winners share the points bet on the other options. */
  resolvePoll = (winner: number) => this.post<import("./types").Poll>("/poll/resolve", { winner });
  /** Clear the label values: this stream's totals, or everything. */
  resetLabels = (scope: "session" | "all") => this.post<void>("/labels/reset", { scope });
  chatHighlight = () => this.get<import("./types").ChatHighlight | null>("/chat/highlight");

  // ------------------------------------------------------------------ alerts & AI
  /** Fire a test alert; `design` shows one of the user-made designs. */
  testAlert = (type: AlertType, design?: string) => this.post<void>("/alerts/test", { type, design });
  /** Save user-made alerts (all when `ids` is empty) with their media as a .vxalert file. */
  exportAlerts = (path: string, ids: string[] = []) => this.post<{ count: number }>("/alerts/designs/export", { path, ids });
  /** Add the alerts of a .vxalert / .json file to the library. */
  importAlerts = (path: string) => this.post<{ count: number; ids: string[] }>("/alerts/designs/import", { path });
  /** Alert designer preview page (receives designs by postMessage). */
  alertPreviewUrl = () => this.url("/widgets/alert-preview.html", true);
  skipAlert = () => this.post<void>("/alerts/skip");
  /** Speak on stream; `preview` only synthesizes (voice test, nothing plays on stream). */
  speak = (text: string, preview = false) => this.post<{ url: string }>("/tts/speak", { text, preview });
  askCohost = (text: string) => this.post<{ reply: string }>("/ai/cohost", { text });
  testLlm = () => this.post<{ ok: boolean; models: string[]; error: string | null }>("/ai/test");
  // AI hub: engines and models installed by Vexcast
  hubStatus = () => this.get<HubStatus>("/ai/hub");
  hubInstall = (runtime: HubRuntimeId, backend?: string) => this.post<{ job: string }>("/ai/hub/install", { runtime, backend });
  hubUninstall = (runtime: HubRuntimeId) => this.post<{ ok: boolean }>("/ai/hub/uninstall", { runtime });
  hubDownload = (kind: HubModelKind, repo: string, file: string) => this.post<{ job: string }>("/ai/hub/download", { kind, repo, file });
  hubCancel = (id: string) => this.post<{ ok: boolean }>("/ai/hub/cancel", { id });
  hubDelete = (kind: HubModelKind, file: string) => this.post<{ ok: boolean }>("/ai/hub/delete", { kind, file });
  hubStop = () => this.post<{ ok: boolean }>("/ai/hub/stop");
  hubSearch = (q: string) => this.get<HfModel[]>(`/ai/hub/search?q=${encodeURIComponent(q)}`);
  hubFiles = (repo: string, ext?: string) => this.get<HfFile[]>(`/ai/hub/files?repo=${encodeURIComponent(repo)}${ext ? `&ext=${encodeURIComponent(ext)}` : ""}`);
  hubVoices = () => this.get<PiperVoice[]>("/ai/hub/voices");

  // ------------------------------------------------------------------ accounts (OAuth)
  /** Start "Conectar con …". Open the returned url/verificationUri in the browser; the core finishes in the background and broadcasts state. */
  startLogin = (platform: AccountPlatform) => this.post<OAuthStart>(`/oauth/${platform}/start`);
  cancelLogin = (platform: AccountPlatform) => this.post<void>(`/oauth/${platform}/cancel`);
  disconnectAccount = (platform: AccountPlatform) => this.post<void>(`/oauth/${platform}/disconnect`);
  /** Use the account: create/update a multistream destination with its stream key and/or connect chat. */
  applyAccount = (platform: AccountPlatform, opts: { destination?: boolean; chat?: boolean }) =>
    this.post<{ destinationId: string | null; warnings: string[] }>(`/oauth/${platform}/apply`, opts);
  /** Update title/category on the platform. `categoryId` (from searchCategories) wins over `category` (a name). */
  setStreamInfo = (platform: AccountPlatform, info: { title?: string; category?: string; categoryId?: string }) => this.post<void>(`/oauth/${platform}/stream-info`, info);
  /** Current title and category on the platform. */
  getStreamInfo = (platform: AccountPlatform) => this.get<StreamInfo>(`/oauth/${platform}/stream-info`);
  /** Search games/categories (empty query: popular ones on Twitch). */
  searchCategories = (platform: AccountPlatform, q: string) => this.get<StreamCategory[]>(`/oauth/${platform}/categories?q=${encodeURIComponent(q)}`);

  // ------------------------------------------------------------------ uploads
  /** Copy a local file (from the file dialog) into the core's media folder; returns its new path. */
  importMedia = (path: string) => this.post<{ path: string }>("/media/import", { path });
  /** URL of a file in the core's data folder (alert media…), usable in <img>/<video>/<audio>. */
  fileUrl = (path: string) => this.url(`${API_PREFIX}/files?path=${encodeURIComponent(path)}`, true);
  /**
   * Upload a dropped file into the core's media folder (data dir/media) and get
   * its absolute path back, to use as a source's file setting. Raw body.
   */
  uploadFile = async (file: Blob, name: string): Promise<{ path: string }> => {
    const headers: Record<string, string> = { "Content-Type": "application/octet-stream" };
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    const res = await fetch(`${this.baseUrl}${API_PREFIX}/uploads?name=${encodeURIComponent(name)}`, { method: "POST", headers, body: file });
    if (!res.ok) {
      let msg = res.statusText;
      try {
        msg = (await res.json()).error ?? msg;
      } catch {
        /* ignore */
      }
      throw new ApiError(res.status, msg);
    }
    return res.json();
  };

  // ------------------------------------------------------------------ misc
  pairing = () => this.get<PairingInfo>("/pairing");
  /** Remote devices that have connected (PC only). */
  remoteDevices = () => this.get<RemoteDevice[]>("/remote/devices");
  /** Block/unblock or rename a device (blocking disconnects it). */
  updateRemoteDevice = (id: string, patch: { blocked?: boolean; name?: string; role?: "admin" | "moderator" | "viewer" }) => this.patch<void>(`/remote/devices/${encodeURIComponent(id)}`, patch);
  /** Forget a device (it is disconnected; it can pair again while new devices are allowed). */
  forgetRemoteDevice = (id: string) => this.del<void>(`/remote/devices/${encodeURIComponent(id)}`);
  /** New pairing code: disconnects every device; they have to scan the new QR. */
  resetRemoteToken = () => this.post<PairingInfo>("/remote/reset-token");
  checkUpdates = () => this.post<UpdateInfo>("/update/check");

  /** MJPEG stream of the program output (or `scene` / `source`) — use in <img src>. */
  previewUrl = (opts: { canvas?: "horizontal" | "vertical"; scene?: Uuid; source?: Uuid; fps?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.canvas) q.set("canvas", opts.canvas);
    if (opts.scene) q.set("scene", opts.scene);
    if (opts.source) q.set("source", opts.source);
    if (opts.fps) q.set("fps", String(opts.fps));
    return this.url(`${API_PREFIX}/preview.mjpeg?${q.toString()}`, true);
  };
  /** Single JPEG snapshot of the program output (React Native polls it). */
  snapshotUrl = (canvas: "horizontal" | "vertical" = "horizontal") => this.url(`${API_PREFIX}/preview.jpg?canvas=${canvas}&t=${Date.now()}`, true);
  widgetUrl = (name: "alerts" | "chat" | "goal" | "events" | "captions" | "audio" | "highlight" | "labels" | "poll" | "giveaway" | "counter" | "songs" | "credits") => this.url(`/widgets/${name}.html`, true);

  // -------------------------------------------------------------- realtime
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    this.ensureSocket();
    return () => this.listeners.delete(listener);
  }

  onConnectionChange(fn: (connected: boolean) => void): () => void {
    this.connListeners.add(fn);
    return () => this.connListeners.delete(fn);
  }

  get connected() {
    return this.ws?.readyState === 1;
  }

  close() {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  private ensureSocket() {
    if (this.ws || this.closed) return;
    const wsUrl = this.url(`${API_PREFIX}/ws`, true).replace(/^http/, "ws");
    const ws = new this.WS(wsUrl);
    this.ws = ws;
    ws.onopen = () => this.connListeners.forEach((f) => f(true));
    ws.onmessage = (ev: MessageEvent) => {
      try {
        const event = JSON.parse(typeof ev.data === "string" ? ev.data : "") as ServerEvent;
        this.listeners.forEach((l) => l(event));
      } catch {
        /* ignore malformed */
      }
    };
    ws.onclose = () => {
      this.ws = null;
      this.connListeners.forEach((f) => f(false));
      if (!this.closed) this.reconnectTimer = setTimeout(() => this.ensureSocket(), 1500);
    };
    ws.onerror = () => ws.close();
  }
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends any[] ? T[K] : DeepPartial<T[K]>) : T[K] };
