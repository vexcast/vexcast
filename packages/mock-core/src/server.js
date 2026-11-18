#!/usr/bin/env node
// Vexcast mock core: an in-memory implementation of the Vexcast core API v2
// (packages/protocol/src/client.ts) for UI development without libobs.
// Everything is simulated; the preview is drawn by a small software
// compositor (src/render.js) that follows the scene item transforms.
//
// Usage: node src/server.js [--port 7420] [--token secret] [--require-token] [--no-update] [--quiet]

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import {
  createInitialState,
  buildDefaultCollection,
  globalAudioSources,
  makeSource,
  makeItem,
  makeGroup,
  makeScene,
  makeFilter,
  makeTransition,
  volumeToDb,
  dbToVolume,
  uid,
  CHATTERS,
  CHAT_LINES,
  VERSION,
} from "./state.js";
import {
  SOURCE_TYPES,
  TRANSITION_TYPES,
  ENCODERS,
  SERVICES,
  AUDIO_INPUTS,
  AUDIO_OUTPUTS,
  HOME,
  USER,
  sourceType,
  filterType,
  transitionType,
  compatibleFilters,
  sourceDefaults,
  filterDefaults,
  transitionDefaults,
  encoderDefaults,
  hotkeysFor,
  setHotkeyBindings,
} from "./catalog.js";
import { sourceProperties, filterProperties, transitionProperties, encoderProperties, findProperty } from "./props.js";
import { renderScene, renderSource, nativeSize, filteredSize, itemGeometry, itemBBox, apply } from "./render.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

// ------------------------------------------------------------------ options
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const flag = (name) => argv.includes(`--${name}`);
const PORT = Number(arg("port", process.env.PORT ?? 7420));
const TOKEN = arg("token", process.env.VEXCAST_TOKEN ?? "mock-token-1234");
const REQUIRE_TOKEN = flag("require-token") || process.env.VEXCAST_REQUIRE_TOKEN === "1";
const QUIET = flag("quiet");
const API = "/api/v1";
const COMPUTER_NAME = process.env.VEXCAST_NAME ?? os.hostname();

const { state, collections } = createInitialState({ port: PORT });
if (flag("no-update")) Object.assign(state.update, { updateAvailable: false, latestVersion: VERSION });

const chatHistory = [];
const alertHistory = [];
const ttsClips = new Map();
const log = (...a) => !QUIET && console.log("[mock-core]", ...a);

// ------------------------------------------------------------------ helpers
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
function fail(status, message) {
  throw new HttpError(status, message);
}
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
function deepMerge(target, patch) {
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (isObj(v) && isObj(target[k])) deepMerge(target[k], v);
    else target[k] = v;
  }
  return target;
}
const mask = (v) => (v ? "••••" + String(v).slice(-4) : "");
const isMasked = (v) => typeof v === "string" && v.startsWith("••••");
const newUuid = () => crypto.randomUUID();
const num = (v, def) => (typeof v === "number" && Number.isFinite(v) ? v : def);
const canvasW = () => state.video.baseWidth;
const canvasH = () => state.video.baseHeight;
const verticalW = () => state.video.verticalWidth || 1080;
const verticalH = () => state.video.verticalHeight || 1920;
const stamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
};

// Vertical twins of the current collection: horizontal scene uuid -> twin SceneInfo.
// Kept while the vertical canvas is disabled so re-enabling restores them.
let twins = collections.get(state.sceneCollection)?.twins ?? new Map();
const twinList = () => [...twins.values()];
const isTwin = (sc) => twinList().includes(sc);
const twinOwner = (uuid) => {
  for (const [h, t] of twins) if (t.uuid === uuid) return state.scenes.find((s) => s.uuid === h) ?? null;
  return null;
};
/** A horizontal scene (a twin uuid resolves to the scene it belongs to). */
const findScene = (uuid) => state.scenes.find((s) => s.uuid === uuid) ?? twinOwner(uuid) ?? fail(404, "scene not found");
/** A horizontal scene or a vertical twin (item/filter endpoints edit either). */
const findAnyScene = (uuid) => state.scenes.find((s) => s.uuid === uuid) ?? twinList().find((s) => s.uuid === uuid) ?? fail(404, "scene not found");
/** Canvas size a scene's items are laid out on. */
const sceneCanvas = (sc) => (isTwin(sc) ? { W: verticalW(), H: verticalH() } : { W: canvasW(), H: canvasH() });
const findSource = (uuid) => state.sources.find((s) => s.uuid === uuid) ?? fail(404, "source not found");
/** Owner of a filter list: a source, a scene or a vertical twin. */
const findFilterOwner = (uuid) =>
  state.sources.find((s) => s.uuid === uuid) ?? state.scenes.find((s) => s.uuid === uuid) ?? twinList().find((s) => s.uuid === uuid) ?? fail(404, "source not found");
/** Filter compatibility view of an owner (scenes are sync video). */
const filterTarget = (o) => (state.sources.includes(o) ? o : { video: true, audio: false, async: false });
const cloneFilters = (fs) => (fs ?? []).map((f) => ({ ...structuredClone(f), uuid: newUuid() }));
const findFilter = (src, uuid) => src.filters.find((f) => f.uuid === uuid) ?? fail(404, "filter not found");
const findTransition = (uuid) => state.transitions.find((t) => t.uuid === uuid) ?? fail(404, "transition not found");

/** Find an item anywhere in a scene (including inside groups). */
function locateItem(scene, id) {
  const walk = (list, group) => {
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (it.id === id) return { item: it, list, index: i, group };
      if (it.items) {
        const r = walk(it.items, it);
        if (r) return r;
      }
    }
    return null;
  };
  return walk(scene.items, null);
}
const findItem = (scene, id) => locateItem(scene, Number(id)) ?? fail(404, "scene item not found");
function* allItems(list) {
  for (const it of list) {
    yield it;
    if (it.items) yield* allItems(it.items);
  }
}
const nextItemId = (scene) => Math.max(0, ...[...allItems(scene.items)].map((i) => i.id)) + 1;

function nameTaken(name, exceptUuid = null) {
  return state.sources.some((s) => s.name === name && s.uuid !== exceptUuid) || state.scenes.some((s) => s.name === name && s.uuid !== exceptUuid);
}
function ensureName(name, exceptUuid = null) {
  const n = String(name ?? "").trim();
  if (!n) fail(400, "name is required");
  if (nameTaken(n, exceptUuid)) fail(409, `name already exists: ${n}`);
  return n;
}

// ------------------------------------------------------------------ derived fields
function sourceSize(src) {
  const n = nativeSize(src.kind, src.settings, canvasW(), canvasH());
  return src.video ? filteredSize(n.w, n.h, src.filters) : { w: 0, h: 0 };
}

/** Keep a group's children anchored at (0,0) and its size = children bbox (like OBS). */
function resizeGroup(group) {
  const kids = group.items ?? [];
  let minX = 0,
    minY = 0,
    maxX = 0,
    maxY = 0;
  if (kids.length) {
    const boxes = kids.map(itemBBox);
    minX = Math.min(...boxes.map((b) => b.x));
    minY = Math.min(...boxes.map((b) => b.y));
    maxX = Math.max(...boxes.map((b) => b.x2));
    maxY = Math.max(...boxes.map((b) => b.y2));
  }
  const w = Math.round((maxX - minX) * 100) / 100,
    h = Math.round((maxY - minY) * 100) / 100;
  if (Math.abs(minX) < 0.01 && Math.abs(minY) < 0.01 && w === group.sourceWidth && h === group.sourceHeight) return;
  const anchor = apply(itemGeometry(group).m, minX, minY);
  for (const k of kids) {
    k.pos.x = round2(k.pos.x - minX);
    k.pos.y = round2(k.pos.y - minY);
  }
  group.sourceWidth = w;
  group.sourceHeight = h;
  const p0 = apply(itemGeometry(group).m, 0, 0);
  group.pos.x = round2(group.pos.x + anchor[0] - p0[0]);
  group.pos.y = round2(group.pos.y + anchor[1] - p0[1]);
}
const round2 = (v) => Math.round(v * 100) / 100;

/** Copy of a scene's items fitted (uniformly scaled + centered) onto the vertical canvas. */
function makeTwin(scene) {
  const W = canvasW(),
    H = canvasH(),
    VW = verticalW(),
    VH = verticalH();
  const k = Math.min(VW / W, VH / H);
  const ox = (VW - W * k) / 2,
    oy = (VH - H * k) / 2;
  const items = deepCopyItems(scene.items).map((it) => {
    it.pos = { x: round2(it.pos.x * k + ox), y: round2(it.pos.y * k + oy) };
    it.scale = { x: it.scale.x * k, y: it.scale.y * k };
    if (it.boundsType !== "none") it.bounds = { x: round2(it.bounds.x * k), y: round2(it.bounds.y * k) };
    return it;
  });
  return makeScene(newUuid(), scene.name, items);
}

/** Keep twins in sync with state.scenes (lazy creation, names) and derive verticalScenes. */
function syncTwins() {
  const on = !!state.video.verticalEnabled;
  for (const sc of state.scenes) {
    sc.filters ??= [];
    let twin = twins.get(sc.uuid);
    if (!twin && on) twins.set(sc.uuid, (twin = makeTwin(sc)));
    if (twin) {
      twin.name = sc.name;
      twin.filters ??= [];
      twin.verticalSceneUuid = null;
    }
    sc.verticalSceneUuid = on && twin ? twin.uuid : null;
  }
  state.verticalScenes = on ? state.scenes.map((sc) => twins.get(sc.uuid)) : [];
}

