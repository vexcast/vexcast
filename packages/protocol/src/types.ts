/**
 * Vexcast shared protocol.
 *
 * This file is the single source of truth for the data exchanged between the
 * Vexcast core (Rust) and every client: the desktop UI, the mobile remote and
 * the overlay widgets. The Rust structs in `crates/vexcast-core/src/model.rs`
 * mirror these types (serde, camelCase). Keep both in sync.
 */

export type Id = string;

// ---------------------------------------------------------------------------
import type {
  AdvancedSettings,
  AudioLevel,
  AudioSettings,
  Destination,
  EngineStatus,
  OutputSettings,
  SceneCollection,
  SceneInfo,
  SourceInfo,
  Stats,
  TransitionInfo,
  Uuid,
  VideoSettings,
} from "./obs";

export * from "./obs";

// ---------------------------------------------------------------------------
// Chat, events, alerts
// ---------------------------------------------------------------------------

export type ChatPlatform = "twitch" | "youtube" | "kick" | "tiktok" | "vexcast";

export interface ChatBadge {
  id: string; // "moderator" | "subscriber" | "vip" | "broadcaster" | ...
  label: string;
  /** Badge picture from the platform, when known (Twitch badges, Kick subscriber badges). */
  image?: string;
}

export interface ChatMessage {
  id: Id;
  platform: ChatPlatform;
  channel: string;
  user: {
    id: string;
    name: string;
    color: string | null;
    badges: ChatBadge[];
  };
  text: string;
  ts: number; // unix ms
  /** Set when the message was sent by Vexcast's bot / co-host. */
  isBot: boolean;
  /** Set by moderation (local AI or rules). */
  flagged: boolean;
  /** What's notable about the author (first time, back after a while…). */
  viewer?: ViewerTag;
  /** Asks something (questions queue). */
  question?: boolean;
  /** Translation to the streamer's language. */
  translated?: string;
}

export interface ViewerTag {
  /** Never wrote in this channel before. */
  firstTime: boolean;
  /** First message since Vexcast started, after earlier visits. */
  returning: boolean;
  /** Messages written so far (all streams). */
  messages: number;
  /** Days since the previous visit (returning after at least a day). */
  daysAway: number | null;
}

export type AlertType =
  | "follow"
  | "subscription"
  | "gift_sub"
  | "raid"
  | "bits"
  | "superchat"
  | "donation"
  | "kofi"
  | "member"
  | "host";

export interface AlertEvent {
  id: Id;
  type: AlertType;
  platform: ChatPlatform | "kofi";
  user: string;
  /** Money amount, bits, viewers (raid), months (subs)... */
  amount: number | null;
  currency: string | null;
  message: string | null;
  ts: number;
  /** URL (relative to the core) of the TTS audio for this alert, if any. */
  ttsUrl: string | null;
  test: boolean;
  /** Id of the user-made design picked for this alert. */
  design?: string | null;
}

export interface ChatConnection {
  platform: ChatPlatform;
  /** twitch: channel login; youtube: channel or video id; kick: channel slug */
  channel: string;
  enabled: boolean;
  /** Masked in API responses. Twitch: OAuth token (chat:read chat:edit). YouTube: API key. */
  token: string;
  state: "disconnected" | "connecting" | "connected" | "error";
  error: string | null;
}

// ---------------------------------------------------------------------------
// Widgets (overlays)
// ---------------------------------------------------------------------------

export interface AlertBoxSettings {
  enabled: boolean;
  durationMs: number;
  /** Message template, e.g. "{user} donated {amount}!" per alert type. */
  templates: Partial<Record<AlertType, string>>;
  soundUrl: string | null;
  soundVolume: number;
  ttsEnabled: boolean;
  /** Only read donation messages >= this amount (0 = always). */
  ttsMinAmount: number;
  animation: "pop" | "slide" | "fade" | "bounce";
  accentColor: string;
  /** Per-type look and behaviour (Streamlabs-style variations); missing types use the settings above. */
  variations: Partial<Record<AlertType, AlertVariation>>;
  /** User-made alerts (alert designer). When one matches an event it replaces the built-in look. */
  designs: AlertDesign[];
  /** Alert groups: one browser source (alerts.html?group=<id>) showing several alerts. */
  groups: AlertGroup[];
  /** Pause between two alerts (ms). */
  gapMs: number;
  /** Alerts waiting at most (older ones are dropped; 0 = no limit). */
  maxQueue: number;
  /** Words hidden (***) in alert messages and TTS; case-insensitive. */
  blockedWords: string[];
  /** Remove links from alert messages. */
  stripLinks: boolean;
  /** Longest message shown / read (characters, 0 = no limit). */
  maxMessageLength: number;
  /** Ignore a second follow from the same viewer within this many minutes (0 = never). */
  repeatFollowMinutes: number;
}

