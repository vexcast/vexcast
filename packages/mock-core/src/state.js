// Initial in-memory AppState (protocol v2) for the mock core.
// Mirrors packages/protocol/src/types.ts + obs.ts. Seeded uuids are fixed so
// UI developers can rely on them across restarts.

import { HOME, SERVICES, sourceDefaults, sourceType, baseKind, filterDefaults, filterType, transitionDefaults, transitionType, FIXED_TRANSITIONS, encoderDefaults } from "./catalog.js";

export const VERSION = "0.1.0";

let seq = 1000;
export const uid = (prefix = "id") => `${prefix}_${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const fixed = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const SCENE = (n) => fixed("5ce0e000", n);
/** Vertical (9:16) twin of SCENE(n). */
export const VSCENE = (n) => fixed("5ce0f000", n);
export const SRC = (n) => fixed("50c0e000", n);
export const FLT = (n) => fixed("f1170000", n);
export const TRN = (n) => fixed("7a000000", n);
export const DST = (n) => fixed("de570000", n);

// ------------------------------------------------------------------ factories
export const volumeToDb = (v) => (v > 0 ? +(20 * Math.log10(v)).toFixed(2) : -100);
export const dbToVolume = (db) => (db <= -100 ? 0 : Math.pow(10, db / 20));

export function makeFilter(uuid, kind, name, settings = {}, enabled = true) {
  return { uuid, name, kind, kindName: filterType(kind)?.name ?? kind, enabled, settings: { ...filterDefaults(kind), ...settings } };
}

export function makeSource(uuid, name, kind, settings = {}, extra = {}) {
  const t = sourceType(kind) ?? { video: true, audio: false, async: false, interactive: false, controllableMedia: false, name: kind };
  const volume = extra.volume ?? 1;
  return {
    uuid,
    name,
    kind,
    kindName: t.name,
    baseKind: baseKind(kind),
    settings: { ...sourceDefaults(kind), ...settings },
    video: t.video,
    audio: t.audio,
    async: t.async,
    interactive: t.interactive,
    controllableMedia: t.controllableMedia,
    width: 0,
    height: 0,
    enabled: true,
    volume,
    volumeDb: volumeToDb(volume),
    muted: false,
    monitoring: "none",
    syncOffsetMs: 0,
    balance: 0.5,
    mixers: 63,
    forceMono: false,
    pushToMute: false,
    pushToMuteDelayMs: 0,
    pushToTalk: false,
    pushToTalkDelayMs: 0,
    filters: [],
    globalSlot: null,
    mediaState: t.controllableMedia ? "playing" : null,
    refs: 0,
    ...extra,
    ...(extra.volume !== undefined ? { volumeDb: volumeToDb(extra.volume) } : {}),
  };
}

export function makeItem(id, sourceUuid, o = {}) {
  return {
    id,
    sourceUuid,
    name: "",
    visible: true,
    locked: false,
    pos: { x: 0, y: 0 },
    rot: 0,
    scale: { x: 1, y: 1 },
    alignment: 5, // LEFT | TOP
    boundsType: "none",
    boundsAlignment: 0,
    bounds: { x: 0, y: 0 },
    cropToBounds: false,
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
    blendMode: "normal",
    blendMethod: "default",
    scaleFilter: "disable",
    sourceWidth: 0,
    sourceHeight: 0,
    isGroup: false,
    showTransition: { kind: null, durationMs: 300 },
    hideTransition: { kind: null, durationMs: 300 },
    ...o,
  };
}

export function makeGroup(id, uuid, name, children, o = {}) {
  return makeItem(id, uuid, { name, isGroup: true, items: children, ...o });
}

/** SceneInfo (horizontal scene or vertical twin). */
export function makeScene(uuid, name, items = [], filters = []) {
  return { uuid, name, items, filters, verticalSceneUuid: null };
}

export function makeTransition(uuid, kind, name, settings = {}) {
  return { uuid, name, kind, kindName: transitionType(kind)?.name ?? kind, fixed: FIXED_TRANSITIONS.has(kind), settings: { ...transitionDefaults(kind), ...settings } };
}

/** Global audio sources (Settings > Audio): Desktop Audio + Mic/Aux. */
export function globalAudioSources(desktopUuid, micUuid) {
  return [
    makeSource(desktopUuid, "Audio del escritorio", "wasapi_output_capture", {}, { globalSlot: "desktop1", volume: 0.6, mixers: 0b000101 }),
    makeSource(micUuid, "Mic/Aux", "wasapi_input_capture", {}, {
      globalSlot: "mic1",
      mixers: 0b000011,
      pushToTalkDelayMs: 200,
      filters: [
        makeFilter(micUuid === SRC(8) ? FLT(3) : crypto.randomUUID(), "noise_suppress_filter_v2", "Supresión de ruido", { method: "rnnoise" }),
        makeFilter(micUuid === SRC(8) ? FLT(4) : crypto.randomUUID(), "compressor_filter", "Compresor", { ratio: 4, threshold: -20 }),
      ],
    }),
  ];
}

// ------------------------------------------------------------------ collections
/** "Sin título": the main collection used for UI testing. */
export function buildDefaultCollection(port) {
  const widget = (n) => `http://127.0.0.1:${port}/widgets/${n}.html`;
  const sources = [
    makeSource(SRC(1), "Captura de pantalla", "monitor_capture", { method: 0 }),
    makeSource(SRC(2), "Cámara", "dshow_input", {}, {
      muted: true,
      filters: [
        makeFilter(FLT(1), "chroma_key_filter_v2", "Chroma Key", { key_color_type: "green", similarity: 420, smoothness: 60 }),
        makeFilter(FLT(2), "color_filter_v2", "Corrección de color", { contrast: 0.08, saturation: 0.15, brightness: 0.02 }),
      ],
    }),
    makeSource(SRC(3), "Alertas", "browser_source", { url: widget("alerts"), width: 1920, height: 1080, reroute_audio: true }),
    makeSource(SRC(4), "Título", "text_gdiplus_v3", {
      text: "¡Empezamos en breve!",
      font: { face: "Arial", style: "Bold", size: 96, flags: 1 },
      outline: true,
      outline_size: 4,
      outline_color: 0xff2a0f14,
    }),
    makeSource(SRC(5), "Logo", "image_source", { file: `${HOME}\\Pictures\\vexcast-logo.png` }),
    makeSource(SRC(6), "Fondo", "color_source_v3", { color: 0xff2a0f14, width: 1920, height: 1080 }),
    ...globalAudioSources(SRC(7), SRC(8)),
    makeSource(SRC(9), "Barra", "color_source_v3", { color: 0xd94b1e7c, width: 700, height: 110 }),
    makeSource(SRC(10), "Nombre del canal", "text_gdiplus_v3", { text: "vexcast_dev", font: { face: "Arial", style: "Regular", size: 64, flags: 0 } }),
  ];

  const juego = makeScene(SCENE(1), "Juego", [
      makeItem(1, SRC(1), { locked: true }),
      // crop: camera cropped to a square-ish face cam, bottom-right
      makeItem(2, SRC(2), { pos: { x: 1440, y: 700 }, scale: { x: 0.5, y: 0.5 }, crop: { left: 220, top: 40, right: 220, bottom: 60 } }),
      // rotation: logo tilted, center-aligned
      makeItem(3, SRC(5), { pos: { x: 140, y: 140 }, rot: -12, scale: { x: 0.35, y: 0.35 }, alignment: 0 }),
      // group: lower third (bar + channel name)
      makeGroup(4, "9a0e0000-0000-4000-8000-000000000001", "Rótulo", [
        makeItem(5, SRC(9), { pos: { x: 0, y: 0 } }),
        makeItem(6, SRC(10), { pos: { x: 40, y: 16 } }),
      ], { pos: { x: 60, y: 900 } }),
      // hidden
      makeItem(7, SRC(4), { visible: false, pos: { x: 960, y: 120 }, alignment: 0 }),
      makeItem(8, SRC(3)),
  ]);

  const charlando = makeScene(SCENE(2), "Charlando", [
      makeItem(1, SRC(6), { locked: true }),
      // bounds: camera fitted (scale_inner) into a 1240x698 box
      makeItem(2, SRC(2), { pos: { x: 80, y: 90 }, boundsType: "scale_inner", bounds: { x: 1240, y: 698 }, boundsAlignment: 0 }),
      makeItem(3, SRC(4), { pos: { x: 80, y: 850 } }),
      makeItem(4, SRC(5), { pos: { x: 1840, y: 1000 }, scale: { x: 0.3, y: 0.3 }, alignment: 10 }),
      makeItem(5, SRC(3)),
  ]);

  // Vertical twins (1080x1920): camera big on top, display capture cropped to a
  // square in the middle, title/lower third at the bottom.
  const twins = new Map([
    [
      SCENE(1),
      makeScene(VSCENE(1), "Juego", [
        makeItem(1, SRC(1), { locked: true, pos: { x: 0, y: 640 }, crop: { left: 420, top: 0, right: 420, bottom: 0 } }),
        makeItem(2, SRC(2), { pos: { x: 0, y: 0 }, boundsType: "scale_outer", bounds: { x: 1080, y: 640 }, boundsAlignment: 0, cropToBounds: true }),
        makeItem(3, SRC(5), { pos: { x: 960, y: 120 }, rot: -12, scale: { x: 0.25, y: 0.25 }, alignment: 0 }),
        makeGroup(4, "9a0e0000-0000-4000-8000-000000000002", "Rótulo", [
          makeItem(5, SRC(9), { pos: { x: 0, y: 0 } }),
          makeItem(6, SRC(10), { pos: { x: 40, y: 16 } }),
        ], { pos: { x: 40, y: 1700 }, alignment: 9 }),
        makeItem(7, SRC(4), { pos: { x: 540, y: 1900 }, alignment: 8, scale: { x: 0.7, y: 0.7 } }),
        makeItem(8, SRC(3), { pos: { x: 0, y: 640 }, scale: { x: 0.5625, y: 0.5625 } }),
      ]),
    ],
    [
      SCENE(2),
      makeScene(VSCENE(2), "Charlando", [
        makeItem(1, SRC(6), { locked: true, boundsType: "stretch", bounds: { x: 1080, y: 1920 } }),
        makeItem(2, SRC(2), { pos: { x: 40, y: 160 }, boundsType: "scale_outer", bounds: { x: 1000, y: 1200 }, boundsAlignment: 0, cropToBounds: true }),
        makeItem(3, SRC(4), { pos: { x: 540, y: 1720 }, alignment: 0, scale: { x: 0.85, y: 0.85 } }),
        makeItem(4, SRC(5), { pos: { x: 1040, y: 40 }, scale: { x: 0.25, y: 0.25 }, alignment: 6 }),
        makeItem(5, SRC(3), { pos: { x: 0, y: 656 }, scale: { x: 0.5625, y: 0.5625 } }),
      ]),
    ],
  ]);

  return { scenes: [juego, charlando], sources, programSceneUuid: SCENE(1), twins };
}

