import { create } from "zustand";
import type { AccountPlatform, StreamCategory, Uuid } from "@vexcast/protocol";
import { useStore } from "./store";

/**
 * UI preferences. Persisted in the core (`general.uiPrefs`, debounced) so they
 * follow the user across reinstalls/devices; localStorage is only a fast
 * first-paint cache.
 */
export type DockId =
  | "preview"
  | "program"
  | "previewVertical"
  | "scenes"
  | "sources"
  | "mixer"
  | "transitions"
  | "controls"
  | "stats"
  | "chat"
  | "chatTwitch"
  | "chatKick"
  | "events"
  | "properties"
  | "filters"
  | "destinations"
  | "macros";
export const DOCK_IDS: DockId[] = ["preview", "program", "previewVertical", "scenes", "sources", "mixer", "transitions", "controls", "stats", "chat", "chatTwitch", "chatKick", "events", "properties", "filters", "destinations", "macros"];
export type LayoutPreset = "classic" | "streamlabs" | "compact" | "dual" | "production";

export type PreviewScaling = "window" | "canvas" | "output";
export type Page = "studio" | "chat" | "alerts" | "bot" | "ai" | "destinations" | "remote" | "reports";
export const PAGES: Page[] = ["studio", "chat", "alerts", "bot", "ai", "destinations", "remote", "reports"];

export interface Prefs {
  /** dockview.toJSON() of the Studio workspace (null = default preset). */
  dockLayout: unknown;
  /** User-saved named layouts. */
  savedLayouts: Record<string, unknown>;
  /** No drag & drop re-docking. */
  layoutLocked: boolean;
  /** The user changed the layout by hand (disables the automatic compact layout). */
  layoutCustomized: boolean;
  /** First-run wizard completed (or skipped). */
  wizardDone: boolean;
  page: Page;
  /** react-resizable-panels layouts by group id. */
  layouts: Record<string, string>;
  docks: Record<DockId, boolean>;
  mixerVertical: boolean;
  hiddenMixer: Uuid[];
  snapping: boolean;
  snapToEdges: boolean;
  snapToItems: boolean;
  snapToCenter: boolean;
  previewLocked: boolean;
  previewScaling: PreviewScaling;
  previewEnabled: boolean;
  confirmStreamStart: boolean;
  /** Show the pre-stream checklist before going live. */
  preflight: boolean;
  /** Guests invited to the stream (remote camera links). */
  guests: import("@/components/extras/guests").Guest[];
  confirmStreamStop: boolean;
  confirmRecordStop: boolean;
  /** Studio mode: double-click a scene to transition it to program. */
  studioDoubleClick: boolean;
  /** Studio mode: show the quick transition buttons. */
  studioQuickTransitions: boolean;
  /** Studio mode: swap preview/program after transitioning. */
  studioSwap: boolean;
  /** Quick transitions in studio mode (transition uuid + ms). */
  quickTransitions: { id: string; transition: Uuid | null; durationMs: number }[];
  /** Stream info editor: same title on every platform. */
  streamInfoSync: boolean;
  /** Last stream titles used (newest first). */
  recentTitles: string[];
  /** Last categories used per platform (newest first). */
  recentCategories: Partial<Record<AccountPlatform, StreamCategory[]>>;
}

const DEFAULTS: Prefs = {
  wizardDone: false,
  page: "studio",
  layouts: {},
  docks: {
    preview: true,
    program: false,
    previewVertical: false,
    scenes: true,
    sources: true,
    mixer: true,
    transitions: true,
    controls: true,
    stats: false,
    chat: false,
    chatTwitch: false,
    chatKick: false,
    events: false,
    properties: false,
    filters: false,
    destinations: false,
    macros: false,
  },
  dockLayout: null,
  savedLayouts: {},
  layoutLocked: false,
  layoutCustomized: false,
  mixerVertical: false,
  hiddenMixer: [],
  snapping: true,
  snapToEdges: true,
  snapToItems: true,
  snapToCenter: true,
  previewLocked: false,
  previewScaling: "window",
  previewEnabled: true,
  confirmStreamStart: false,
  preflight: true,
  guests: [],
  confirmStreamStop: true,
  confirmRecordStop: false,
  studioDoubleClick: true,
  studioQuickTransitions: true,
  studioSwap: false,
  quickTransitions: [
    { id: "q1", transition: null, durationMs: 300 },
    { id: "q2", transition: null, durationMs: 300 },
  ],
  streamInfoSync: true,
  recentTitles: [],
  recentCategories: {},
};