/** Several alert designs shown by a single browser source. */
export interface AlertGroup {
  id: string;
  name: string;
  /** Design ids. */
  designs: string[];
  width: number;
  height: number;
}

/** A user-made alert: layers on a canvas (or custom HTML/CSS/JS) for one alert type. */
export interface AlertDesign {
  id: string;
  name: string;
  type: AlertType;
  enabled: boolean;
  /** Shown when minAmount ≤ amount (≤ maxAmount when > 0). Events without amount count as 0. */
  minAmount: number;
  maxAmount: number;
  /** Highest priority wins among matching designs; ties are random by weight. */
  priority: number;
  weight: number;
  width: number;
  height: number;
  durationMs: number;
  /** Path or URL. Empty: the audio of the first unmuted video layer. */
  sound: string;
  soundVolume: number;
  tts: "default" | "on" | "off";
  layers: AlertLayer[];
  customEnabled: boolean;
  customHtml: string;
  customCss: string;
  customJs: string;
  /** Shown only by its own browser source (alerts.html?design=<id>), not by the general alert box. */
  ownSource: boolean;
}

export type AlertLayerKind = "text" | "image" | "video" | "shape" | "particles" | "progress";

/** One element of an alert design (fields that don't apply to its kind are ignored). */
export interface AlertLayer {
  id: string;
  name: string;
  kind: AlertLayerKind;
  visible: boolean;
  locked: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  opacity: number;
  /** reached / notReached: goal designs. */
  showWhen: "always" | "message" | "amount" | "reached" | "notReached";
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  uppercase: boolean;
  color: string;
  highlight: string;
  align: "left" | "center" | "right";
  valign: "top" | "middle" | "bottom";
  lineHeight: number;
  letterSpacing: number;
  strokeColor: string;
  strokeWidth: number;
  shadowColor: string;
  shadowBlur: number;
  shadowX: number;
  shadowY: number;
  src: string;
  fit: "contain" | "cover" | "fill";
  loopMedia: boolean;
  muted: boolean;
  fill: string;
  borderColor: string;
  borderWidth: number;
  radius: number;
  animIn: string;
  animInMs: number;
  animInDelay: number;
  animOut: string;
  animOutMs: number;
  animLoop: string;
  /** Per-letter text loop. */
  textEffect: "none" | "wave" | "bounce" | "jelly" | "rainbow" | "flicker" | "shake";
  particleType: "confetti" | "sparkles" | "hearts" | "stars" | "snow" | "bubbles" | "emoji";
  particleMode: "burst" | "fountain" | "rain";
  /** Emojis used by the "emoji" type. */
  particleEmoji: string;
  particleCount: number;
  particleSize: number;
  particleSpeed: number;
  /** Comma-separated colors ("" = festive palette). */
  particleColors: string;
  /** How long fountain / rain keep emitting (0 = the whole alert). */
  particleDurationMs: number;
  /** Progress bar (goal designs): `fill` → barColor2 gradient over trackColor. */
  barColor2: string;
  trackColor: string;
  barStripes: boolean;
  barGlow: boolean;
  barVertical: boolean;
}

/** How one alert type looks and sounds. Empty strings / zeros mean "use the global setting". */
export interface AlertVariation {
  enabled: boolean;
  /** Only show it when the amount (bits, money, raid viewers, months…) is at least this. */
  minAmount: number;
  /** Image / GIF / video: a path in Vexcast's data folder or a URL. Empty: the animated emblem. */
  media: string;
  layout: "above" | "side" | "background";
  mediaScale: number;
  /** Path or URL. Empty: the global sound (a video's own audio when the media is a video). */
  sound: string;
  /** 0..1; negative: the global volume. */
  soundVolume: number;
  /** 0: the global duration. */
  durationMs: number;
  /** "": the global animation. */
  animation: "" | "pop" | "slide" | "fade" | "bounce";
  fontFamily: string;
  /** Title size in percent of the default. */
  fontSize: number;
  textColor: string;
  highlightColor: string;
  showMessage: boolean;
  tts: "default" | "on" | "off";
}