/** "Torneo": a second collection to test switching. */
export function buildTorneoCollection(port) {
  const sources = [
    makeSource(SRC(21), "Intro", "ffmpeg_source", { local_file: `${HOME}\\Videos\\torneo-intro.mp4`, looping: true }, { volume: 0.5 }),
    makeSource(SRC(22), "Rótulo torneo", "text_gdiplus_v3", { text: "Torneo Vexcast 2026", font: { face: "Arial", style: "Bold", size: 120, flags: 1 }, color: 0xff22d3ee }),
    makeSource(SRC(23), "Juego", "game_capture", { capture_mode: "window", window: "Hollow Knight:UnityWndClass:hollow_knight.exe" }),
    makeSource(SRC(24), "Cámara torneo", "dshow_input", { video_device_id: "Elgato Facecam:\\\\?\\usb#vid_0fd9&pid_0078&mi_00#7&2c41e9b0&0&0000#{65e8773d-8f56-11d0-a3b9-00a0c9223196}\\global" }),
    makeSource(SRC(25), "Patrocinadores", "slideshow_v2", {
      files: [
        { value: `${HOME}\\Pictures\\sponsors\\sponsor1.png`, selected: false, hidden: false },
        { value: `${HOME}\\Pictures\\sponsors\\sponsor2.png`, selected: false, hidden: false },
      ],
    }),
    ...globalAudioSources(SRC(27), SRC(28)),
  ];
  const scenes = [
    makeScene(SCENE(11), "Empezando", [makeItem(1, SRC(21)), makeItem(2, SRC(22), { pos: { x: 960, y: 900 }, alignment: 0 })]),
    makeScene(SCENE(12), "Partida", [makeItem(1, SRC(23)), makeItem(2, SRC(24), { pos: { x: 1880, y: 1040 }, alignment: 10, boundsType: "scale_inner", bounds: { x: 480, y: 270 } })]),
    makeScene(SCENE(13), "Descanso", [makeItem(1, SRC(25)), makeItem(2, SRC(22), { pos: { x: 960, y: 980 }, alignment: 8, scale: { x: 0.6, y: 0.6 } })]),
  ];
  const twins = new Map([
    [
      SCENE(11),
      makeScene(VSCENE(11), "Empezando", [
        makeItem(1, SRC(21), { boundsType: "scale_outer", bounds: { x: 1080, y: 1920 }, cropToBounds: true }),
        makeItem(2, SRC(22), { pos: { x: 540, y: 1500 }, alignment: 0, scale: { x: 0.55, y: 0.55 } }),
      ]),
    ],
    [
      SCENE(12),
      makeScene(VSCENE(12), "Partida", [
        makeItem(1, SRC(24), { boundsType: "scale_outer", bounds: { x: 1080, y: 860 }, cropToBounds: true }),
        makeItem(2, SRC(23), { pos: { x: 0, y: 860 }, boundsType: "scale_outer", bounds: { x: 1080, y: 1060 }, cropToBounds: true }),
      ]),
    ],
    [
      SCENE(13),
      makeScene(VSCENE(13), "Descanso", [
        makeItem(1, SRC(25), { pos: { x: 0, y: 656 }, boundsType: "scale_inner", bounds: { x: 1080, y: 608 } }),
        makeItem(2, SRC(22), { pos: { x: 540, y: 1800 }, alignment: 8, scale: { x: 0.45, y: 0.45 } }),
      ]),
    ],
  ]);
  return { scenes, sources, programSceneUuid: SCENE(11), twins };
}