function refresh() {
  syncTwins();
  const byUuid = new Map(state.sources.map((s) => [s.uuid, s]));
  const scenesBy = new Map(state.scenes.map((s) => [s.uuid, s]));
  for (const s of state.sources) {
    const { w, h } = sourceSize(s);
    s.width = w;
    s.height = h;
    s.volumeDb = volumeToDb(s.volume);
    s.refs = 0;
  }
  for (const sc of [...state.scenes, ...twinList()]) {
    const counted = state.scenes.includes(sc) || state.verticalScenes.includes(sc);
    const seen = new Set();
    const walk = (list) => {
      for (const it of list) {
        if (it.isGroup) {
          walk(it.items ?? []);
          resizeGroup(it);
          continue;
        }
        const src = byUuid.get(it.sourceUuid);
        if (src) {
          it.name = src.name;
          it.sourceWidth = src.width;
          it.sourceHeight = src.height;
          if (counted && !seen.has(src.uuid)) {
            seen.add(src.uuid);
            src.refs++;
          }
        } else if (scenesBy.has(it.sourceUuid)) {
          it.name = scenesBy.get(it.sourceUuid).name;
          it.sourceWidth = canvasW();
          it.sourceHeight = canvasH();
        }
      }
    };
    walk(sc.items);
  }
  state.sceneCollections = [...collections.keys()].map((name) => ({ name, current: name === state.sceneCollection }));
}

// ------------------------------------------------------------------ websocket
const wss = new WebSocketServer({ noServer: true });
let stateVersion = 1;
function broadcast(type, data) {
  if (type === "alert") {
    alertHistory.unshift(data);
    if (alertHistory.length > 50) alertHistory.pop();
  }
  const msg = JSON.stringify(data === undefined ? { type } : { type, data });
  for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
}
function pushState() {
  refresh();
  stateVersion++;
  state.status.serverTime = Date.now();
  broadcast("state", state);
  schedulePreviewPush();
}
const notify = (level, message) => broadcast("notification", { level, message });

wss.on("connection", (ws) => {
  state.status.serverTime = Date.now();
  ws.send(JSON.stringify({ type: "state", data: state }));
  ws.send(JSON.stringify({ type: "stats", data: computeStats() }));
  for (const m of chatHistory.slice(-50)) ws.send(JSON.stringify({ type: "chat", data: m }));
  log("ws client connected", wss.clients.size);
});

// ------------------------------------------------------------------ tts wav
function makeWav(text) {
  const rate = 22050;
  const dur = Math.min(0.25 + text.length * 0.035, 3.5);
  const n = Math.floor(rate * dur);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const tt = i / rate;
    const syl = Math.floor(tt * 7);
    const f = 180 + ((text.charCodeAt(syl % text.length) || 100) % 12) * 18;
    const env = Math.sin(Math.PI * ((tt * 7) % 1)) * Math.min(1, (dur - tt) * 8);
    const v = Math.sin(2 * Math.PI * f * tt) * 0.25 * env + Math.sin(4 * Math.PI * f * tt) * 0.08 * env;
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}
function createTts(text) {
  const id = uid("tts");
  ttsClips.set(id, makeWav(text));
  if (ttsClips.size > 50) ttsClips.delete(ttsClips.keys().next().value);
  return { id, url: `${API}/tts/audio/${id}`, text };
}

// ------------------------------------------------------------------ chat & alerts simulation
function chatMessage(platform, user, text, extra = {}) {
  const blocked = state.ai.moderation.enabled && state.ai.moderation.blockedWords.some((w) => w && text.toLowerCase().includes(w.toLowerCase()));
  const msg = {
    id: uid("msg"),
    platform,
    channel: state.chat.find((c) => c.platform === platform)?.channel ?? "vexcast",
    user: { id: user.name.toLowerCase(), name: user.name, color: user.color ?? null, badges: user.badges ?? [] },
    text,
    ts: Date.now(),
    isBot: false,
    flagged: blocked,
    ...extra,
  };
  chatHistory.push(msg);
  if (chatHistory.length > 200) chatHistory.shift();
  broadcast("chat", msg);
  return msg;
}
const BOT_USER = { name: "Vexcast", color: "#8B5CF6", badges: [{ id: "bot", label: "Bot" }] };
function handleBot(msg) {
  const { bot, ai } = state;
  if (bot.enabled && msg.text.startsWith(bot.prefix)) {
    const [trigger, ...args] = msg.text.slice(bot.prefix.length).split(/\s+/);
    const cmd = bot.commands.find((c) => c.enabled && c.trigger.toLowerCase() === trigger.toLowerCase());
    if (cmd) {
      const reply = cmd.response.replaceAll("{user}", msg.user.name).replaceAll("{channel}", msg.channel).replaceAll("{args}", args.join(" ")).replaceAll("{uptime}", uptime());
      setTimeout(() => chatMessage(msg.platform, BOT_USER, reply, { isBot: true }), 600);
    }
  }
  if (ai.cohost.enabled && msg.text.toLowerCase().includes(ai.cohost.name.toLowerCase())) {
    setTimeout(() => {
      const reply = cohostReply(msg.text, msg.user.name);
      if (ai.cohost.replyInChat) chatMessage(msg.platform, { name: ai.cohost.name, color: "#22D3EE", badges: [{ id: "bot", label: "Co-host" }] }, reply, { isBot: true });
      if (ai.cohost.speak) broadcast("tts", createTts(reply));
    }, 1400);
  }
}
function uptime() {
  if (!state.status.streamStartedAt) return "0m";
  const s = Math.floor((Date.now() - state.status.streamStartedAt) / 1000);
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
function cohostReply(text, user = "chat") {
  const replies = [
    `¡Hola ${user}! Aquí andamos, disfrutando del directo contigo ✨`,
    `Buena pregunta, ${user}. Yo diría que sí, ¡pero no se lo digas a nadie!`,
    `${user}, si sigues así te nombro co-presentador honorario 😄`,
    `Todo genial por aquí. ¿Y tú qué tal, ${user}?`,
  ];
  return replies[text.length % replies.length];
}

const ALERT_SAMPLES = {
  follow: () => ({ platform: "twitch", amount: null, currency: null, message: null }),
  subscription: () => ({ platform: "twitch", amount: 6, currency: null, message: "¡Medio año ya! Seguid así" }),
  gift_sub: () => ({ platform: "twitch", amount: 5, currency: null, message: null }),
  raid: () => ({ platform: "twitch", amount: 128, currency: null, message: null }),
  bits: () => ({ platform: "twitch", amount: 500, currency: null, message: "Toma bits 🎉" }),
  superchat: () => ({ platform: "youtube", amount: 10, currency: "EUR", message: "¡Saludos desde Sevilla!" }),
  donation: () => ({ platform: "kofi", amount: 5, currency: "EUR", message: "Gracias por el contenido" }),
  kofi: () => ({ platform: "kofi", amount: 3, currency: "EUR", message: "¡Un café para el streamer! ☕" }),
  member: () => ({ platform: "youtube", amount: 1, currency: null, message: null }),
  host: () => ({ platform: "twitch", amount: 42, currency: null, message: null }),
};
let lastAlertAt = 0;
function emitAlert(type, test = false) {
  const sample = (ALERT_SAMPLES[type] ?? ALERT_SAMPLES.follow)();
  const user = CHATTERS[Math.floor(Math.random() * CHATTERS.length)].name;
  const ev = { id: uid("alert"), type, user, ts: Date.now(), ttsUrl: null, test, ...sample };
  if (state.widgets.alertBox.ttsEnabled && ev.message && (ev.amount ?? 0) >= state.widgets.alertBox.ttsMinAmount) ev.ttsUrl = createTts(ev.message).url;
  lastAlertAt = Date.now();
  broadcast("alert", ev);
  if (["donation", "kofi", "superchat"].includes(type) && state.widgets.goal.autoTrack && ev.amount) {
    state.widgets.goal.current += ev.amount;
    pushState();
  }
  return ev;
}

// ------------------------------------------------------------------ scene item operations
const TRANSFORM_KEYS = ["pos", "rot", "scale", "alignment", "boundsType", "boundsAlignment", "bounds", "crop", "cropToBounds"];
let transformClipboard = null;

function addItemFor(scene, sourceUuid, { copyFrom = null } = {}) {
  const src = state.sources.find((s) => s.uuid === sourceUuid);
  const nested = state.scenes.find((s) => s.uuid === sourceUuid);
  if (!src && !nested) fail(404, "source not found");
  if (nested && (nested.uuid === scene.uuid || twins.get(nested.uuid) === scene)) fail(400, "a scene cannot contain itself");
  const { w, h } = src ? sourceSize(src) : { w: canvasW(), h: canvasH() };
  const { W, H } = sceneCanvas(scene);
  const item = makeItem(nextItemId(scene), sourceUuid, { name: (src ?? nested).name, sourceWidth: w, sourceHeight: h });
  if (copyFrom) {
    for (const k of TRANSFORM_KEYS) item[k] = structuredClone(copyFrom[k]);
  } else if (w > W || h > H) {
    const k = Math.min(W / w, H / h);
    item.scale = { x: k, y: k };
  }
  scene.items.push(item);
  return item;
}

function shiftItem(item, dx, dy) {
  item.pos.x = round2(item.pos.x + dx);
  item.pos.y = round2(item.pos.y + dy);
}

function transformItem(item, action, { W, H } = { W: canvasW(), H: canvasH() }) {
  const g = itemGeometry(item);
  const before = itemBBox(item);
  switch (action) {
    case "reset":
      Object.assign(item, {
        pos: { x: 0, y: 0 },
        rot: 0,
        scale: { x: 1, y: 1 },
        alignment: 5,
        boundsType: "none",
        boundsAlignment: 0,
        bounds: { x: 0, y: 0 },
        crop: { left: 0, top: 0, right: 0, bottom: 0 },
        cropToBounds: false,
      });
      break;
    case "fit":
    case "stretch": {
      if (!g.cw || !g.ch) break;
      if (action === "fit") {
        const k = Math.min(W / g.cw, H / g.ch);
        item.scale = { x: k, y: k };
        item.pos = { x: round2((W - g.cw * k) / 2), y: round2((H - g.ch * k) / 2) };
      } else {
        item.scale = { x: W / g.cw, y: H / g.ch };
        item.pos = { x: 0, y: 0 };
      }
      Object.assign(item, { rot: 0, alignment: 5, boundsType: "none", bounds: { x: 0, y: 0 } });
      break;
    }
    case "center":
    case "center_h":
    case "center_v": {
      const dx = action === "center_v" ? 0 : (W - (before.x2 - before.x)) / 2 - before.x;
      const dy = action === "center_h" ? 0 : (H - (before.y2 - before.y)) / 2 - before.y;
      shiftItem(item, dx, dy);
      break;
    }
    case "flip_h":
    case "flip_v": {
      if (action === "flip_h") item.scale.x = -item.scale.x;
      else item.scale.y = -item.scale.y;
      const after = itemBBox(item);
      shiftItem(item, before.x - after.x, before.y - after.y);
      break;
    }
    case "rotate_cw":
    case "rotate_ccw":
    case "rotate_180": {
      const delta = action === "rotate_cw" ? 90 : action === "rotate_ccw" ? -90 : 180;
      item.rot = (((item.rot + delta) % 360) + 360) % 360;
      const after = itemBBox(item);
      shiftItem(item, (before.x + before.x2) / 2 - (after.x + after.x2) / 2, (before.y + before.y2) / 2 - (after.y + after.y2) / 2);
      break;
    }
    default:
      fail(400, `unknown transform action: ${action}`);
  }
}

function patchItem(item, body) {
  for (const k of ["visible", "locked", "cropToBounds"]) if (typeof body[k] === "boolean") item[k] = body[k];
  for (const k of ["rot", "alignment", "boundsAlignment"]) if (typeof body[k] === "number") item[k] = body[k];
  for (const k of ["boundsType", "blendMode", "blendMethod", "scaleFilter"]) if (typeof body[k] === "string") item[k] = body[k];
  for (const k of ["pos", "scale", "bounds", "crop", "showTransition", "hideTransition"]) if (isObj(body[k])) Object.assign(item[k], body[k]);
  if (item.crop) for (const k of ["left", "top", "right", "bottom"]) item.crop[k] = Math.max(0, Math.round(num(item.crop[k], 0)));
}

function deepCopyItems(items) {
  return items.map((it) => {
    const c = structuredClone(it);
    if (c.isGroup) {
      c.sourceUuid = newUuid();
      c.items = deepCopyItems(it.items ?? []);
    }
    return c;
  });
}

function removeSourceRefs(uuid) {
  const strip = (list) =>
    list
      .filter((it) => it.sourceUuid !== uuid || it.isGroup)
      .map((it) => {
        if (it.items) it.items = strip(it.items);
        return it;
      });
  for (const sc of [...state.scenes, ...twinList()]) sc.items = strip(sc.items);
}

// ------------------------------------------------------------------ collections
function saveCurrentCollection() {
  collections.set(state.sceneCollection, { scenes: state.scenes, sources: state.sources, programSceneUuid: state.programSceneUuid, twins });
}
function loadCollection(name) {
  saveCurrentCollection();
  const col = collections.get(name) ?? fail(404, "scene collection not found");
  state.sceneCollection = name;
  state.scenes = col.scenes;
  state.sources = col.sources;
  twins = col.twins ??= new Map();
  state.programSceneUuid = col.programSceneUuid ?? col.scenes[0]?.uuid ?? null;
  state.previewSceneUuid = state.status.studioMode ? state.programSceneUuid : null;
}
/** Deep copy with fresh uuids (sources, filters, scenes, groups). */
function cloneCollection(col) {
  const map = new Map();
  const sources = col.sources.map((s) => {
    const c = structuredClone(s);
    c.uuid = newUuid();
    map.set(s.uuid, c.uuid);
    for (const f of c.filters) f.uuid = newUuid();
    return c;
  });
  for (const sc of col.scenes) map.set(sc.uuid, newUuid());
  const remap = (items) =>
    items.map((it) => {
      const c = structuredClone(it);
      c.sourceUuid = c.isGroup ? newUuid() : (map.get(it.sourceUuid) ?? it.sourceUuid);
      if (it.items) c.items = remap(it.items);
      return c;
    });
  const scenes = col.scenes.map((sc) => makeScene(map.get(sc.uuid), sc.name, remap(sc.items), cloneFilters(sc.filters)));
  const twinsCopy = new Map(
    [...(col.twins ?? new Map())].filter(([h]) => map.has(h)).map(([h, t]) => [map.get(h), makeScene(newUuid(), t.name, remap(t.items), cloneFilters(t.filters))]),
  );
  return { scenes, sources, programSceneUuid: map.get(col.programSceneUuid) ?? scenes[0]?.uuid ?? null, twins: twinsCopy };
}
function uniqueCollectionName(base) {
  let n = base,
    i = 2;
  while (collections.has(n)) n = `${base} (${i++})`;
  return n;
}
const OBS_COLLECTIONS = [
  { name: "Untitled", path: `${HOME}\\AppData\\Roaming\\obs-studio\\basic\\scenes\\Untitled.json` },
  { name: "Directo Twitch", path: `${HOME}\\AppData\\Roaming\\obs-studio\\basic\\scenes\\Directo_Twitch.json` },
  { name: "Podcast", path: `${HOME}\\AppData\\Roaming\\obs-studio\\basic\\scenes\\Podcast.json` },
];

// ------------------------------------------------------------------ outputs & stats
const outputs = new Map(); // id -> { state, startedAt, totalBytes, dropped, frames, kbps }
const ext = (fmt) => ({ hybrid_mp4: "mp4", fragmented_mp4: "mp4", fragmented_mov: "mov" })[fmt] ?? fmt;
function startOutput(id, delay = 0) {
  const o = { state: delay ? "starting" : "active", startedAt: Date.now(), totalBytes: 0, dropped: 0, frames: 0, kbps: 0 };
  outputs.set(id, o);
  if (delay)
    setTimeout(() => {
      if (outputs.get(id) === o) o.state = "active";
    }, delay);
  return o;
}
function videoBitrate(dest) {
  const s = dest?.encoderOverride?.settings ?? state.output.streamEncoderSettings;
  return num(s?.bitrate, 6000);
}
function computeStats() {
  const fps = state.video.fpsNum / state.video.fpsDen;
  const st = state.status;
  const list = [];
  for (const [id, o] of outputs) {
    list.push({
      id,
      state: o.state,
      kbps: o.kbps,
      totalBytes: o.totalBytes,
      droppedFrames: o.dropped,
      totalFrames: o.frames,
      congestion: o.congestion ?? 0,
      durationMs: o.state === "active" ? Date.now() - o.startedAt : 0,
      error: null,
    });
  }
  return {
    fps: +(fps - (Math.random() < 0.08 ? 0.3 : 0)).toFixed(2),
    targetFps: fps,
    cpu: +(4 + Math.random() * 3 + (st.streaming ? 9 : 0) + (st.recording ? 4 : 0)).toFixed(1),
    memoryMb: +(412 + Math.random() * 20 + state.sources.length * 6).toFixed(1),
    diskFreeGb: 412.7,
    averageRenderMs: +(1.2 + Math.random() * 0.6).toFixed(2),
    renderSkipped: statsCounters.renderSkipped,
    renderTotal: statsCounters.renderTotal,
    encodingSkipped: statsCounters.encodingSkipped,
    encodingTotal: statsCounters.encodingTotal,
    outputs: list,
  };
}
const statsCounters = { renderSkipped: 0, renderTotal: 0, encodingSkipped: 0, encodingTotal: 0 };

// ------------------------------------------------------------------ routes
const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)")) + "$");
  routes.push({ method, re, keys, handler });
};