export interface ChatBoxSettings {
  maxMessages: number;
  fadeAfterSec: number; // 0 = never
  showPlatformIcons: boolean;
  showBadges: boolean;
  fontSize: number;
  theme: "glass" | "solid" | "minimal" | "bubble" | "neon";
  /** Google font or system font ("" = default). */
  fontFamily: string;
  textColor: string;
  /** "user": each viewer's color · "custom": nameColor for everyone. */
  nameColorMode: "user" | "custom";
  nameColor: string;
  bgColor: string;
  bgOpacity: number;
  /** Corner radius (em). */
  radius: number;
  /** Space between messages (em). */
  spacing: number;
  animation: "slide" | "fade" | "pop" | "none";
  /** "up": newest at the bottom · "down": newest at the top. */
  direction: "up" | "down";
  align: "left" | "right";
  hideCommands: boolean;
  hideBots: boolean;
  hiddenUsers: string[];
  showTime: boolean;
  /** "Nuevo" tag for first-time chatters. */
  showNewBadge: boolean;
}

export interface GoalSettings {
  title: string;
  current: number;
  target: number;
  currency: string;
  /** Auto-increment from donations/Ko-fi. */
  autoTrack: boolean;
  style: "glass" | "solid" | "minimal" | "neon";
  /** Bar gradient. */
  color: string;
  color2: string;
  textColor: string;
  fontFamily: string;
  bgOpacity: number;
  /** Bar thickness (em). */
  barHeight: number;
  rounded: boolean;
  stripes: boolean;
  showIcon: boolean;
  showAmounts: boolean;
  showPercent: boolean;
  /** Confetti and badge when the goal is reached. */
  celebrate: boolean;
  /** Badge text when reached ("" = default). */
  reachedText: string;
  /** Use the layer editor design instead of the classic look. */
  designEnabled: boolean;
  design: AlertDesign | null;
}

export interface CaptionsSettings {
  enabled: boolean;
  /** ISO language to translate into ("" = no translation). */
  translateTo: string;
  fontSize: number;
  position: "bottom" | "top" | "center";
  theme: "box" | "outline" | "banner";
  fontFamily: string;
  textColor: string;
  /** Translation and cursor color. */
  accentColor: string;
  bgColor: string;
  bgOpacity: number;
  maxLines: number;
  /** Seconds without speech before hiding. */
  hideAfterSec: number;
  /** Keep the previous sentence in small above the current one. */
  showPrevious: boolean;
  uppercase: boolean;
}

/** Recent events list / ticker overlay. */
export interface EventListSettings {
  layout: "list" | "ticker";
  maxEvents: number;
  showTitle: boolean;
  /** "" = "Eventos recientes". */
  titleText: string;
  fontSize: number;
  fontFamily: string;
  textColor: string;
  theme: "glass" | "solid" | "minimal";
  bgColor: string;
  bgOpacity: number;
  /** Corner radius (em). */
  radius: number;
  /** Header dot / ticker label gradient. */
  color: string;
  color2: string;
  showTime: boolean;
  showIcons: boolean;
  showPlatform: boolean;
  /** Older events fade out a little. */
  fadeOld: boolean;
  /** Alert types shown ([] = all). */
  types: string[];
  /** Ticker speed (px per second). */
  speed: number;
  /** Load the latest events when the overlay (re)loads. */
  keepHistory: boolean;
}

export interface WidgetSettings {
  alertBox: AlertBoxSettings;
  chatBox: ChatBoxSettings;
  goal: GoalSettings;
  /** Follower, subscriber and bits goals (goal.html?type=…); `goal` is the donation one. */
  goals?: Partial<Record<"followers" | "subs" | "bits", GoalSettings>>;
  captions: CaptionsSettings;
  events: EventListSettings;
  highlight: HighlightSettings;
  labels: LabelSettings;
  poll: PollSettings;
  giveaway: GiveawaySettings;
  songs: SongsWidgetSettings;
  credits: CreditsSettings;
}

/** End-of-stream credits (credits.html). */
export interface CreditsSettings {
  title: string;
  subtitle: string;
  /** Shown at the end ("" = none). */
  outro: string;
  /** Scroll speed (px per second). */
  speed: number;
  repeat: boolean;
  fontFamily: string;
  fontSize: number;
  textColor: string;
  accentColor: string;
  bgColor: string;
  bgOpacity: number;
  /** Sections in order: follows, subs, gifts, bits, donations, raids, chatters. */
  sections: string[];
  showAmounts: boolean;
}