// ------------------------------------------------------------------ app state
export function createInitialState({ port = 7420 } = {}) {
  const main = buildDefaultCollection(port);
  const collections = new Map([
    ["Sin título", main],
    ["Torneo", buildTorneoCollection(port)],
  ]);

  const state = {
    version: VERSION,
    status: {
      ready: true,
      obsVersion: "31.1.2",
      error: null,
      streaming: false,
      streamStartedAt: null,
      recording: false,
      recordingPaused: false,
      recordingStartedAt: null,
      lastRecordingPath: null,
      replayBufferActive: false,
      virtualCamActive: false,
      studioMode: false,
      serverTime: Date.now(),
    },
    sceneCollection: "Sin título",
    sceneCollections: [
      { name: "Sin título", current: true },
      { name: "Torneo", current: false },
    ],
    scenes: main.scenes,
    verticalScenes: [], // derived from the collection's twins on refresh
    sources: main.sources,
    programSceneUuid: main.programSceneUuid,
    previewSceneUuid: null,
    transitions: [
      makeTransition(TRN(1), "cut_transition", "Cut"),
      makeTransition(TRN(2), "fade_transition", "Fade"),
      makeTransition(TRN(3), "slide_transition", "Slide", { direction: "left" }),
      makeTransition(TRN(4), "swipe_transition", "Swipe", { direction: "right", swipe_in: true }),
      makeTransition(TRN(5), "obs_stinger_transition", "Stinger", { path: `${HOME}\\Videos\\stinger.webm`, transition_point: 800 }),
      makeTransition(TRN(6), "wipe_transition", "Luma Wipe", { luma_image: "clock.png" }),
    ],
    currentTransitionUuid: TRN(2),
    transitionDurationMs: 300,
    video: {
      baseWidth: 1920,
      baseHeight: 1080,
      outputWidth: 1280,
      outputHeight: 720,
      fpsNum: 60,
      fpsDen: 1,
      downscaleFilter: "bicubic",
      colorFormat: "NV12",
      colorSpace: "709",
      colorRange: "partial",
      sdrWhiteLevel: 300,
      hdrNominalPeakLevel: 1000,
      verticalEnabled: true,
      verticalWidth: 1080,
      verticalHeight: 1920,
    },
    audio: {
      sampleRate: 48000,
      channels: "stereo",
      desktop1: "default",
      desktop2: "disabled",
      mic1: "default",
      mic2: "disabled",
      mic3: "disabled",
      mic4: "disabled",
      monitoringDeviceId: "default",
      monitoringDeviceName: "Default",
      meterDecayRate: "fast",
      peakMeterType: "sample",
      lowLatencyBuffering: false,
      trackNames: ["Directo", "Micrófono", "Escritorio", "", "", ""],
    },
    output: {
      mode: "advanced",
      streamEncoder: "jim_nvenc",
      streamEncoderSettings: encoderDefaults("jim_nvenc"),
      streamAudioEncoder: "ffmpeg_aac",
      streamAudioBitrate: 160,
      streamAudioTrack: 1,
      recordingPath: `${HOME}\\Videos`,
      recordingFormat: "mkv",
      recordingFilenameFormat: "%CCYY-%MM-%DD %hh-%mm-%ss",
      recordingEncoder: "",
      recordingEncoderSettings: {},
      recordingTracks: 0b000111,
      recordingRescale: null,
      overwriteIfExists: false,
      autoRemux: true,
      splitFile: { mode: "off", minutes: 15, megabytes: 2048 },
      replayBufferEnabled: true,
      replayBufferSeconds: 30,
      replayBufferMaxMb: 512,
      reconnect: true,
      reconnectRetryDelaySec: 2,
      reconnectMaxRetries: 25,
      streamDelaySec: 0,
      streamDelayPreserve: true,
      bindIp: "default",
      dynamicBitrate: false,
      lowLatencyMode: false,
    },
    advanced: {
      processPriority: "normal",
      renderer: "d3d11",
      browserHwAccel: true,
      hotkeyFocusBehavior: "never",
      autoRemux: true,
      confirmOnExit: true,
    },
    destinations: [
      { id: DST(1), name: "Twitch", service: "Twitch", server: SERVICES[0].servers[0].url, streamKey: "••••k9Xq", enabled: true, canvas: "horizontal", encoderOverride: null },
      { id: DST(2), name: "YouTube", service: "YouTube - RTMPS", server: SERVICES[1].servers[0].url, streamKey: "••••3fa1", enabled: true, canvas: "horizontal", encoderOverride: null },
      {
        id: DST(3),
        name: "TikTok",
        service: "TikTok",
        server: SERVICES[4].servers[0].url,
        streamKey: "••••77ab",
        enabled: false,
        canvas: "vertical",
        encoderOverride: { encoder: "jim_nvenc", settings: { ...encoderDefaults("jim_nvenc"), bitrate: 4500 } },
      },
    ],
    chat: [
      { platform: "twitch", channel: "vexcast_dev", enabled: true, token: "••••a1b2", state: "connected", error: null },
      { platform: "youtube", channel: "UCvexcast", enabled: true, token: "••••yt99", state: "connected", error: null },
      { platform: "kick", channel: "vexcast", enabled: false, token: "", state: "disconnected", error: null },
    ],
    widgets: {
      alertBox: {
        enabled: true,
        durationMs: 6000,
        templates: {
          follow: "¡{user} ahora te sigue!",
          subscription: "¡{user} se ha suscrito! ({amount} meses)",
          gift_sub: "¡{user} regaló {amount} subs!",
          raid: "¡{user} llega con una raid de {amount}!",
          bits: "¡{user} envió {amount} bits!",
          superchat: "¡{user} envió un Super Chat de {amount}!",
          donation: "¡{user} donó {amount}!",
          kofi: "¡{user} invitó {amount} en Ko-fi!",
          member: "¡{user} se hizo miembro!",
          host: "¡{user} te está hosteando!",
        },
        soundUrl: null,
        soundVolume: 0.7,
        ttsEnabled: true,
        ttsMinAmount: 2,
        animation: "pop",
        accentColor: "#8B5CF6",
      },
      chatBox: { maxMessages: 12, fadeAfterSec: 0, showPlatformIcons: true, showBadges: true, fontSize: 18, theme: "glass" },
      goal: { title: "Micrófono nuevo", current: 135, target: 300, currency: "EUR", autoTrack: true },
      captions: { enabled: false, translateTo: "", fontSize: 32 },
    },
    ai: {
      tts: { provider: "openai_compatible", voice: "ef_dora", endpoint: "http://localhost:8880/v1", piperPath: "", speed: 1, readChat: true, readChatPrefix: "!tts" },
      llm: { provider: "ollama", endpoint: "http://localhost:11434", model: "llama3.2", apiKey: "" },
      cohost: {
        enabled: true,
        name: "Vexy",
        persona: "Eres Vexy, la co-presentadora del stream. Eres simpática, breve y divertida. Respondes en el idioma del chat en una o dos frases.",
        speak: true,
        replyInChat: true,
        cooldownSec: 20,
      },
      moderation: { enabled: true, useAi: false, blockedWords: ["spam.link", "followers gratis"], autoDelete: false },
      stt: { endpoint: "http://localhost:8000/v1", model: "Systran/faster-whisper-small", sourceId: SRC(8), language: "es" },
    },
    bot: {
      enabled: true,
      prefix: "!",
      commands: [
        { id: "cmd_discord", trigger: "discord", response: "Únete a la comunidad: https://discord.gg/vexcast", cooldownSec: 30, enabled: true },
        { id: "cmd_uptime", trigger: "uptime", response: "{channel} lleva en directo {uptime}", cooldownSec: 10, enabled: true },
        { id: "cmd_so", trigger: "so", response: "¡Pasaos por el canal de {args}! 💜", cooldownSec: 5, enabled: true },
        { id: "cmd_hola", trigger: "hola", response: "¡Hola {user}! Bienvenid@ al directo", cooldownSec: 0, enabled: false },
      ],
      timers: [
        { id: "tmr_follow", message: "¿Te gusta el directo? ¡Sígueme para no perderte el próximo!", intervalMin: 15, enabled: true },
        { id: "tmr_kofi", message: "Vexcast es gratis y open source. Apóyalo en ko-fi.com/emanueldev ☕", intervalMin: 30, enabled: false },
      ],
    },
    accounts: [
      { platform: "twitch", available: true, connected: false, userId: null, login: null, displayName: null, avatarUrl: null, scopes: [], pending: false, error: null },
      { platform: "kick", available: true, connected: false, userId: null, login: null, displayName: null, avatarUrl: null, scopes: [], pending: false, error: null },
      // No client id configured for YouTube in the mock: exercises the disabled state.
      { platform: "youtube", available: false, connected: false, userId: null, login: null, displayName: null, avatarUrl: null, scopes: [], pending: false, error: null },
    ],
    general: { language: "es", theme: "dark", checkForUpdates: true, remoteControlEnabled: true, kofiVerificationToken: "••••c0ff", uiPrefs: {} },
    update: {
      currentVersion: VERSION,
      latestVersion: "0.2.0",
      updateAvailable: true,
      releaseUrl: "https://github.com/vexcast/vexcast/releases/tag/v0.2.0",
      releaseNotes:
        "## Novedades\n\n- **Subtítulos en vivo** con traducción automática\n- Nuevo widget de objetivos de donación\n- Mejoras de rendimiento en el compositor (-20% CPU)\n\n## Correcciones\n\n- Reconexión automática a Kick más estable\n- Arreglado el medidor de audio en macOS",
      checkedAt: Date.now(),
    },
  };
  return { state, collections };
}