// --- state
route("GET", "/health", () => ({ ok: true, version: VERSION, app: "vexcast", name: COMPUTER_NAME, serverTime: Date.now() }));
route("GET", "/state", () => {
  state.status.serverTime = Date.now();
  return state;
});
route("GET", "/stats", () => computeStats());

// --- catalog
route("GET", "/obs/source-types", () => SOURCE_TYPES);
route("GET", "/obs/source-types/:kind/defaults", ({ params }) => {
  if (!sourceType(params.kind)) fail(404, "unknown source type");
  const d = sourceDefaults(params.kind);
  if (params.kind === "browser_source") d.url = "https://obsproject.com/browser-source";
  return d;
});
route("GET", "/obs/audio-devices", ({ url }) => (url.searchParams.get("kind") === "output" ? AUDIO_OUTPUTS : AUDIO_INPUTS));
route("GET", "/obs/monitoring-devices", () => AUDIO_OUTPUTS);
route("GET", "/obs/encoders", () => ENCODERS);
route("POST", "/obs/encoders/:id/properties", ({ params, body }) => {
  if (!ENCODERS.some((e) => e.id === params.id)) fail(404, "unknown encoder");
  return encoderProperties(params.id, isObj(body.settings) ? body.settings : {});
});
route("GET", "/obs/services", () => SERVICES);
route("GET", "/obs/transition-types", () => TRANSITION_TYPES);
route("GET", "/obs/filter-types", ({ url }) => {
  const id = url.searchParams.get("source");
  return compatibleFilters(id ? filterTarget(findFilterOwner(id)) : null);
});

// --- scene collections
route("GET", "/collections/obs", () => OBS_COLLECTIONS);
route("POST", "/collections/import", ({ body }) => {
  const p = String(body.path ?? "");
  if (!p) fail(400, "path is required");
  const base = String(body.name || path.win32.basename(p).replace(/\.json$/i, "").replace(/_/g, " ") || "Importada");
  const name = uniqueCollectionName(base);
  saveCurrentCollection();
  collections.set(name, cloneCollection(buildDefaultCollection(PORT)));
  pushState();
  notify("success", `Colección importada: ${name}`);
  return { name };
});
route("POST", "/collections", ({ body }) => {
  const name = String(body.name ?? "").trim();
  if (!name) fail(400, "name is required");
  if (collections.has(name)) fail(409, "scene collection already exists");
  saveCurrentCollection();
  const sceneUuid = newUuid();
  collections.set(name, { scenes: [makeScene(sceneUuid, "Escena")], sources: globalAudioSources(newUuid(), newUuid()), programSceneUuid: sceneUuid, twins: new Map() });
  loadCollection(name);
  pushState();
});
route("POST", "/collections/:name/activate", ({ params }) => {
  if (!collections.has(params.name)) fail(404, "scene collection not found");
  loadCollection(params.name);
  pushState();
});
route("POST", "/collections/:name/duplicate", ({ params, body }) => {
  saveCurrentCollection();
  const src = collections.get(params.name) ?? fail(404, "scene collection not found");
  const name = String(body.name ?? "").trim();
  if (!name) fail(400, "name is required");
  if (collections.has(name)) fail(409, "scene collection already exists");
  collections.set(name, cloneCollection(src));
  loadCollection(name);
  pushState();
});
route("PATCH", "/collections/:name", ({ params, body }) => {
  saveCurrentCollection();
  const col = collections.get(params.name) ?? fail(404, "scene collection not found");
  const name = String(body.name ?? "").trim();
  if (!name) fail(400, "name is required");
  if (name !== params.name && collections.has(name)) fail(409, "scene collection already exists");
  const entries = [...collections.entries()].map(([k, v]) => (k === params.name ? [name, col] : [k, v]));
  collections.clear();
  for (const [k, v] of entries) collections.set(k, v);
  if (state.sceneCollection === params.name) state.sceneCollection = name;
  pushState();
});
route("DELETE", "/collections/:name", ({ params }) => {
  if (!collections.has(params.name)) fail(404, "scene collection not found");
  if (collections.size <= 1) fail(400, "cannot delete the last scene collection");
  if (state.sceneCollection === params.name) loadCollection([...collections.keys()].find((k) => k !== params.name));
  collections.delete(params.name);
  pushState();
});