const KEY = "vexcast.prefs.v2";

function merge(p: Partial<Prefs>): Prefs {
  const m = { ...DEFAULTS, ...p, docks: { ...DEFAULTS.docks, ...(p.docks ?? {}) } };
  if (!PAGES.includes(m.page)) m.page = "studio";
  return m;
}

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const p = JSON.parse(raw) as Partial<Prefs>;
    return merge(p);
  } catch {
    return DEFAULTS;
  }
}

interface PrefsStore extends Prefs {
  set: (patch: Partial<Prefs>) => void;
  toggleDock: (id: DockId) => void;
  resetDocks: () => void;
}

export const usePrefs = create<PrefsStore>((set, get) => ({
  ...load(),
  set: (patch) => {
    set(patch);
    persist(get());
  },
  toggleDock: (id) => {
    if (dockHandler) return dockHandler(id);
    set({ docks: { ...get().docks, [id]: !get().docks[id] } });
    persist(get());
  },
  resetDocks: () => {
    set({ docks: DEFAULTS.docks, layouts: {}, dockLayout: null, layoutCustomized: false });
    persist(get());
    if (resetHandler) resetHandler();
  },
}));

let dockHandler: ((id: DockId) => void) | null = null;
let resetHandler: (() => void) | null = null;
/** The Studio workspace registers how panels are toggled/reset while it is mounted. */
export function setDockHandlers(toggle: ((id: DockId) => void) | null, reset: (() => void) | null) {
  dockHandler = toggle;
  resetHandler = reset;
}

function data(p: PrefsStore): Prefs {
  const { set: _s, toggleDock: _t, resetDocks: _r, ...rest } = p;
  return rest;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let lastSent = "";

function persist(p: PrefsStore) {
  const json = JSON.stringify(data(p));
  try {
    localStorage.setItem(KEY, json);
  } catch {
    /* ignore */
  }
  if (timer) clearTimeout(timer);
  timer = setTimeout(flushCore, 800);
}

/** Save the preferences to the core now (general.uiPrefs). */
function flushCore() {
  if (timer) clearTimeout(timer);
  timer = null;
  const client = useStore.getState().client;
  if (!client || !useStore.getState().state) return;
  const prefs = data(usePrefs.getState());
  const json = JSON.stringify(prefs);
  if (json === lastSent) return;
  lastSent = json;
  client.setGeneral({ uiPrefs: prefs as unknown as Record<string, unknown> }).catch(() => {
    lastSent = "";
  });
}

// Adopt the core's copy when it arrives or changes (another window, a reinstall…).
useStore.subscribe((st, prev) => {
  const next = st.state?.general.uiPrefs;
  if (!next || next === prev.state?.general.uiPrefs) return;
  if (Object.keys(next).length === 0) {
    // Nothing saved in the core yet: seed it with the local cache.
    flushCore();
    return;
  }
  const json = JSON.stringify(next);
  if (json === lastSent || json === JSON.stringify(data(usePrefs.getState()))) {
    lastSent = json;
    return;
  }
  lastSent = json;
  const merged = merge(next as Partial<Prefs>);
  usePrefs.setState(merged);
  try {
    localStorage.setItem(KEY, JSON.stringify(merged));
  } catch {
    /* ignore */
  }
});

/** Navigate to a main-area page. */
export function goTo(page: Page) {
  usePrefs.getState().set({ page });
}

/** react-resizable-panels storage backed by the preferences. */
export const panelStorage = {
  getItem: (name: string): string | null => usePrefs.getState().layouts[name] ?? null,
  setItem: (name: string, value: string) => {
    const p = usePrefs.getState();
    if (p.layouts[name] === value) return;
    p.set({ layouts: { ...p.layouts, [name]: value } });
  },
};