/** Look of the song requests player card (songs.html). */
export interface SongsWidgetSettings {
  showCard: boolean;
  /** Show the YouTube video (else audio only). */
  showVideo: boolean;
  theme: "glass" | "solid" | "neon" | "minimal";
  fontFamily: string;
  fontSize: number;
  textColor: string;
  accentColor: string;
  bgColor: string;
  bgOpacity: number;
}

/** Song requests (!sr <YouTube link>). */
export interface SongSettings {
  enabled: boolean;
  command: string;
  /** 0 = no limit. */
  maxQueue: number;
  maxPerUser: number;
  maxMinutes: number;
  /** Loyalty points per request (0 = free). */
  cost: number;
  subsOnly: boolean;
}

export interface Song {
  id: Id;
  videoId: string;
  title: string;
  author: string;
  /** "" when added from the app. */
  requestedBy: string;
  platform: ChatPlatform | null;
  durationSec: number | null;
}

export interface SongQueue {
  current: Song | null;
  queue: Song[];
  paused: boolean;
  /** 0..100 */
  volume: number;
}

/** Look of the giveaway overlay (giveaway.html). */
export interface GiveawaySettings {
  theme: "glass" | "solid" | "neon" | "minimal";
  fontFamily: string;
  fontSize: number;
  textColor: string;
  accentColor: string;
  bgColor: string;
  bgOpacity: number;
  confetti: boolean;
}

/** Giveaway across every platform. */
export interface Giveaway {
  id: Id;
  title: string;
  /** What viewers type to join ("!participar"). */
  keyword: string;
  /** Loyalty points to join (0 = free). */
  cost: number;
  /** Subscribers / members get this many tickets. */
  subTickets: number;
  open: boolean;
  entries: number;
  recent: string[];
  sample: string[];
  winner: { name: string; platform: ChatPlatform } | null;
  /** Bumps on every draw. */
  draws: number;
  startedAt: number;
}

/** Look of the chat poll overlay (poll.html). */
export interface PollSettings {
  theme: "glass" | "solid" | "neon" | "minimal";
  fontFamily: string;
  fontSize: number;
  textColor: string;
  color: string;
  color2: string;
  bgColor: string;
  bgOpacity: number;
  showVotes: boolean;
  showPercent: boolean;
  showHint: boolean;
  /** Seconds the result stays on screen after closing (0 = until removed). */
  hideAfterSec: number;
}

/** Chat poll counted across every platform. */
export interface Poll {
  id: Id;
  question: string;
  options: string[];
  votes: number[];
  startedAt: number;
  endsAt: number | null;
  open: boolean;
  /** Winning option indexes once closed (several on a tie). */
  winners: number[];
  /** Prediction: viewers bet loyalty points ("!apostar 2 100"). */
  prediction?: boolean;
  /** Points bet on each option (predictions). */
  bets?: number[];
  /** Prediction settled with this option. */
  result?: number | null;
  /** Prediction cancelled and refunded. */
  refunded?: boolean;
}

/** Text labels (latest follower, top donation, session totals…) shown by labels.html?label=… */
export interface LabelSettings {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  textColor: string;
  /** Color for {user} ("" = same as the text). */
  userColor: string;
  strokeColor: string;
  strokeWidth: number;
  shadow: boolean;
  align: "left" | "center" | "right";
  uppercase: boolean;
  /** Animation when the value changes. */
  animation: "none" | "fade" | "slide" | "pop";
  /** Shown when there's nothing yet. */
  emptyText: string;
  /** Text per label id, with {user} {amount} {count}. */
  templates: Record<string, string>;
}

export interface LabelEvent {
  user: string;
  amount: number | null;
  currency: string | null;
  ts: number;
}

/** What the labels show; kept across restarts. */
export interface LabelData {
  /** follow | subscription | gift_sub | bits | donation | raid */
  latest: Record<string, LabelEvent>;
  /** donation | bits | raid */
  top: Record<string, LabelEvent>;
  /** donation | bits */
  sessionTop: Record<string, LabelEvent>;
  /** follows | subs | bits | donations | raids */
  session: Record<string, number>;
  sessionStarted: number | null;
  /** Channel totals from the platform: followers | subs. */
  totals?: Record<string, number>;
}