// --- scenes
route("POST", "/scenes", ({ body }) => {
  const scene = makeScene(newUuid(), ensureName(body.name));
  state.scenes.push(scene); // its vertical twin is created on refresh
  if (!state.programSceneUuid) state.programSceneUuid = scene.uuid;
  pushState();
  return { uuid: scene.uuid };
});
route("POST", "/scenes/reorder", ({ body }) => {
  const ids = Array.isArray(body.uuids) ? body.uuids : [];
  const pos = (s) => (ids.includes(s.uuid) ? ids.indexOf(s.uuid) : ids.length + state.scenes.indexOf(s));
  state.scenes.sort((a, b) => pos(a) - pos(b));
  pushState();
});
route("PATCH", "/scenes/:uuid", ({ params, body }) => {
  const s = findScene(params.uuid);
  if (body.name !== undefined) s.name = ensureName(body.name, s.uuid);
  pushState();
});
route("POST", "/scenes/:uuid/duplicate", ({ params, body }) => {
  const s = findScene(params.uuid);
  const copy = makeScene(newUuid(), ensureName(body.name || `${s.name} 2`), deepCopyItems(s.items), cloneFilters(s.filters));
  const twin = twins.get(s.uuid);
  if (twin) twins.set(copy.uuid, makeScene(newUuid(), copy.name, deepCopyItems(twin.items), cloneFilters(twin.filters)));
  state.scenes.splice(state.scenes.indexOf(s) + 1, 0, copy);
  pushState();
  return { uuid: copy.uuid };
});
route("DELETE", "/scenes/:uuid", ({ params }) => {
  const { uuid } = findScene(params.uuid);
  if (state.scenes.length <= 1) fail(400, "cannot delete the last scene");
  state.scenes = state.scenes.filter((s) => s.uuid !== uuid);
  twins.delete(uuid);
  removeSourceRefs(uuid);
  if (state.programSceneUuid === uuid) state.programSceneUuid = state.scenes[0].uuid;
  if (state.previewSceneUuid === uuid) state.previewSceneUuid = state.scenes[0].uuid;
  pushState();
});
route("POST", "/scenes/:uuid/program", ({ params, body }) => {
  const { uuid } = findScene(params.uuid);
  if (state.status.studioMode && !body.program) state.previewSceneUuid = uuid;
  else state.programSceneUuid = uuid;
  pushState();
});
route("POST", "/scenes/:uuid/preview", ({ params }) => {
  const { uuid } = findScene(params.uuid);
  if (!state.status.studioMode) fail(400, "studio mode is off");
  state.previewSceneUuid = uuid;
  pushState();
});
route("POST", "/studio-mode", ({ body }) => {
  const on = !!body.enabled;
  state.status.studioMode = on;
  state.previewSceneUuid = on ? state.programSceneUuid : null;
  pushState();
});
route("POST", "/studio-mode/transition", () => {
  if (!state.status.studioMode) fail(400, "studio mode is off");
  const prev = state.programSceneUuid;
  state.programSceneUuid = state.previewSceneUuid ?? prev;
  state.previewSceneUuid = prev;
  pushState();
});

// --- scene items
route("POST", "/scenes/:uuid/items", ({ params, body }) => {
  const scene = findAnyScene(params.uuid);
  const item = addItemFor(scene, body.sourceUuid);
  pushState();
  return item;
});
route("POST", "/scenes/:uuid/items/reorder", ({ params, body }) => {
  const scene = findAnyScene(params.uuid);
  const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number);
  const listed = ids.map((id) => scene.items.find((i) => i.id === id)).filter(Boolean);
  scene.items = [...listed, ...scene.items.filter((i) => !listed.includes(i))];
  pushState();
});
route("PATCH", "/scenes/:uuid/items/:id", ({ params, body }) => {
  const { item } = findItem(findAnyScene(params.uuid), params.id);
  patchItem(item, body);
  pushState();
  return item;
});
route("POST", "/scenes/:uuid/items/:id/transform", ({ params, body }) => {
  const scene = findAnyScene(params.uuid);
  const { item } = findItem(scene, params.id);
  transformItem(item, body.action, sceneCanvas(scene));
  pushState();
  return item;
});
route("POST", "/scenes/:uuid/items/:id/order", ({ params, body }) => {
  const { list, index } = findItem(findAnyScene(params.uuid), params.id);
  const [it] = list.splice(index, 1);
  const to = { up: Math.min(list.length, index + 1), down: Math.max(0, index - 1), top: list.length, bottom: 0 }[body.action];
  if (to === undefined) {
    list.splice(index, 0, it);
    fail(400, "unknown order action");
  }
  list.splice(to, 0, it);
  pushState();
});
route("DELETE", "/scenes/:uuid/items/:id", ({ params }) => {
  const { list, index } = findItem(findAnyScene(params.uuid), params.id);
  list.splice(index, 1);
  pushState();
});
route("POST", "/scenes/:uuid/items/:id/copy-transform", ({ params }) => {
  const { item } = findItem(findAnyScene(params.uuid), params.id);
  transformClipboard = Object.fromEntries(TRANSFORM_KEYS.map((k) => [k, structuredClone(item[k])]));
});
route("POST", "/scenes/:uuid/items/:id/paste-transform", ({ params }) => {
  const { item } = findItem(findAnyScene(params.uuid), params.id);
  if (!transformClipboard) fail(400, "no transform copied");
  for (const k of TRANSFORM_KEYS) item[k] = structuredClone(transformClipboard[k]);
  pushState();
  return item;
});
route("POST", "/scenes/:uuid/group", ({ params, body }) => {
  const scene = findAnyScene(params.uuid);
  const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number);
  const picked = scene.items.filter((i) => ids.includes(i.id));
  if (!picked.length) fail(400, "no top-level items selected");
  const name = ensureName(body.name || "Grupo");
  const boxes = picked.map(itemBBox);
  const minX = Math.min(...boxes.map((b) => b.x)),
    minY = Math.min(...boxes.map((b) => b.y));
  const topIndex = Math.max(...picked.map((i) => scene.items.indexOf(i)));
  for (const it of picked) shiftItem(it, -minX, -minY);
  const group = makeGroup(nextItemId(scene), newUuid(), name, picked, { pos: { x: round2(minX), y: round2(minY) } });
  const remaining = scene.items.filter((i) => !picked.includes(i));
  const insertAt = topIndex - (picked.length - 1);
  remaining.splice(Math.max(0, insertAt), 0, group);
  scene.items = remaining;
  pushState();
  return group;
});
route("POST", "/scenes/:uuid/items/:id/ungroup", ({ params }) => {
  const scene = findAnyScene(params.uuid);
  const { item, list, index } = findItem(scene, params.id);
  if (!item.isGroup) fail(400, "item is not a group");
  const g = itemGeometry(item);
  const kids = (item.items ?? []).map((k) => {
    const [x, y] = apply(g.m, k.pos.x, k.pos.y);
    k.pos = { x: round2(x), y: round2(y) };
    k.rot = (((k.rot + item.rot) % 360) + 360) % 360;
    k.scale = { x: k.scale.x * g.sx, y: k.scale.y * g.sy };
    if (k.boundsType !== "none") k.bounds = { x: k.bounds.x * Math.abs(g.sx), y: k.bounds.y * Math.abs(g.sy) };
    return k;
  });
  list.splice(index, 1, ...kids);
  pushState();
});

