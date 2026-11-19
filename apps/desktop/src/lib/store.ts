import { create } from "zustand";
import { toast } from "sonner";
import type { HealthReport, AlertEvent, AppState, AudioLevel, ChatMessage, SceneInfo, SceneItem, ServerEvent, Stats, Uuid, VexcastClient } from "@vexcast/protocol";
import { ApiError } from "@vexcast/protocol";
import { createClient } from "./core";

interface Store {
  client: VexcastClient | null;
  /** WebSocket connected. */
  connected: boolean;
  /** Initial discovery/state load failed. */
  bootError: string | null;
  state: AppState | null;
  stats: Stats | null;
  /** Stream health assistant's last report. */
  health: HealthReport | null;
  levels: Record<Uuid, AudioLevel>;
  chat: ChatMessage[];
  /** Message shown on stream by the highlight widget. */
  highlight: import("@vexcast/protocol").ChatHighlight | null;
  /** Chat poll running or shown. */
  poll: import("@vexcast/protocol").Poll | null;
  /** Giveaway running or shown. */
  giveaway: import("@vexcast/protocol").Giveaway | null;
  /** Song request queue. */
  songs: import("@vexcast/protocol").SongQueue | null;
  /** Phones sending their camera over the local network. */
  phoneCams: import("@vexcast/protocol").PhoneCam[];
  events: AlertEvent[];
  /** serverTime - Date.now(), to compute uptimes without clock skew. */
  clockOffset: number;
  updateDismissed: boolean;

  /** Selected scene item ids (in the scene being edited). */
  selection: number[];
  /** Optimistic transforms while dragging in the preview (item id -> patch). */
  overrides: Record<number, Partial<SceneItem>>;
  /** Source clipboard (Copy / Paste reference / Paste duplicate). */
  clipboard: Uuid | null;
  /** Canvas being edited/previewed (vertical = 9:16 twin scenes). */
  canvas: "horizontal" | "vertical";
  /** Canvas shown by the main Preview panel (its Horizontal | Vertical toggle). */
  previewCanvas: "horizontal" | "vertical";

  select: (ids: number[]) => void;
  setCanvas: (c: "horizontal" | "vertical") => void;
  setPreviewCanvas: (c: "horizontal" | "vertical") => void;
  setOverride: (id: number, patch: Partial<SceneItem> | null) => void;
  clearOverrides: () => void;
  setClipboard: (uuid: Uuid | null) => void;
  dismissUpdate: () => void;
  /** Optimistic local update of AppState. */
  mutate: (fn: (s: AppState) => AppState) => void;
}