export const CHATTERS = [
  { name: "LunaPixel", color: "#F472B6", badges: [{ id: "subscriber", label: "Suscriptor" }] },
  { name: "ElRayoMcQueen", color: "#60A5FA", badges: [] },
  { name: "moddy_mod", color: "#34D399", badges: [{ id: "moderator", label: "Moderador" }] },
  { name: "GamerGalaxia", color: "#FBBF24", badges: [{ id: "vip", label: "VIP" }] },
  { name: "Carla Ríos", color: null, badges: [{ id: "member", label: "Miembro" }] },
  { name: "nachoplays", color: "#A78BFA", badges: [{ id: "subscriber", label: "Suscriptor" }] },
  { name: "Streamer Fan 22", color: null, badges: [] },
  { name: "kickerz", color: "#53FC18", badges: [] },
];

export const CHAT_LINES = [
  "¡Buenas noches a todos! 👋",
  "qué buena pinta tiene el overlay nuevo",
  "PogChamp ese salto",
  "¿Qué micro usas?",
  "!discord",
  "Vexy, ¿qué tal el día?",
  "primera vez por aquí, me encanta el canal",
  "GG WP",
  "jajajaja no puede ser",
  "¿cuándo es el próximo directo?",
  "ese boss es imposible 😭",
  "saludos desde México 🇲🇽",
  "hello from Germany!",
  "LUL",
  "¿esto es Vexcast? se ve genial",
];