// --- sources
route("POST", "/sources", ({ body }) => {
  const kind = String(body.kind ?? "");
  const t = sourceType(kind);
  if (!t || t.kind !== "input") fail(400, `unknown source kind: ${kind}`);
  const src = makeSource(newUuid(), ensureName(body.name), kind, isObj(body.settings) ? body.settings : {});
  state.sources.push(src);
  if (body.sceneUuid) addItemFor(findAnyScene(body.sceneUuid), src.uuid);
  pushState();
  return src;
});
route("PATCH", "/sources/:uuid", ({ params, body }) => {
  const s = findSource(params.uuid);
  if (body.name !== undefined) s.name = ensureName(body.name, s.uuid);
  for (const k of ["enabled", "muted", "forceMono", "pushToMute", "pushToTalk"]) if (typeof body[k] === "boolean") s[k] = body[k];
  for (const k of ["syncOffsetMs", "pushToMuteDelayMs", "pushToTalkDelayMs"]) if (typeof body[k] === "number") s[k] = Math.round(body[k]);
  if (typeof body.balance === "number") s.balance = Math.min(1, Math.max(0, body.balance));
  if (typeof body.mixers === "number") s.mixers = body.mixers & 63;
  if (typeof body.monitoring === "string") s.monitoring = body.monitoring;
  if (typeof body.volumeDb === "number") s.volume = dbToVolume(Math.min(30, body.volumeDb));
  if (typeof body.volume === "number") s.volume = Math.min(31.62, Math.max(0, body.volume));
  pushState();
  return s;
});
route("DELETE", "/sources/:uuid", ({ params }) => {
  findSource(params.uuid);
  state.sources = state.sources.filter((s) => s.uuid !== params.uuid);
  removeSourceRefs(params.uuid);
  pushState();
});
route("POST", "/sources/:uuid/duplicate", ({ params, body }) => {
  const orig = findSource(params.uuid);
  const copy = structuredClone(orig);
  copy.uuid = newUuid();
  copy.name = ensureName(body.name || `${orig.name} 2`);
  copy.globalSlot = null;
  for (const f of copy.filters) f.uuid = newUuid();
  state.sources.push(copy);
  if (body.sceneUuid) {
    const scene = findAnyScene(body.sceneUuid);
    const existing = [...allItems(scene.items)].find((i) => i.sourceUuid === orig.uuid);
    addItemFor(scene, copy.uuid, { copyFrom: existing });
  }
  pushState();
  return copy;
});
const srcProps = (s) => sourceProperties(s.kind, s.settings, { sources: state.sources, selfUuid: s.uuid });
route("GET", "/sources/:uuid/properties", ({ params }) => srcProps(findSource(params.uuid)));
route("PATCH", "/sources/:uuid/settings", ({ params, body }) => {
  const s = findSource(params.uuid);
  Object.assign(s.settings, body ?? {});
  pushState();
  return srcProps(s);
});
route("POST", "/sources/:uuid/settings/reset", ({ params }) => {
  const s = findSource(params.uuid);
  s.settings = sourceDefaults(s.kind);
  pushState();
  return srcProps(s);
});
route("POST", "/sources/:uuid/properties/:prop/click", ({ params }) => {
  const s = findSource(params.uuid);
  const p = findProperty(srcProps(s), params.prop);
  if (!p || p.type !== "button") fail(404, "button not found");
  if (p.buttonType !== "url") {
    if (s.kind === "dshow_input" && p.name === "activate") s.settings.active = s.settings.active === false;
    else notify("info", `${s.name}: ${p.description} (simulado)`);
  }
  pushState();
  return srcProps(s);
});
route("POST", "/sources/:uuid/media", ({ params, body }) => {
  const s = findSource(params.uuid);
  if (!s.controllableMedia) fail(400, "source has no media controls");
  const next = { play: "playing", pause: "paused", restart: "playing", stop: "stopped", next: "playing", previous: "playing" }[body.action];
  if (!next) fail(400, "unknown media action");
  s.mediaState = next;
  pushState();
});
route("POST", "/sources/:uuid/interact", ({ params }) => {
  const s = findSource(params.uuid);
  if (!s.interactive) fail(400, "source is not interactive");
});

// --- filters
route("POST", "/sources/:uuid/filters", ({ params, body }) => {
  const s = findFilterOwner(params.uuid);
  const t = filterType(body.kind);
  if (!t) fail(400, `unknown filter kind: ${body.kind}`);
  if (!compatibleFilters(filterTarget(s)).includes(t)) fail(400, `${t.name} is not compatible with ${s.kindName ?? "Scene"}`);
  const name = String(body.name || t.name).trim();
  if (s.filters.some((f) => f.name === name)) fail(409, `filter name already exists: ${name}`);
  const f = makeFilter(newUuid(), t.id, name);
  s.filters.push(f);
  pushState();
  return { uuid: f.uuid };
});
route("POST", "/sources/:uuid/filters/reorder", ({ params, body }) => {
  const s = findFilterOwner(params.uuid);
  const ids = Array.isArray(body.uuids) ? body.uuids : [];
  const pos = (f) => (ids.includes(f.uuid) ? ids.indexOf(f.uuid) : ids.length + s.filters.indexOf(f));
  s.filters.sort((a, b) => pos(a) - pos(b));
  pushState();
});
route("PATCH", "/sources/:uuid/filters/:fid", ({ params, body }) => {
  const s = findFilterOwner(params.uuid);
  const f = findFilter(s, params.fid);
  if (typeof body.name === "string") {
    const n = body.name.trim();
    if (!n) fail(400, "name is required");
    if (s.filters.some((x) => x.name === n && x !== f)) fail(409, `filter name already exists: ${n}`);
    f.name = n;
  }
  if (typeof body.enabled === "boolean") f.enabled = body.enabled;
  pushState();
});
const fltProps = (s, f) => filterProperties(f.kind, f.settings, { sources: state.sources, selfUuid: s.uuid });
route("GET", "/sources/:uuid/filters/:fid/properties", ({ params }) => {
  const s = findFilterOwner(params.uuid);
  return fltProps(s, findFilter(s, params.fid));
});
route("PATCH", "/sources/:uuid/filters/:fid/settings", ({ params, body }) => {
  const s = findFilterOwner(params.uuid);
  const f = findFilter(s, params.fid);
  Object.assign(f.settings, body ?? {});
  pushState();
  return fltProps(s, f);
});
route("POST", "/sources/:uuid/filters/:fid/properties/:prop/click", ({ params }) => {
  const s = findFilterOwner(params.uuid);
  const f = findFilter(s, params.fid);
  const p = findProperty(fltProps(s, f), params.prop);
  if (!p || p.type !== "button") fail(404, "button not found");
  if (p.buttonType !== "url") notify("info", `${f.name}: ${p.description} (simulado)`);
  return fltProps(s, f);
});
route("DELETE", "/sources/:uuid/filters/:fid", ({ params }) => {
  const s = findFilterOwner(params.uuid);
  findFilter(s, params.fid);
  s.filters = s.filters.filter((f) => f.uuid !== params.fid);
  pushState();
});

// --- transitions
route("POST", "/transitions", ({ body }) => {
  const t = transitionType(body.kind);
  if (!t) fail(400, `unknown transition kind: ${body.kind}`);
  const name = String(body.name || t.name).trim();
  if (state.transitions.some((x) => x.name === name)) fail(409, `transition name already exists: ${name}`);
  const tr = makeTransition(newUuid(), t.id, name);
  state.transitions.push(tr);
  pushState();
  return tr;
});
route("PUT", "/transitions/duration", ({ body }) => {
  state.transitionDurationMs = Math.max(50, Math.min(20000, Math.round(num(body.ms, state.transitionDurationMs))));
  pushState();
});
route("POST", "/transitions/:uuid/current", ({ params }) => {
  state.currentTransitionUuid = findTransition(params.uuid).uuid;
  pushState();
});
route("GET", "/transitions/:uuid/properties", ({ params }) => {
  const t = findTransition(params.uuid);
  return transitionProperties(t.kind, t.settings);
});
route("PATCH", "/transitions/:uuid/settings", ({ params, body }) => {
  const t = findTransition(params.uuid);
  Object.assign(t.settings, body ?? {});
  pushState();
  return transitionProperties(t.kind, t.settings);
});
route("PATCH", "/transitions/:uuid", ({ params, body }) => {
  const t = findTransition(params.uuid);
  const n = String(body.name ?? "").trim();
  if (!n) fail(400, "name is required");
  if (state.transitions.some((x) => x.name === n && x !== t)) fail(409, `transition name already exists: ${n}`);
  t.name = n;
  pushState();
});
route("DELETE", "/transitions/:uuid", ({ params }) => {
  const t = findTransition(params.uuid);
  if (t.fixed) fail(400, `${t.name} cannot be removed`);
  state.transitions = state.transitions.filter((x) => x !== t);
  if (state.currentTransitionUuid === t.uuid) state.currentTransitionUuid = state.transitions.find((x) => x.kind === "fade_transition")?.uuid ?? state.transitions[0].uuid;
  pushState();
});

// --- settings
function syncGlobalAudio() {
  for (const slot of ["desktop1", "desktop2", "mic1", "mic2", "mic3", "mic4"]) {
    const dev = state.audio[slot];
    const existing = state.sources.find((s) => s.globalSlot === slot);
    if (dev === "disabled") {
      if (existing) {
        state.sources = state.sources.filter((s) => s !== existing);
        removeSourceRefs(existing.uuid);
      }
      continue;
    }
    if (existing) existing.settings.device_id = dev;
    else {
      const isDesktop = slot.startsWith("desktop");
      const base = isDesktop ? (slot === "desktop1" ? "Audio del escritorio" : "Audio del escritorio 2") : slot === "mic1" ? "Mic/Aux" : `Mic/Aux ${slot.slice(3)}`;
      let name = base,
        i = 2;
      while (nameTaken(name)) name = `${base} (${i++})`;
      state.sources.push(makeSource(newUuid(), name, isDesktop ? "wasapi_output_capture" : "wasapi_input_capture", { device_id: dev }, { globalSlot: slot }));
    }
  }
}
route("PUT", "/settings/:section", ({ params, body }) => {
  const key = params.section;
  if (!["video", "audio", "output", "advanced", "widgets", "ai", "bot", "general"].includes(key)) fail(404, "unknown settings section");
  if (!isObj(body)) fail(400, "body must be an object");
  if (key === "bot") {
    for (const c of body.commands ?? []) c.id ||= uid("cmd");
    for (const t of body.timers ?? []) t.id ||= uid("tmr");
  }
  // uiPrefs is replaced as a whole (no deep merge)
  if (key === "general" && "uiPrefs" in body && !isObj(body.uiPrefs)) delete body.uiPrefs;
  if (key === "general" && typeof body.kofiVerificationToken === "string") {
    if (isMasked(body.kofiVerificationToken)) delete body.kofiVerificationToken;
    else body.kofiVerificationToken = mask(body.kofiVerificationToken);
  }
  if (key === "ai" && body.llm && typeof body.llm.apiKey === "string") {
    if (isMasked(body.llm.apiKey)) delete body.llm.apiKey;
    else body.llm.apiKey = mask(body.llm.apiKey);
  }
  if (key === "output") {
    if (body.streamEncoder && body.streamEncoder !== state.output.streamEncoder && !body.streamEncoderSettings) body.streamEncoderSettings = encoderDefaults(body.streamEncoder);
    if (body.recordingEncoder && body.recordingEncoder !== state.output.recordingEncoder && !body.recordingEncoderSettings) body.recordingEncoderSettings = encoderDefaults(body.recordingEncoder);
    // encoder settings objects are replaced, not merged
    for (const k of ["streamEncoderSettings", "recordingEncoderSettings", "recordingRescale"]) {
      if (k in body) {
        state.output[k] = body[k];
        delete body[k];
      }
    }
  }
  if (key === "audio" && Array.isArray(body.trackNames)) {
    state.audio.trackNames = [...body.trackNames, "", "", "", "", "", ""].slice(0, 6);
    delete body.trackNames;
  }
  if (key === "widgets" || key === "ai") deepMerge(state[key], body);
  else Object.assign(state[key], body);
  if (key === "audio") syncGlobalAudio();
  pushState();
  return state[key];
});
route("GET", "/hotkeys", () => hotkeysFor(state));
route("PUT", "/hotkeys/:id", ({ params, body }) => {
  const id = Number(params.id);
  if (!hotkeysFor(state).some((h) => h.id === id)) fail(404, "hotkey not found");
  setHotkeyBindings(id, Array.isArray(body.bindings) ? body.bindings : []);
});