/** Stable empty array for selectors (avoids re-render loops). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const EMPTY: any[] = [];

const MAX_CHAT = 500;
const MAX_EVENTS = 200;

export const useStore = create<Store>((set, get) => ({
  client: null,
  connected: false,
  bootError: null,
  state: null,
  stats: null,
  health: null,
  levels: {},
  chat: [],
  highlight: null,
  poll: null,
  giveaway: null,
  songs: null,
  phoneCams: [],
  events: [],
  clockOffset: 0,
  updateDismissed: false,
  selection: [],
  overrides: {},
  clipboard: null,
  canvas: "horizontal",
  previewCanvas: "horizontal",

  select: (selection) => set({ selection }),
  setCanvas: (canvas) => (get().canvas === canvas ? undefined : set({ canvas, selection: [], overrides: {} })),
  setPreviewCanvas: (previewCanvas) => set({ previewCanvas, ...(get().canvas !== previewCanvas ? { canvas: previewCanvas, selection: [], overrides: {} } : {}) }),
  setOverride: (id, patch) => {
    const overrides = { ...get().overrides };
    if (patch) overrides[id] = { ...overrides[id], ...patch };
    else delete overrides[id];
    set({ overrides });
  },
  clearOverrides: () => set({ overrides: {} }),
  setClipboard: (clipboard) => set({ clipboard }),
  dismissUpdate: () => set({ updateDismissed: true }),
  mutate: (fn) => {
    const s = get().state;
    if (s) set({ state: fn(s) });
  },
}));

function offset(status: { serverTime?: number } | undefined): { clockOffset?: number } {
  return typeof status?.serverTime === "number" && status.serverTime > 0 ? { clockOffset: status.serverTime - Date.now() } : {};
}

function notify(level: "info" | "success" | "warning" | "error", message: string) {
  if (level === "success") toast.success(message);
  else if (level === "warning") toast.warning(message);
  else if (level === "error") toast.error(message);
  else toast(message);
}

function handleEvent(ev: ServerEvent) {
  const { getState: get, setState: set } = useStore;
  switch (ev.type) {
    case "state": {
      // Drop selections that no longer exist in the edited scene.
      const scene = editingScene(ev.data);
      const ids = new Set(scene ? flattenItems(scene.items).map((i) => i.id) : []);
      const sel = get().selection.filter((id) => ids.has(id));
      set({ state: ev.data, ...offset(ev.data.status), ...(sel.length !== get().selection.length ? { selection: sel } : {}) });
      break;
    }
    case "status": {
      const s = get().state;
      if (s) set({ state: { ...s, status: ev.data }, ...offset(ev.data) });
      break;
    }
    case "stats":
      set({ stats: ev.data });
      break;
    case "health":
      set({ health: ev.data });
      break;
    case "chat_translated": {
      const { id, text } = ev.data;
      set({ chat: get().chat.map((m) => (m.id === id ? { ...m, translated: text } : m)) });
      break;
    }
    case "levels": {
      const levels: Record<string, AudioLevel> = {};
      for (const l of ev.data) levels[l.sourceUuid] = l;
      set({ levels });
      break;
    }
    case "chat": {
      const chat = get().chat;
      const idx = chat.findIndex((m) => m.id === ev.data.id);
      if (idx >= 0) {
        const next = chat.slice();
        next[idx] = ev.data;
        set({ chat: next });
        break;
      }
      const next = chat.length >= MAX_CHAT ? chat.slice(chat.length - MAX_CHAT + 1) : chat.slice();
      next.push(ev.data);
      set({ chat: next });
      break;
    }
    case "chat_deleted":
      set({ chat: get().chat.filter((m) => m.id !== ev.data.id) });
      break;
    case "chat_highlight":
      set({ highlight: ev.data });
      break;
    case "poll":
      set({ poll: ev.data });
      break;
    case "giveaway":
      set({ giveaway: ev.data });
      break;
    case "songs":
      set({ songs: ev.data });
      break;
    case "phone_cams":
      set({ phoneCams: ev.data });
      break;
    case "alert":
      set({ events: [ev.data, ...get().events.filter((e) => e.id !== ev.data.id)].slice(0, MAX_EVENTS) });
      break;
    case "notification":
      notify(ev.data.level, ev.data.message);
      break;
    default:
      break;
  }
}

async function prefill(client: VexcastClient) {
  const { getState: get, setState: set } = useStore;
  const [history, alerts, highlight] = await Promise.all([client.chatHistory().catch(() => []), client.recentAlerts().catch(() => []), client.chatHighlight().catch(() => null)]);
  set({ highlight, poll: await client.poll().catch(() => null), giveaway: await client.giveaway().catch(() => null), songs: await client.songs().catch(() => null), phoneCams: await client.phoneCams().catch(() => []) });
  if (history.length) {
    const byId = new Map<string, ChatMessage>();
    for (const m of [...history, ...get().chat]) byId.set(m.id, m);
    set({ chat: [...byId.values()].sort((a, b) => a.ts - b.ts).slice(-MAX_CHAT) });
  }
  if (alerts.length) {
    const byId = new Map<string, AlertEvent>();
    for (const a of [...alerts, ...get().events]) byId.set(a.id, a);
    set({ events: [...byId.values()].sort((a, b) => b.ts - a.ts).slice(0, MAX_EVENTS) });
  }
}

let wrapClient = (c: VexcastClient) => c;
/** Lets a module wrap the client before the app uses it (undo history). */
export function setClientWrapper(f: (c: VexcastClient) => VexcastClient) {
  wrapClient = f;
}