/** "Destacar en pantalla": a chat message shown big on stream. */
export interface HighlightSettings {
  /** Seconds on screen (0 = until removed). */
  durationSec: number;
  theme: "glass" | "solid" | "neon" | "minimal";
  fontFamily: string;
  fontSize: number;
  textColor: string;
  accentColor: string;
  bgColor: string;
  bgOpacity: number;
  animation: "slide" | "pop" | "fade";
  showPlatform: boolean;
  showBadges: boolean;
}

/** The message currently highlighted on stream. */
export interface ChatHighlight {
  message: ChatMessage;
  /** When it was highlighted (ms). */
  at: number;
}

// ---------------------------------------------------------------------------
// Local AI
// ---------------------------------------------------------------------------

export type TtsProvider =
  | "none"
  | "system" // OS voice (SAPI / say / espeak-ng)
  | "piper" // local piper binary + .onnx voice
  | "openai_compatible"; // Kokoro-FastAPI, LocalAI, openedai-speech, ...

export interface TtsSettings {
  provider: TtsProvider;
  /** Voice name / model id / path to .onnx model (piper). */
  voice: string;
  /** Base URL for openai_compatible, e.g. http://localhost:8880/v1 */
  endpoint: string;
  /** Path to piper executable. */
  piperPath: string;
  speed: number;
  /** Read chat messages aloud (filtered by command prefix). */
  readChat: boolean;
  readChatPrefix: string; // e.g. "!tts"
}

/** none | local (llama.cpp run by Vexcast's AI hub) | anthropic (Claude API) | ollama | openai_compatible */
export type LlmProvider = "none" | "local" | "anthropic" | "ollama" | "openai_compatible";

export interface LlmSettings {
  provider: LlmProvider;
  endpoint: string; // http://localhost:11434
  model: string; // llama3.2, qwen2.5, claude-opus-5-5...
  apiKey: string; // Claude / OpenAI-compatible key, masked
  /** GGUF file downloaded in the AI hub (provider "local"). */
  localModel: string;
  localContext: number;
  localGpu: boolean;
}

export interface CohostSettings {
  enabled: boolean;
  name: string; // the co-host answers when its name is mentioned
  persona: string; // system prompt
  speak: boolean; // answer with TTS
  replyInChat: boolean;
  cooldownSec: number;
}

export interface ModerationSettings {
  enabled: boolean;
  /** Use the LLM to flag toxic messages, in addition to the word list. */
  useAi: boolean;
  blockedWords: string[];
  /** Twitch only: delete flagged messages automatically. */
  autoDelete: boolean;
}

/** local (whisper.cpp run by the AI hub) | openai_compatible (any /audio/transcriptions server, OpenAI included). */
export type SttProvider = "local" | "openai_compatible";

export interface SttSettings {
  provider: SttProvider;
  /** OpenAI-compatible transcription endpoint (faster-whisper-server, speaches, OpenAI). */
  endpoint: string;
  model: string;
  apiKey: string; // masked
  /** Whisper .bin file downloaded in the AI hub (provider "local"). */
  localModel: string;
  /** Source id of the microphone to transcribe. */
  sourceId: string | null;
  language: string; // "" = auto
}

// AI hub: engines and models installed by Vexcast.
export type HubRuntimeId = "llama" | "whisper" | "piper";
export type HubModelKind = "llm" | "whisper" | "piper";
export interface HubRuntime {
  id: HubRuntimeId;
  name: string;
  installed: boolean;
  version: string | null;
  backend: string | null;
  defaultBackend: string;
  /** Why it can't run on this computer (null = it can). */
  unsupported: string | null;
}
export interface HubModel {
  file: string;
  path: string;
  size: number;
}
export interface HubJob {
  id: string;
  label: string;
  kind: "runtime" | "model";
  target: string;
  received: number;
  total: number;
  state: "running" | "done" | "error" | "cancelled";
  error: string | null;
}
export interface HubStatus {
  os: string;
  arch: string;
  nvidia: boolean;
  runtimes: HubRuntime[];
  models: Record<HubModelKind, HubModel[]>;
  jobs: HubJob[];
  /** Model loaded by each local server, if running. */
  running: { llm: string | null; stt: string | null };
  dir: string;
}
export interface HfModel {
  repo: string;
  downloads: number;
  likes: number;
  updated: string;
}
export interface HfFile {
  path: string;
  size: number;
}
export interface PiperVoice {
  key: string;
  name: string;
  quality: string;
  speakers: number;
  language: string;
  languageName: string;
  country: string;
  file: string;
  size: number;
}

/** Chat helpers powered by the text engine. */
export interface ChatAssistSettings {
  autoTranslate: boolean;
  /** Language code ("" = the app's language). */
  translateTo: string;
}