// --- destinations
function destFromBody(body, base) {
  const d = { ...base };
  for (const k of ["name", "service", "server"]) if (typeof body[k] === "string") d[k] = body[k];
  if (typeof body.enabled === "boolean") d.enabled = body.enabled;
  if (body.canvas === "horizontal" || body.canvas === "vertical") d.canvas = body.canvas;
  if ("encoderOverride" in body) d.encoderOverride = body.encoderOverride ?? null;
  if (typeof body.streamKey === "string" && !isMasked(body.streamKey)) d.streamKey = mask(body.streamKey);
  return d;
}
route("POST", "/destinations", ({ body }) => {
  const d = destFromBody(body, { id: newUuid(), name: "Destino", service: "Custom", server: "", streamKey: "", enabled: true, canvas: "horizontal", encoderOverride: null });
  state.destinations.push(d);
  pushState();
  return d;
});
route("PATCH", "/destinations/:id", ({ params, body }) => {
  const i = state.destinations.findIndex((x) => x.id === params.id);
  if (i < 0) fail(404, "destination not found");
  state.destinations[i] = destFromBody(body, state.destinations[i]);
  pushState();
  return state.destinations[i];
});
route("DELETE", "/destinations/:id", ({ params }) => {
  if (!state.destinations.some((d) => d.id === params.id)) fail(404, "destination not found");
  state.destinations = state.destinations.filter((d) => d.id !== params.id);
  outputs.delete(params.id);
  pushState();
});

// --- outputs
route("POST", "/stream/start", () => {
  if (state.status.streaming) fail(409, "already streaming");
  const enabled = state.destinations.filter((d) => d.enabled);
  if (!enabled.length) fail(400, "No hay destinos activados");
  if (enabled.some((d) => !d.streamKey && d.service !== "Custom")) fail(400, "Falta la clave de retransmisión en algún destino");
  Object.assign(state.status, { streaming: true, streamStartedAt: Date.now() });
  for (const d of enabled) startOutput(d.id, 1200 + Math.random() * 800);
  pushState();
  setTimeout(() => state.status.streaming && notify("success", "¡Estás en directo!"), 2000);
});
route("POST", "/stream/stop", () => {
  if (!state.status.streaming) return;
  Object.assign(state.status, { streaming: false, streamStartedAt: null });
  for (const d of state.destinations) outputs.delete(d.id);
  pushState();
  notify("info", "Directo finalizado");
});
let recordingPath = null;
route("POST", "/record/start", () => {
  if (state.status.recording) fail(409, "already recording");
  recordingPath = `${state.output.recordingPath}\\${stamp()}.${ext(state.output.recordingFormat)}`;
  Object.assign(state.status, { recording: true, recordingPaused: false, recordingStartedAt: Date.now() });
  startOutput("record");
  pushState();
});
route("POST", "/record/stop", () => {
  if (!state.status.recording) return;
  Object.assign(state.status, { recording: false, recordingPaused: false, recordingStartedAt: null, lastRecordingPath: recordingPath });
  outputs.delete("record");
  pushState();
  notify("success", `Grabación guardada: ${recordingPath}`);
});
route("POST", "/record/pause", ({ body }) => {
  if (!state.status.recording) fail(400, "not recording");
  state.status.recordingPaused = !!body.paused;
  pushState();
});
route("POST", "/record/split", () => {
  if (!state.status.recording) fail(400, "not recording");
  state.status.lastRecordingPath = recordingPath;
  recordingPath = `${state.output.recordingPath}\\${stamp()}.${ext(state.output.recordingFormat)}`;
  pushState();
  notify("info", "Archivo de grabación dividido");
});
route("POST", "/replay/start", () => {
  if (!state.output.replayBufferEnabled) fail(400, "El búfer de repetición está desactivado en Ajustes > Salida");
  state.status.replayBufferActive = true;
  startOutput("replay");
  pushState();
});
route("POST", "/replay/stop", () => {
  state.status.replayBufferActive = false;
  outputs.delete("replay");
  pushState();
});
route("POST", "/replay/save", () => {
  if (!state.status.replayBufferActive) fail(400, "replay buffer is not active");
  const p = `${state.output.recordingPath}\\Replay ${stamp()}.${ext(state.output.recordingFormat)}`;
  notify("success", `Repetición guardada: ${p}`);
  return { path: p };
});
route("POST", "/virtualcam/start", () => {
  state.status.virtualCamActive = true;
  startOutput("virtualcam");
  pushState();
});
route("POST", "/virtualcam/stop", () => {
  state.status.virtualCamActive = false;
  outputs.delete("virtualcam");
  pushState();
});
route("POST", "/screenshot", ({ body }) => {
  if (body.sourceUuid) findSource(body.sourceUuid);
  const p = `${state.output.recordingPath}\\Screenshot ${stamp()}.png`;
  notify("success", `Captura guardada: ${p}`);
  return { path: p };
});

// --- chat
route("GET", "/chat/history", () => chatHistory.slice(-500));
route("GET", "/alerts/recent", () => alertHistory.slice(0, 50));
route("PUT", "/chat/connections", ({ body }) => {
  let c = state.chat.find((x) => x.platform === body.platform);
  if (!c) {
    c = { platform: body.platform, channel: "", enabled: false, token: "", state: "disconnected", error: null };
    state.chat.push(c);
  }
  c.channel = body.channel ?? c.channel;
  c.enabled = !!body.enabled;
  if (typeof body.token === "string" && !isMasked(body.token)) c.token = mask(body.token);
  c.state = c.enabled && c.channel ? "connecting" : "disconnected";
  c.error = null;
  if (c.state === "connecting") {
    setTimeout(() => {
      if (c.platform === "youtube" && !c.token) {
        c.state = "error";
        c.error = "Falta la API key de YouTube";
      } else c.state = "connected";
      pushState();
    }, 1200);
  }
  pushState();
  return state.chat;
});
route("POST", "/chat/send", ({ body }) => {
  const platforms = body.platforms?.length ? body.platforms : state.chat.filter((c) => c.state === "connected").map((c) => c.platform);
  const me = { name: "vexcast_dev", color: "#22D3EE", badges: [{ id: "broadcaster", label: "Streamer" }] };
  handleBot(chatMessage(platforms[0] ?? "vexcast", me, String(body.text ?? "")));
});
route("POST", "/chat/delete", ({ body }) => void broadcast("chat_deleted", { id: body.id }));

// --- accounts (OAuth login simulation)
const OAUTH_PLATFORMS = ["twitch", "kick", "youtube"];
const OAUTH_SCOPES = {
  twitch: ["user:read:email", "channel:read:stream_key", "channel:manage:broadcast", "chat:read", "chat:edit"],
  kick: ["user:read", "channel:read", "channel:write", "chat:write"],
  youtube: ["https://www.googleapis.com/auth/youtube"],
};
const OAUTH_USERS = {
  twitch: { userId: "141981764", login: "vexcast_dev", displayName: "Vexcast_Dev", color: "#9146FF" },
  kick: { userId: "6612345", login: "vexcast", displayName: "Vexcast", color: "#53FC18" },
  youtube: { userId: "UCvexcast", login: "@vexcast", displayName: "Vexcast", color: "#FF0033" },
};
const OAUTH_SERVICE = { twitch: ["Twitch", "Twitch"], kick: ["Kick", "Kick"], youtube: ["YouTube - RTMPS", "YouTube"] };
const oauthTimers = new Map();
const avatarSvg = (letter, color) =>
  "data:image/svg+xml;utf8," +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${color}"/><text x="32" y="42" font-family="Arial,sans-serif" font-size="30" font-weight="700" text-anchor="middle" fill="#fff">${letter}</text></svg>`);