let booted = false;
export async function boot() {
  if (booted) return;
  booted = true;
  const { setState: set } = useStore;
  let client: VexcastClient;
  try {
    client = await createClient();
  } catch (e) {
    set({ bootError: String(e) });
    return;
  }
  set({ client: wrapClient(client) });
  client.onConnectionChange((connected) => {
    set({ connected });
    if (connected) {
      client
        .getState()
        .then((state) => set({ state, bootError: null, ...offset(state.status) }))
        .catch(() => {});
      prefill(client);
    }
  });
  client.subscribe(handleEvent);
  try {
    const state = await client.getState();
    set({ state, bootError: null, ...offset(state.status) });
  } catch (e) {
    set({ bootError: e instanceof Error ? e.message : String(e) });
  }
}

/** Shortcut to the client (only call after boot, from event handlers). */
export const api = (): VexcastClient => {
  const c = useStore.getState().client;
  if (!c) throw new Error("core not connected");
  return c;
};

export function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
}

/** Run an API call, toasting errors. Returns undefined on failure. */
export async function act<T>(fn: (c: VexcastClient) => Promise<T>, success?: string): Promise<T | undefined> {
  try {
    const r = await fn(api());
    if (success) toast.success(success);
    return r;
  } catch (e) {
    toast.error(errorMessage(e) || "Error");
    return undefined;
  }
}

/** Select AppState (non-null inside the app shell). */
export function useAppState<T>(sel: (s: AppState) => T): T {
  return useStore((st) => sel(st.state as AppState));
}

// ------------------------------------------------------------------ scene helpers

/** Scene or vertical twin by uuid. */
export function findScene(s: AppState, uuid: Uuid | null): SceneInfo | null {
  if (!uuid) return null;
  return s.scenes.find((x) => x.uuid === uuid) ?? s.verticalScenes?.find((x) => x.uuid === uuid) ?? null;
}

/** Whether the vertical canvas is being edited. */
export function isVertical(s: AppState, canvas = useStore.getState().canvas): boolean {
  return canvas === "vertical" && !!s.video.verticalEnabled;
}

/** Horizontal scene the editor follows: preview scene in studio mode, else program. */
export function baseSceneUuid(s: AppState): Uuid | null {
  return s.status.studioMode && s.previewSceneUuid ? s.previewSceneUuid : s.programSceneUuid;
}

/** The scene the editor works on (the vertical twin when editing the 9:16 canvas). */
export function editingSceneUuid(s: AppState, canvas = useStore.getState().canvas): Uuid | null {
  const id = baseSceneUuid(s);
  if (!isVertical(s, canvas)) return id;
  return s.scenes.find((x) => x.uuid === id)?.verticalSceneUuid ?? null;
}

export function editingScene(s: AppState, canvas = useStore.getState().canvas): SceneInfo | null {
  return findScene(s, editingSceneUuid(s, canvas));
}

/** Canvas size of a scene (vertical twins use the vertical canvas). */
export function canvasSize(s: AppState, sceneUuid: Uuid | null): { w: number; h: number } {
  const v = !!sceneUuid && !!s.verticalScenes?.some((x) => x.uuid === sceneUuid);
  return v ? { w: s.video.verticalWidth, h: s.video.verticalHeight } : { w: s.video.baseWidth, h: s.video.baseHeight };
}

/** Apply a patch to one scene (horizontal or vertical twin). */
export function mapScene(s: AppState, uuid: Uuid, fn: (sc: SceneInfo) => SceneInfo): AppState {
  return {
    ...s,
    scenes: s.scenes.map((sc) => (sc.uuid === uuid ? fn(sc) : sc)),
    verticalScenes: (s.verticalScenes ?? []).map((sc) => (sc.uuid === uuid ? fn(sc) : sc)),
  };
}

export function useEditingScene(): SceneInfo | null {
  return useStore((st) => (st.state ? editingScene(st.state, st.canvas) : null));
}

/** All items including group children (depth-first). */
export function flattenItems(items: SceneItem[]): SceneItem[] {
  const out: SceneItem[] = [];
  for (const it of items) {
    out.push(it);
    if (it.isGroup && it.items) out.push(...flattenItems(it.items));
  }
  return out;
}

export function findItem(scene: SceneInfo | null, id: number): SceneItem | null {
  if (!scene) return null;
  return flattenItems(scene.items).find((i) => i.id === id) ?? null;
}

/** Group that contains this item (null when top-level). */
export function parentGroup(scene: SceneInfo, id: number): SceneItem | null {
  for (const it of scene.items) if (it.isGroup && it.items?.some((c) => c.id === id)) return it;
  return null;
}