export interface AiSettings {
  assist: ChatAssistSettings;
  tts: TtsSettings;
  llm: LlmSettings;
  cohost: CohostSettings;
  moderation: ModerationSettings;
  stt: SttSettings;
}

// ---------------------------------------------------------------------------
// Bot
// ---------------------------------------------------------------------------

export type BotPermission = "everyone" | "subscriber" | "vip" | "moderator" | "broadcaster";

export interface BotCommand {
  id: Id;
  /** Without prefix, e.g. "discord" for !discord (a word or phrase for keywords). */
  trigger: string;
  /** Variables: {user} {target} {args} {arg1}… {count} {uptime} {channel} {platform} {random} {random:1-6} {pick:a|b|c}. */
  response: string;
  cooldownSec: number;
  enabled: boolean;
  /** command: !trigger · keyword: the words appear anywhere in a message. */
  kind: "command" | "keyword";
  aliases: string[];
  permission: BotPermission;
  /** Per-viewer cooldown (seconds). */
  userCooldownSec: number;
  /** Where it works ([] = every platform). */
  platforms: ChatPlatform[];
  /** One response line picked at random (else every line is sent). */
  random: boolean;
  /** Start the reply with @user. */
  reply: boolean;
  /** Uses so far ({count}). */
  count: number;
}

export interface BotTimer {
  id: Id;
  message: string;
  intervalMin: number;
  enabled: boolean;
  /** Only post when at least this many chat messages arrived since the last time. */
  minChatLines: number;
  /** Where it's posted ([] = every platform). */
  platforms: ChatPlatform[];
}

/** Automatic chat moderation by the bot (mods and the streamer are never moderated). */
export interface BotModeration {
  links: boolean;
  allowedDomains: string[];
  caps: boolean;
  capsMinLength: number;
  capsPercent: number;
  spam: boolean;
  /** Longest message allowed (characters, 0 = no limit). */
  maxLength: number;
  exemptSubscribers: boolean;
  exemptVip: boolean;
  warn: boolean;
  warnLinks: string;
  warnCaps: string;
  warnSpam: string;
  warnLength: string;
}

export interface BotSettings {
  enabled: boolean;
  prefix: string; // "!"
  commands: BotCommand[];
  timers: BotTimer[];
  moderation: BotModeration;
  /** Answer !comandos / !commands with the list of commands everyone can use. */
  listCommand: boolean;
  loyalty?: LoyaltySettings;
  songs?: SongSettings;
}

/** Loyalty points (shared by every platform). */
export interface LoyaltySettings {
  enabled: boolean;
  /** What they're called in chat ("puntos", "monedas"…). */
  name: string;
  /** Points every `intervalMin` minutes for viewers who wrote in the last `activeMinutes`. */
  perInterval: number;
  intervalMin: number;
  activeMinutes: number;
  /** Subscribers / members / VIPs earn this many times more. */
  subMultiplier: number;
  bonusFollow: number;
  bonusSub: number;
  bonusPer100Bits: number;
  /** Per unit of money donated. */
  bonusPerCurrency: number;
  bonusRaid: number;
  command: string;
  topCommand: string;
  giveCommand: string;
  allowGive: boolean;
  redeemCommand: string;
  rewards: LoyaltyReward[];
}

/** Something viewers buy with points. */
export interface LoyaltyReward {
  id: Id;
  /** Name used in chat: !canjear <name> [text]. */
  name: string;
  cost: number;
  kind: "chat" | "tts" | "sound" | "highlight" | "macro";
  /** chat/tts: text ({user} {input}) · sound: file or URL · highlight: text without input · macro: macro id. */
  value: string;
  needsInput: boolean;
  cooldownSec: number;
  enabled: boolean;
}

/** A viewer in the loyalty leaderboard. */
export interface LoyaltyRow {
  /** "platform:name" */
  key: string;
  rank: number;
  name: string;
  platform: ChatPlatform | null;
  points: number;
  earned: number;
  redeemed: number;
  lastSeen: number;
}

// ---------------------------------------------------------------------------
// App state, updates, pairing
// ---------------------------------------------------------------------------

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  releaseNotes: string | null;
  checkedAt: number | null;
}