const findAccount = (platform) => {
  if (!OAUTH_PLATFORMS.includes(platform)) fail(404, "unknown platform");
  return state.accounts.find((a) => a.platform === platform) ?? fail(404, "account not found");
};
const requireConnected = (a) => (a.connected ? a : fail(400, "la cuenta no está conectada"));
const randCode = () => {
  const L = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const pick = (set, n) => Array.from({ length: n }, () => set[Math.floor(Math.random() * set.length)]).join("");
  return `${pick(L, 4)}-${pick("0123456789", 4)}`;
};
route("POST", "/oauth/:platform/start", ({ params }) => {
  const a = findAccount(params.platform);
  if (!a.available) fail(400, "Falta configurar el Client ID de la app para esta plataforma");
  clearTimeout(oauthTimers.get(a.platform));
  a.pending = true;
  a.error = null;
  oauthTimers.set(
    a.platform,
    setTimeout(() => {
      if (!a.pending) return;
      const u = OAUTH_USERS[a.platform];
      Object.assign(a, {
        connected: true,
        pending: false,
        userId: u.userId,
        login: u.login,
        displayName: u.displayName,
        avatarUrl: a.platform === "kick" ? null : avatarSvg(u.displayName[0], u.color),
        scopes: OAUTH_SCOPES[a.platform],
        error: null,
      });
      pushState();
    }, 3000),
  );
  pushState();
  if (a.platform === "twitch") return { mode: "device", verificationUri: "https://www.twitch.tv/activate", userCode: randCode(), expiresIn: 1800 };
  const st = Math.random().toString(36).slice(2, 10);
  if (a.platform === "kick")
    return { mode: "browser", url: `https://kick.com/oauth/authorize?client_id=mock&response_type=code&redirect_uri=${encodeURIComponent(`http://127.0.0.1:${PORT}/oauth/kick/callback`)}&scope=${encodeURIComponent(OAUTH_SCOPES.kick.join(" "))}&state=${st}&code_challenge_method=S256&code_challenge=mock` };
  return { mode: "browser", url: `https://accounts.google.com/o/oauth2/v2/auth?client_id=mock&response_type=code&scope=${encodeURIComponent(OAUTH_SCOPES.youtube[0])}&state=${st}` };
});
route("POST", "/oauth/:platform/cancel", ({ params }) => {
  const a = findAccount(params.platform);
  clearTimeout(oauthTimers.get(a.platform));
  a.pending = false;
  pushState();
});
route("POST", "/oauth/:platform/disconnect", ({ params }) => {
  const a = findAccount(params.platform);
  clearTimeout(oauthTimers.get(a.platform));
  Object.assign(a, { connected: false, pending: false, userId: null, login: null, displayName: null, avatarUrl: null, scopes: [], error: null });
  pushState();
});
route("POST", "/oauth/:platform/apply", ({ params, body }) => {
  const a = requireConnected(findAccount(params.platform));
  const [service, name] = OAUTH_SERVICE[a.platform];
  const warnings = [];
  let destinationId = null;
  if (body.destination) {
    const svc = SERVICES.find((s) => s.name === service);
    const server = svc?.servers[0]?.url ?? "";
    const key = mask(`live_${a.userId}_${Math.random().toString(36).slice(2, 10)}`);
    let d = state.destinations.find((x) => x.service === service);
    if (d) Object.assign(d, { server: d.server || server, streamKey: key, enabled: true });
    else {
      d = { id: newUuid(), name, service, server, streamKey: key, enabled: true, canvas: "horizontal", encoderOverride: null };
      state.destinations.push(d);
    }
    destinationId = d.id;
  }
  if (body.chat) {
    let c = state.chat.find((x) => x.platform === a.platform);
    if (!c) {
      c = { platform: a.platform, channel: "", enabled: false, token: "", state: "disconnected", error: null };
      state.chat.push(c);
    }
    Object.assign(c, { channel: a.platform === "youtube" ? a.userId : a.login, enabled: true, token: mask("oauth" + a.userId), state: "connected", error: null });
  }
  pushState();
  return { destinationId, warnings };
});
// Fake game catalog for the category search (Twitch-style box art placeholders).
const MOCK_CATEGORIES = ["Just Chatting", "Fortnite", "Minecraft", "Grand Theft Auto V", "League of Legends", "VALORANT", "Counter-Strike", "Art", "Music", "Software and Game Development", "Elden Ring", "Rocket League"].map(
  (name, i) => ({ id: String(500000 + i), name, image: avatarSvg(name[0], ["#9146FF", "#53FC18", "#F59E0B", "#38BDF8"][i % 4]) }),
);
const streamInfos = new Map(); // platform -> { title, category }
const streamInfoOf = (platform) => streamInfos.get(platform) ?? { title: "Directo de prueba con Vexcast", category: MOCK_CATEGORIES[0] };
route("GET", "/oauth/:platform/stream-info", ({ params }) => {
  requireConnected(findAccount(params.platform));
  return streamInfoOf(params.platform);
});
route("GET", "/oauth/:platform/categories", ({ params, url }) => {
  requireConnected(findAccount(params.platform));
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  if (!q) return params.platform === "kick" ? [] : MOCK_CATEGORIES.slice(0, 8);
  return MOCK_CATEGORIES.filter((c) => c.name.toLowerCase().includes(q));
});
route("POST", "/oauth/:platform/stream-info", ({ params, body }) => {
  const a = requireConnected(findAccount(params.platform));
  const cur = streamInfoOf(a.platform);
  const category = body.categoryId
    ? (MOCK_CATEGORIES.find((c) => c.id === body.categoryId) ?? cur.category)
    : typeof body.category === "string"
      ? (MOCK_CATEGORIES.find((c) => c.name.toLowerCase() === body.category.toLowerCase()) ?? { id: "custom", name: body.category, image: null })
      : cur.category;
  streamInfos.set(a.platform, { title: typeof body.title === "string" ? body.title : cur.title, category });
  pushState();
});

// --- alerts & ai
route("POST", "/alerts/test", ({ body }) => void emitAlert(body.type ?? "follow", true));
route("POST", "/alerts/skip", () => void broadcast("alert_skip"));
route("POST", "/tts/speak", ({ body }) => {
  if (state.ai.tts.provider === "none") fail(400, "TTS desactivado: elige un proveedor");
  const clip = createTts(String(body.text ?? ""));
  broadcast("tts", clip);
  return { url: clip.url };
});
route("POST", "/ai/cohost", async ({ body }) => {
  if (state.ai.llm.provider === "none") fail(400, "Configura un LLM primero");
  await new Promise((r) => setTimeout(r, 900));
  return { reply: cohostReply(String(body.text ?? "")) };
});
route("POST", "/ai/test", async () => {
  await new Promise((r) => setTimeout(r, 600));
  if (state.ai.llm.provider === "none") return { ok: false, models: [], error: "No hay proveedor configurado" };
  return { ok: true, models: ["llama3.2", "llama3.2:1b", "qwen2.5:7b", "gemma3:4b", "mistral-nemo"], error: null };
});

// --- misc
route("GET", "/pairing", () => {
  const addresses = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) addresses.push(a.address);
  if (!addresses.length) addresses.push("192.168.1.42");
  return {
    addresses,
    port: PORT,
    token: TOKEN,
    name: COMPUTER_NAME,
    qrPayload: `vexcast://connect?host=${addresses.join(",")}&port=${PORT}&token=${encodeURIComponent(TOKEN)}&name=${encodeURIComponent(COMPUTER_NAME)}`,
  };
});
route("POST", "/update/check", async () => {
  await new Promise((r) => setTimeout(r, 700));
  state.update.checkedAt = Date.now();
  pushState();
  return state.update;
});

// ------------------------------------------------------------------ preview (live PNG multipart stream)
const frameCache = new Map(); // key -> { version, png }
function previewFrame(q) {
  const source = q.get("source");
  const canvas = q.get("canvas") === "vertical" ? "vertical" : "horizontal";
  const scene = q.get("scene") || state.programSceneUuid;
  // canvas=vertical renders the scene's vertical twin; a twin uuid always renders vertical
  const key = source ? `source:${source}` : `scene:${scene}:${canvas}`;
  const hit = frameCache.get(key);
  if (hit && hit.version === stateVersion) return hit.png;
  const png = source ? renderSource(state, source) : renderScene(state, scene, { canvas, maxW: 640 });
  frameCache.set(key, { version: stateVersion, png });
  if (frameCache.size > 64) frameCache.delete(frameCache.keys().next().value);
  return png;
}
function validatePreviewTarget(q) {
  const source = q.get("source");
  const scene = q.get("scene");
  const isScene = (u) => state.scenes.some((s) => s.uuid === u) || state.verticalScenes.some((s) => s.uuid === u);
  if (source && !state.sources.some((s) => s.uuid === source) && !isScene(source)) fail(404, "source not found");
  if (scene && !isScene(scene)) fail(404, "scene not found");
}
const previewClients = new Set();
let pushTimer = null;
function schedulePreviewPush() {
  if (pushTimer || !previewClients.size) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    for (const c of previewClients) c.tick(true);
  }, 1000 / 15);
}
function servePreviewStream(req, res, q) {
  validatePreviewTarget(q);
  const BOUNDARY = "vexframe";
  res.writeHead(200, {
    "Content-Type": `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
    "Cache-Control": "no-cache, no-store, must-revalidate",
    Pragma: "no-cache",
    Connection: "close",
  });
  res.write(`--${BOUNDARY}\r\n`);
  const maxFps = Math.max(1, Math.min(15, Number(q.get("fps")) || 15));
  let lastVersion = -1,
    lastSent = 0,
    flushTimer = null;
  const writeFrame = (png) => {
    res.write(`Content-Type: image/png\r\nContent-Length: ${png.length}\r\n\r\n`);
    res.write(png);
    res.write(`\r\n--${BOUNDARY}\r\n`);
  };
  const client = {
    tick(force = false) {
      const now = Date.now();
      if (now - lastSent < 1000 / maxFps - 2) return;
      if (lastVersion === stateVersion && now - lastSent < 1000) return;
      if (res.writableLength > 4 * 1024 * 1024) return; // slow consumer: drop frames
      let png;
      try {
        png = previewFrame(q);
      } catch (e) {
        return void console.error("[mock-core] preview render failed:", e);
      }
      const changed = lastVersion !== stateVersion;
      lastVersion = stateVersion;
      lastSent = now;
      writeFrame(png);
      // Chrome only paints a multipart part once the next part starts, so
      // follow a changed frame with a copy shortly after to flush it.
      if (changed) {
        clearTimeout(flushTimer);
        flushTimer = setTimeout(() => {
          if (lastVersion === stateVersion && res.writableLength < 4 * 1024 * 1024) writeFrame(png);
        }, 120);
      }
    },
  };
  previewClients.add(client);
  client.tick(true);
  const timer = setInterval(() => client.tick(false), Math.round(1000 / maxFps));
  const close = () => {
    clearInterval(timer);
    clearTimeout(flushTimer);
    previewClients.delete(client);
  };
  req.on("close", close);
  res.on("error", close);
}
function sendPng(res, png) {
  res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store", "Content-Length": png.length });
  res.end(png);
}

// ------------------------------------------------------------------ http server
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".ico": "image/x-icon",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".webp": "image/webp",
};
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
}
function sendJson(res, status, data) {
  if (data === undefined) {
    res.writeHead(204);
    return res.end();
  }
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}
function authorized(req, url) {
  const remote = req.socket.remoteAddress ?? "";
  const local = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
  if (local && !REQUIRE_TOKEN) return true;
  const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  return bearer === TOKEN || url.searchParams.get("token") === TOKEN;
}
function serveStatic(res, root, rel) {
  const file = path.resolve(root, "." + decodeURIComponent(rel));
  if (!file.startsWith(path.resolve(root))) return false;
  let target = file;
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, "index.html");
  if (!fs.existsSync(target)) return false;
  res.writeHead(200, { "Content-Type": MIME[path.extname(target).toLowerCase()] ?? "application/octet-stream" });
  fs.createReadStream(target).pipe(res);
  return true;
}
const readBody = (req) =>
  new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const p = url.pathname;
  try {
    if (p === "/") {
      res.writeHead(302, { Location: "/app/" });
      return res.end();
    }
    if (p === "/app" || p.startsWith("/app/")) {
      const dist = path.join(REPO_ROOT, "apps/desktop/dist");
      if (serveStatic(res, dist, p.slice(4) || "/")) return;
      // SPA fallback
      if (!path.extname(p) && serveStatic(res, dist, "/index.html")) return;
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Desktop UI not built. Run: pnpm --filter @vexcast/desktop build");
    }
    if (p.startsWith("/widgets/")) {
      if (serveStatic(res, path.join(REPO_ROOT, "widgets"), p.slice("/widgets".length))) return;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(widgetPlaceholder(path.basename(p, ".html")));
    }
    if (p === "/webhooks/kofi" && req.method === "POST") {
      emitAlert("kofi");
      return sendJson(res, 200, { ok: true });
    }
    if (!p.startsWith(API)) return sendJson(res, 404, { error: "not found" });
    const apiPath = p.slice(API.length) || "/";
    if (apiPath !== "/health" && !authorized(req, url)) return sendJson(res, 401, { error: "unauthorized" });

    // Raw file upload (drag & drop of media files): stored in a temp media folder.
    if (apiPath === "/uploads" && req.method === "POST") {
      const name = path.basename(url.searchParams.get("name") || "file").replace(/[^\w.\- ]+/g, "_") || "file";
      const dir = path.join(os.tmpdir(), "vexcast-mock-media");
      fs.mkdirSync(dir, { recursive: true });
      let target = path.join(dir, name);
      for (let i = 2; fs.existsSync(target); i++) target = path.join(dir, `${path.parse(name).name} (${i})${path.parse(name).ext}`);
      const chunks = [];
      for await (const c of req) chunks.push(c);
      fs.writeFileSync(target, Buffer.concat(chunks));
      return sendJson(res, 200, { path: target });
    }

    if (req.method === "GET") {
      if (apiPath === "/preview.mjpeg") return servePreviewStream(req, res, url.searchParams);
      if (apiPath === "/preview.jpg") {
        validatePreviewTarget(url.searchParams);
        return sendPng(res, previewFrame(url.searchParams));
      }
      const snap = apiPath.match(/^\/sources\/([^/]+)\/snapshot\.(jpg|png)$/);
      if (snap) {
        const q = new URLSearchParams({ source: snap[1] });
        validatePreviewTarget(q);
        return sendPng(res, previewFrame(q));
      }
      const ttsMatch = apiPath.match(/^\/tts\/audio\/([^/]+)$/);
      if (ttsMatch) {
        const clip = ttsClips.get(ttsMatch[1].replace(/\.wav$/, ""));
        if (!clip) return sendJson(res, 404, { error: "clip not found" });
        res.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": clip.length });
        return res.end(clip);
      }
    }

    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = apiPath.match(r.re);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const body = ["POST", "PUT", "PATCH"].includes(req.method) ? await readBody(req) : {};
      const result = await r.handler({ params, body, url });
      log(req.method, apiPath);
      return sendJson(res, 200, result);
    }
    sendJson(res, 404, { error: `no route for ${req.method} ${apiPath}` });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) sendJson(res, status, { error: e.message ?? String(e) });
    else res.end();
  }
});

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== `${API}/ws` || !authorized(req, url)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

function widgetPlaceholder(name) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:transparent;font-family:system-ui,sans-serif}
  .w{position:absolute;inset:12px;display:grid;place-items:center;border-radius:16px;border:1px dashed rgba(139,92,246,.6);
  background:linear-gradient(135deg,rgba(139,92,246,.18),rgba(34,211,238,.12));color:#e9e5ff}
  b{font-size:20px;letter-spacing:.02em} small{display:block;opacity:.7;margin-top:6px;text-align:center}
  </style></head><body><div class="w"><div><b>Vexcast · ${name}</b><small>widget (mock)</small></div></div></body></html>`;
}

// ------------------------------------------------------------------ simulation loops
// Audio meters (~20 Hz): speech-like for mics, music-like for desktop/media.
const t0 = Date.now();
const noise = () => (Math.random() - 0.5) * 2;
function rawLevel(s, t, i) {
  switch (s.kind) {
    case "wasapi_input_capture": {
      const phrase = Math.sin(t * 0.45 + i) + Math.sin(t * 1.3 + i * 2) * 0.5 > -0.2;
      const syl = Math.abs(Math.sin(t * Math.PI * 4.3 + Math.sin(t * 1.7) * 2));
      return phrase ? -32 + syl * 22 + noise() * 3 : -58 + noise() * 3;
    }
    case "wasapi_output_capture":
    case "wasapi_process_output_capture":
    case "ffmpeg_source":
    case "slideshow_v2": {
      const beat = Math.pow(Math.abs(Math.sin(t * Math.PI * 2.05)), 6);
      return -24 + beat * 10 + Math.sin(t * 0.3) * 3 + noise() * 2;
    }
    case "browser_source":
      return Date.now() - lastAlertAt < 2500 ? -14 + noise() * 4 : -100;
    case "dshow_input":
      return -48 + noise() * 4;
    default:
      return -60 + noise() * 3;
  }
}
setInterval(() => {
  if (!wss.clients.size) return;
  const t = (Date.now() - t0) / 1000;
  const levels = state.sources
    .filter((s) => s.audio)
    .map((s, i) => {
      if (!s.enabled) return { sourceUuid: s.uuid, magnitude: [-100, -100], peak: [-100, -100], inputPeak: [-100, -100] };
      const base = rawLevel(s, t, i);
      const gain = s.volume > 0 ? 20 * Math.log10(s.volume) : -200;
      const pan = [Math.min(1, (1 - s.balance) * 2), Math.min(1, s.balance * 2)].map((g) => (g > 0 ? 20 * Math.log10(g) : -200));
      const ch = [0, 1].map((c) => {
        if (base <= -100) return { m: -100, p: -100, ip: -100 };
        const ip = Math.min(0, base + noise() * 1.5 + (c ? 0.6 : 0));
        const p = Math.max(-100, Math.min(0, ip + gain + pan[c]));
        return { m: +Math.max(-100, p - 6 - Math.random() * 3).toFixed(1), p: +p.toFixed(1), ip: +Math.max(-100, ip).toFixed(1) };
      });
      return { sourceUuid: s.uuid, magnitude: ch.map((c) => c.m), peak: ch.map((c) => c.p), inputPeak: ch.map((c) => c.ip) };
    });
  broadcast("levels", levels);
}, 50);

// Status + stats (~1 Hz)
setInterval(() => {
  const fps = state.video.fpsNum / state.video.fpsDen;
  statsCounters.renderTotal += Math.round(fps);
  if (Math.random() < 0.05) statsCounters.renderSkipped += 1;
  const encoding = state.status.streaming || state.status.recording;
  if (encoding) {
    statsCounters.encodingTotal += Math.round(fps);
    if (Math.random() < 0.03) statsCounters.encodingSkipped += 1;
  }
  for (const [id, o] of outputs) {
    if (o.state !== "active") continue;
    const dest = state.destinations.find((d) => d.id === id);
    const target = id === "record" ? num(state.output.streamEncoderSettings?.bitrate, 6000) * 1.5 : id === "replay" || id === "virtualcam" ? 0 : videoBitrate(dest) + state.output.streamAudioBitrate;
    if (id === "record" && state.status.recordingPaused) {
      o.kbps = 0;
      continue;
    }
    o.kbps = target ? Math.round(target + noise() * target * 0.06) : 0;
    o.totalBytes += Math.round((o.kbps * 1000) / 8);
    o.frames += Math.round(fps);
    o.congestion = dest ? Math.max(0, Math.min(1, +(0.03 + Math.random() * 0.08 + (Math.random() < 0.05 ? 0.4 : 0)).toFixed(2))) : 0;
    if (dest && Math.random() < 0.06) o.dropped += Math.ceil(Math.random() * 4);
  }
  state.status.serverTime = Date.now();
  broadcast("status", state.status);
  broadcast("stats", computeStats());
}, 1000);

function scheduleChat() {
  setTimeout(
    () => {
      if (wss.clients.size) {
        const connected = state.chat.filter((c) => c.state === "connected").map((c) => c.platform);
        if (connected.length) {
          const user = CHATTERS[Math.floor(Math.random() * CHATTERS.length)];
          const platform = user.name === "kickerz" && connected.includes("kick") ? "kick" : connected[Math.floor(Math.random() * connected.length)];
          const text = Math.random() < 0.06 ? "followers gratis en spam.link 🔥🔥" : CHAT_LINES[Math.floor(Math.random() * CHAT_LINES.length)];
          handleBot(chatMessage(platform, user, text));
        }
      }
      scheduleChat();
    },
    2500 + Math.random() * 3500,
  );
}
scheduleChat();

setInterval(() => {
  if (!wss.clients.size) return;
  const types = ["follow", "follow", "subscription", "bits", "superchat", "kofi", "raid"];
  emitAlert(types[Math.floor(Math.random() * types.length)]);
}, 32000);

for (let i = 0; i < 4; i++) {
  const msg = chatMessage(i % 2 ? "youtube" : "twitch", CHATTERS[i], CHAT_LINES[i]);
  msg.ts -= (4 - i) * 30000;
}

refresh();
server.listen(PORT, "0.0.0.0", () => {
  console.log(`[mock-core] Vexcast mock core v${VERSION} (protocol v2) on http://127.0.0.1:${PORT}  (token: ${TOKEN})`);
  console.log(`[mock-core] API: http://127.0.0.1:${PORT}${API}/state   Preview: http://127.0.0.1:${PORT}${API}/preview.mjpeg   UI: http://127.0.0.1:${PORT}/app/`);
});