export interface GeneralSettings {
  language: "es" | "en";
  theme: "dark" | "light" | "system";
  checkForUpdates: boolean;
  /** Allow phones on the local network to control Vexcast. */
  remoteControlEnabled: boolean;
  /** New (unknown) devices may connect with the pairing code. */
  remoteAllowNew: boolean;
  /** MCP endpoint for AI assistants (/api/v1/mcp, only from this PC). */
  mcpEnabled: boolean;
  /** Ko-fi webhook verification token (masked). */
  kofiVerificationToken: string;
  /** After a crash or power cut while live, go live again on the next start. */
  resumeAfterCrash: boolean;
  /** Free-form UI preferences persisted by the core (dock layout, snapping, confirmations…). */
  uiPrefs: Record<string, unknown>;
}

export interface AppState {
  version: string;
  status: EngineStatus;
  // --- OBS model
  sceneCollection: string;
  sceneCollections: SceneCollection[];
  scenes: SceneInfo[]; // in user order
  /** Vertical (9:16) twins of `scenes` (empty when video.verticalEnabled is false). */
  verticalScenes: SceneInfo[];
  sources: SourceInfo[]; // every input (scenes excluded)
  programSceneUuid: Uuid | null;
  /** Studio mode preview scene (null when studio mode is off). */
  previewSceneUuid: Uuid | null;
  transitions: TransitionInfo[];
  currentTransitionUuid: Uuid | null;
  transitionDurationMs: number;
  // --- settings
  video: VideoSettings;
  audio: AudioSettings;
  output: OutputSettings;
  advanced: AdvancedSettings;
  destinations: Destination[];
  // --- Vexcast extras
  chat: ChatConnection[];
  widgets: WidgetSettings;
  ai: AiSettings;
  bot: BotSettings;
  /** Latest / top events and session totals for the label widgets. */
  labels?: LabelData;
  counters?: Counter[];
  countdown?: Countdown;
  general: GeneralSettings;
  update: UpdateInfo;
  /** OAuth-connected accounts. */
  accounts: ConnectedAccount[];
  macros: Macro[];
}

/**
 * One action of a macro. kind / value:
 * scene {scene} · stream {action: "start"|"stop"} · record {action} · replay {} (save the replay
 * buffer) · chat {text} · title {title, category?} · tts {text} · mute {source, muted?} (omitted =
 * toggle) · visibility {scene, item, visible?} · alert {type} · wait {ms}
 */
/** Stream reports (analytics). */
export interface SessionSummary {
  durationMs: number;
  peakViewers: number;
  avgViewers: number;
  chatMessages: number;
  chatters: number;
  newChatters: number;
  follows: number;
  subs: number;
  bits: number;
  donations: number;
  raids: number;
}
export interface SessionSample {
  ts: number;
  /** Viewers per platform ("twitch", "kick"). */
  viewers: Record<string, number>;
  /** Chat messages during this minute. */
  chat: number;
  scene: string;
  kbps: number;
  /** Dropped frames during this minute (%). */
  dropped: number;
}
export interface SessionEvent {
  ts: number;
  type: string;
  user: string;
  amount: number | null;
}
export interface SessionListItem {
  id: string;
  startedAt: number;
  endedAt: number | null;
  title: string;
  category: string;
  summary: SessionSummary;
}
export interface StreamSession extends SessionListItem {
  destinations: string[];
  samples: SessionSample[];
  events: SessionEvent[];
  insights: string | null;
}

/** Stream health assistant. */
export interface HealthIssue {
  id: string;
  level: "warn" | "error";
  title: string;
  detail: string;
  /** One-click fixes (POST /stream-health/fix {id}). */
  fixes: { id: string; label: string }[];
}
export interface HealthReport {
  level: "ok" | "warn" | "error";
  issues: HealthIssue[];
  ts?: number;
}

export type MacroStepKind = "scene" | "stream" | "record" | "replay" | "chat" | "title" | "tts" | "mute" | "visibility" | "alert" | "wait" | "counter" | "countdown";

/** A number shown on stream (deaths, wins…) changed from chat, macros or the app. */
export interface Counter {
  id: Id;
  name: string;
  value: number;
  /** Chat command: !muertes shows it; mods: !muertes+ / !muertes- / !muertes=5. */
  command: string;
  /** Overlay text: {name} {value}. */
  template: string;
}

/** Countdown / subathon timer. */
export interface Countdown {
  /** Running: when it reaches zero (ms). */
  endsAt: number | null;
  /** Paused: time left (ms). */
  pausedLeftMs: number | null;
  label: string;
  endText: string;
  /** Alerts add time while it runs. */
  subathon: boolean;
  addFollowSec: number;
  addSubSec: number;
  addPer100BitsSec: number;
  addPerCurrencySec: number;
}
export interface MacroStep {
  kind: MacroStepKind;
  value: Record<string, unknown>;
}
export interface Macro {
  id: Id;
  name: string;
  color: string;
  steps: MacroStep[];
}

// ---------------------------------------------------------------------------
// Connected accounts (OAuth login: Twitch, Kick, YouTube)
// ---------------------------------------------------------------------------

export type AccountPlatform = "twitch" | "kick" | "youtube";

export interface ConnectedAccount {
  platform: AccountPlatform;
  /** False when the app has no client id for this platform (button disabled with a hint). */
  available: boolean;
  connected: boolean;
  userId: string | null;
  login: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  /** Scopes granted. */
  scopes: string[];
  /** Pending login (device flow / browser) or last error. */
  pending: boolean;
  error: string | null;
}

/** Result of starting a login. "device": show userCode + open verificationUri. "browser": open url. */
export type OAuthStart =
  | { mode: "device"; verificationUri: string; userCode: string; expiresIn: number }
  | { mode: "browser"; url: string };

/** A game/category on a platform (Twitch game id, Kick category id). */
export interface StreamCategory {
  id: string;
  name: string;
  image: string | null;
}

/** Current title and category of a connected account's channel. */
export interface StreamInfo {
  title: string;
  category: StreamCategory | null;
}

export interface PairingInfo {
  /** Computer name, shown in the mobile app's saved PCs. */
  name: string;
  /** LAN addresses the phone can use. */
  addresses: string[];
  port: number;
  token: string;
  /** Payload to encode in the QR: vexcast://connect?host=ip1,ip2&port=..&token=..&name=.. */
  qrPayload: string;
}

export interface Caption {
  id: Id;
  text: string;
  translated: string | null;
  final: boolean;
  ts: number;
}

// ---------------------------------------------------------------------------
// WebSocket events (server -> client) on /api/v1/ws?token=...
// ---------------------------------------------------------------------------

export type ServerEvent =
  | { type: "state"; data: AppState } // full state, sent on connect and after every change
  | { type: "status"; data: EngineStatus } // engine status (on change and ~1 Hz)
  | { type: "stats"; data: Stats } // render/encode/output stats (~1 Hz)
  | { type: "levels"; data: AudioLevel[] } // audio meters (~20 Hz)
  | { type: "health"; data: HealthReport } // stream health changed
  | { type: "chat_translated"; data: { id: Id; text: string } } // a chat message got its translation
  | { type: "chat"; data: ChatMessage } // a message with an existing id replaces it (e.g. flagged later by AI moderation)
  | { type: "chat_deleted"; data: { id: Id } }
  | { type: "chat_highlight"; data: ChatHighlight | null } // message shown on stream (null: removed)
  | { type: "poll"; data: Poll | null } // chat poll changed (null: removed from screen)
  | { type: "giveaway"; data: Giveaway | null } // giveaway changed (null: removed from screen)
  | { type: "songs"; data: SongQueue } // song request queue changed
  | { type: "alert"; data: AlertEvent }
  | { type: "tts"; data: { id: Id; url: string; text: string; played: boolean } } // speech; `played` = already in the stream mix
  | { type: "caption"; data: Caption }
  | { type: "notification"; data: { level: "info" | "success" | "warning" | "error"; message: string } }
  | { type: "alert_skip" } // the current alert was skipped (stop its visuals/audio)
  | { type: "phone_cams"; data: PhoneCam[] }; // phones sending their camera over the local network right now

/** A phone sending its camera to Vexcast over the local network (`/phonecam/ws`). */
export interface PhoneCam {
  /** Room id; the browser source showing it has `phonecam.html?id=<room>` in its URL. */
  room: string;
  /** Name of the phone. */
  device: string;
  /** When it started sending (unix ms). */
  since: number;
}

export const DEFAULT_PORT = 7420;
export const API_PREFIX = "/api/v1";

/** A phone/tablet/browser that used the remote API (managed from the PC). */
export interface RemoteDevice {
  id: string;
  name: string;
  ip: string;
  firstSeen: number;
  lastSeen: number;
  blocked: boolean;
  /** "admin" (or ""): everything · "moderator": scenes, alerts, chat, audio, macros, title · "viewer": look only. */
  role: "" | "admin" | "moderator" | "viewer";
  /** Has a live connection right now. */
  connected: boolean;
}
