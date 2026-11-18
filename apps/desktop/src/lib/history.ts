/**
 * Undo/redo (Ctrl+Z / Ctrl+Y) for scene editing, like OBS.
 *
 * The core client is wrapped in a Proxy: every editing call (items, sources,
 * filters, scenes) captures the "before" state from the store snapshot and
 * pushes an entry with its inverse. Consecutive edits of the same thing (a
 * drag, a slider, typing in properties) are merged into one entry.
 *
 * Recreating something (undo of a delete, redo of a create) gives it a new
 * uuid / item id; the remap tables translate the old ids so older entries
 * keep working.
 */
import type { AppState, FilterInfo, SceneInfo, SceneItem, SourceInfo, Uuid, VexcastClient } from "@vexcast/protocol";
import { toast } from "sonner";
import { create } from "zustand";
import { getT } from "@/i18n";
import { fmt } from "./format";
import { errorMessage, setClientWrapper, useStore } from "./store";

interface Entry {
  label: string;
  /** Entries with the same key pushed within MERGE_MS are merged. */
  key?: string;
  ts: number;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

interface HistoryState {
  undo: Entry[];
  redo: Entry[];
  busy: boolean;
}

export const useHistory = create<HistoryState>(() => ({ undo: [], redo: [], busy: false }));

const LIMIT = 100;
const MERGE_MS = 1200;

let raw: VexcastClient | null = null;
const rc = () => {
  if (!raw) throw new Error("core not connected");
  return raw;
};

// ------------------------------------------------------------------ id remapping

const uuids = new Map<string, string>();
const itemIds = new Map<string, number>();
const U = (u: Uuid): Uuid => uuids.get(u) ?? u;
function remapUuid(orig: Uuid, next: Uuid) {
  const cur = U(orig);
  for (const [k, v] of uuids) if (v === cur) uuids.set(k, next);
  uuids.set(cur, next);
  uuids.set(orig, next);
}
const I = (scene: Uuid, id: number): number => itemIds.get(`${U(scene)}:${id}`) ?? id;
function remapItem(scene: Uuid, orig: number, next: number) {
  const s = U(scene);
  const cur = I(scene, orig);
  for (const [k, v] of itemIds) if (k.startsWith(`${s}:`) && v === cur) itemIds.set(k, next);
  itemIds.set(`${s}:${cur}`, next);
  itemIds.set(`${s}:${orig}`, next);
}

export function clearHistory() {
  useHistory.setState({ undo: [], redo: [] });
  uuids.clear();
  itemIds.clear();
}

function push(e: Omit<Entry, "ts">) {
  const now = Date.now();
  useHistory.setState((h) => {
    const last = h.undo[h.undo.length - 1];
    if (e.key && last?.key === e.key && now - last.ts < MERGE_MS) {
      return { undo: [...h.undo.slice(0, -1), { ...last, ts: now, label: e.label, redo: e.redo }], redo: [] };
    }
    return { undo: [...h.undo, { ...e, ts: now }].slice(-LIMIT), redo: [] };
  });
}

// ------------------------------------------------------------------ state lookups

const st = () => useStore.getState().state as AppState | null;
const clone = <T>(v: T): T => structuredClone(v);
function pick<T extends object>(o: T, keys: string[]): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in o) out[k] = clone((o as Record<string, unknown>)[k]);
  return out as Partial<T>;
}

const allScenes = (): SceneInfo[] => {
  const s = st();
  return s ? [...s.scenes, ...(s.verticalScenes ?? [])] : [];
};
function sceneItems(uuid: Uuid): SceneItem[] | null {
  const sc = allScenes().find((x) => x.uuid === uuid);
  if (sc) return sc.items;
  // Group children: the group's source uuid works as a scene uuid.
  const walk = (list: SceneItem[]): SceneItem[] | null => {
    for (const it of list) {
      if (it.isGroup && it.sourceUuid === uuid) return it.items ?? [];
      if (it.items) {
        const r = walk(it.items);
        if (r) return r;
      }
    }
    return null;
  };
  for (const s of allScenes()) {
    const r = walk(s.items);
    if (r) return r;
  }
  return null;
}
const findItem = (scene: Uuid, id: number) => sceneItems(scene)?.find((i) => i.id === id);
const findSource = (uuid: Uuid) => st()?.sources.find((s) => s.uuid === uuid);
const findScene = (uuid: Uuid) => allScenes().find((s) => s.uuid === uuid);
const filtersOf = (uuid: Uuid): FilterInfo[] => findSource(uuid)?.filters ?? findScene(uuid)?.filters ?? [];
const order = (scene: Uuid) => (sceneItems(scene) ?? []).map((i) => i.id);

const TRANSFORM = ["pos", "rot", "scale", "alignment", "boundsType", "boundsAlignment", "bounds", "cropToBounds", "crop"];
const ITEM = [...TRANSFORM, "visible", "locked", "blendMode", "blendMethod", "scaleFilter", "showTransition", "hideTransition"];
const SOURCE = ["enabled", "volume", "muted", "monitoring", "syncOffsetMs", "balance", "mixers", "forceMono", "pushToMute", "pushToMuteDelayMs", "pushToTalk", "pushToTalkDelayMs"];

/** Item id of a source in a scene, from a fresh copy of the core state. */
async function itemOf(scene: Uuid, source: Uuid): Promise<number | null> {
  const s = await rc().getState();
  const sc = [...s.scenes, ...(s.verticalScenes ?? [])].find((x) => x.uuid === U(scene));
  return sc?.items.find((i) => i.sourceUuid === U(source))?.id ?? null;
}

// ------------------------------------------------------------------ recreate helpers

/** Recreate a deleted source (settings, audio properties, filters); returns its new uuid. */
async function recreateSource(src: SourceInfo): Promise<Uuid> {
  const c = rc();
  const info = await c.createSource({ name: src.name, kind: src.kind, settings: src.settings });
  remapUuid(src.uuid, info.uuid);
  await c.updateSource(info.uuid, pick(src, SOURCE)).catch(() => {});
  for (const f of src.filters) await restoreFilter(info.uuid, f);
  return info.uuid;
}

async function restoreFilter(owner: Uuid, f: FilterInfo) {
  const c = rc();
  const r = await c.addFilter(owner, f.kind, f.name);
  remapUuid(f.uuid, r.uuid);
  await c.updateFilterSettings(owner, r.uuid, f.settings).catch(() => {});
  if (!f.enabled) await c.updateFilter(owner, r.uuid, { enabled: false }).catch(() => {});
}

/** Put a removed item back (recreating its source if it no longer exists). */
async function restoreItem(scene: Uuid, snap: SceneItem, prevOrder: number[] | null, src: SourceInfo | undefined) {
  const c = rc();
  let source = U(snap.sourceUuid);
  if (!findSource(source)) {
    if (!src) throw new Error(snap.name);
    source = await recreateSource(src);
  }
  const it = await c.addSourceToScene(U(scene), source);
  remapItem(scene, snap.id, it.id);
  await c.updateItem(U(scene), it.id, pick(snap, ITEM));
  if (prevOrder) await c.reorderItems(U(scene), prevOrder.map((id) => I(scene, id))).catch(() => {});
}

// ------------------------------------------------------------------ recorders

type Args = unknown[];
/** Runs before the call (captures state) and returns what to do once it succeeded. */
type Recorder = (args: Args) => ((result: unknown) => void) | null;

const h = () => getT().history;

function itemLabel(patch: Record<string, unknown>, name: string) {
  const keys = Object.keys(patch);
  const t = h();
  if (keys.length === 1 && keys[0] === "visible") return fmt(patch.visible ? t.show : t.hide, { name });
  if (keys.length === 1 && keys[0] === "locked") return fmt(patch.locked ? t.lock : t.unlock, { name });
  if (keys.every((k) => TRANSFORM.includes(k))) return fmt(t.transform, { name });
  return fmt(t.itemChange, { name });
}

const RECORDERS: Partial<Record<keyof VexcastClient, Recorder>> = {
  updateItem: ([scene, id, patch]) => {
    const item = findItem(scene as Uuid, id as number);
    if (!item) return null;
    const p = patch as Record<string, unknown>;
    const prev = pick(item, Object.keys(p));
    return () =>
      push({
        label: itemLabel(p, item.name),
        key: `item:${scene}:${id}:${Object.keys(p).sort().join(",")}`,
        undo: async () => void (await rc().updateItem(U(scene as Uuid), I(scene as Uuid, id as number), prev)),
        redo: async () => void (await rc().updateItem(U(scene as Uuid), I(scene as Uuid, id as number), p)),
      });
  },
  transformItem: ([scene, id, action]) => transformRecorder(scene as Uuid, id as number, (s, i) => rc().transformItem(s, i, action as never)),
  pasteTransform: ([scene, id]) => transformRecorder(scene as Uuid, id as number, (s, i) => rc().pasteTransform(s, i)),
  orderItem: ([scene, id, action]) => orderRecorder(scene as Uuid, () => rc().orderItem(U(scene as Uuid), I(scene as Uuid, id as number), action as never)),
  reorderItems: ([scene, ids]) => orderRecorder(scene as Uuid, () => rc().reorderItems(U(scene as Uuid), (ids as number[]).map((i) => I(scene as Uuid, i)))),
  removeItem: ([scene, id]) => {
    const s = scene as Uuid;
    const item = findItem(s, id as number);
    if (!item || item.isGroup) return null;
    const snap = clone(item);
    const prevOrder = order(s);
    const src = findSource(item.sourceUuid);
    const srcSnap = src && !src.globalSlot ? clone(src) : undefined;
    return () =>
      push({
        label: fmt(h().removeItem, { name: item.name }),
        undo: () => restoreItem(s, snap, prevOrder, srcSnap),
        redo: async () => void (await rc().removeItem(U(s), I(s, snap.id))),
      });
  },
  addSourceToScene: ([scene, source]) => {
    const s = scene as Uuid;
    const name = findSource(source as Uuid)?.name ?? findScene(source as Uuid)?.name ?? "?";
    return (result) => {
      const it = result as SceneItem;
      push({
        label: fmt(h().addItem, { name }),
        undo: async () => void (await rc().removeItem(U(s), I(s, it.id))),
        redo: async () => {
          const n = await rc().addSourceToScene(U(s), U(source as Uuid));
          remapItem(s, it.id, n.id);
        },
      });
    };
  },
  createSource: ([input]) => {
    const inp = input as { name: string; kind: string; settings?: Record<string, unknown>; sceneUuid?: Uuid };
    return (result) => {
      const info = result as SourceInfo;
      let origItem: number | null = null;
      push({
        label: fmt(h().createSource, { name: info.name }),
        undo: async () => {
          if (inp.sceneUuid && origItem === null) origItem = sceneItems(U(inp.sceneUuid))?.find((i) => i.sourceUuid === U(info.uuid))?.id ?? null;
          await rc().deleteSource(U(info.uuid));
        },
        redo: async () => {
          const n = await rc().createSource({ ...inp, name: info.name, sceneUuid: inp.sceneUuid ? U(inp.sceneUuid) : undefined });
          remapUuid(info.uuid, n.uuid);
          if (inp.sceneUuid && origItem !== null) {
            const id = await itemOf(inp.sceneUuid, n.uuid);
            if (id !== null) remapItem(inp.sceneUuid, origItem, id);
          }
        },
      });
    };
  },
  duplicateSource: ([uuid, name, scene]) => {
    return (result) => {
      const info = result as SourceInfo;
      const sc = scene as Uuid | undefined;
      let origItem: number | null = null;
      push({
        label: fmt(h().duplicateSource, { name: findSource(uuid as Uuid)?.name ?? info.name }),
        undo: async () => {
          if (sc && origItem === null) origItem = sceneItems(U(sc))?.find((i) => i.sourceUuid === U(info.uuid))?.id ?? null;
          await rc().deleteSource(U(info.uuid));
        },
        redo: async () => {
          const n = await rc().duplicateSource(U(uuid as Uuid), (name as string) || info.name, sc ? U(sc) : undefined);
          remapUuid(info.uuid, n.uuid);
          if (sc && origItem !== null) {
            const id = await itemOf(sc, n.uuid);
            if (id !== null) remapItem(sc, origItem, id);
          }
        },
      });
    };
  },
  deleteSource: ([uuid]) => {
    const src = findSource(uuid as Uuid);
    if (!src || src.globalSlot) return null;
    const snap = clone(src);
    // Every scene that shows it (top level and inside groups).
    const places: { scene: Uuid; item: SceneItem; order: number[] }[] = [];
    const visit = (scene: Uuid, items: SceneItem[]) => {
      for (const it of items) {
        if (it.sourceUuid === src.uuid) places.push({ scene, item: clone(it), order: items.map((x) => x.id) });
        if (it.isGroup && it.items) visit(it.sourceUuid, it.items);
      }
    };
    for (const s of allScenes()) visit(s.uuid, s.items);
    return () =>
      push({
        label: fmt(h().deleteSource, { name: src.name }),
        undo: async () => {
          await recreateSource(snap);
          for (const p of places) await restoreItem(p.scene, p.item, p.order, undefined);
        },
        redo: async () => void (await rc().deleteSource(U(snap.uuid))),
      });
  },
  updateSource: ([uuid, patch]) => {
    const src = findSource(uuid as Uuid);
    if (!src) return null;
    const p = patch as Record<string, unknown>;
    const keys = Object.keys(p);
    const prev = pick(src, keys);
    const t = h();
    const label =
      "name" in p
        ? fmt(t.rename, { name: src.name })
        : "volume" in p || "volumeDb" in p
          ? fmt(t.volume, { name: src.name })
          : keys.length === 1 && "muted" in p
            ? fmt(p.muted ? t.mute : t.unmute, { name: src.name })
            : fmt(t.sourceChange, { name: src.name });
    return () =>
      push({
        label,
        key: `src:${uuid}:${keys.sort().join(",")}`,
        undo: async () => void (await rc().updateSource(U(uuid as Uuid), prev)),
        redo: async () => void (await rc().updateSource(U(uuid as Uuid), p)),
      });
  },
  updateSourceSettings: ([uuid, settings]) => {
    const src = findSource(uuid as Uuid);
    if (!src) return null;
    const s = settings as Record<string, unknown>;
    const prev = pick(src.settings, Object.keys(s));
    return () =>
      push({
        label: fmt(h().settings, { name: src.name }),
        key: `settings:${uuid}`,
        undo: async () => void (await rc().updateSourceSettings(U(uuid as Uuid), prev)),
        redo: async () => void (await rc().updateSourceSettings(U(uuid as Uuid), s)),
      });
  },
  resetSourceSettings: ([uuid]) => {
    const src = findSource(uuid as Uuid);
    if (!src) return null;
    const prev = clone(src.settings);
    return () =>
      push({
        label: fmt(h().settings, { name: src.name }),
        undo: async () => void (await rc().updateSourceSettings(U(uuid as Uuid), prev)),
        redo: async () => void (await rc().resetSourceSettings(U(uuid as Uuid))),
      });
  },
  addFilter: ([owner, kind, name]) => (result) => {
    const r = result as { uuid: Uuid };
    push({
      label: fmt(h().addFilter, { name: name as string }),
      undo: async () => void (await rc().removeFilter(U(owner as Uuid), U(r.uuid))),
      redo: async () => {
        const n = await rc().addFilter(U(owner as Uuid), kind as string, name as string);
        remapUuid(r.uuid, n.uuid);
      },
    });
  },
  removeFilter: ([owner, filter]) => {
    const list = filtersOf(owner as Uuid);
    const f = list.find((x) => x.uuid === filter);
    if (!f) return null;
    const snap = clone(f);
    const prevOrder = list.map((x) => x.uuid);
    return () =>
      push({
        label: fmt(h().removeFilter, { name: f.name }),
        undo: async () => {
          await restoreFilter(U(owner as Uuid), snap);
          await rc().reorderFilters(U(owner as Uuid), prevOrder.map(U)).catch(() => {});
        },
        redo: async () => void (await rc().removeFilter(U(owner as Uuid), U(snap.uuid))),
      });
  },
  updateFilter: ([owner, filter, patch]) => {
    const f = filtersOf(owner as Uuid).find((x) => x.uuid === filter);
    if (!f) return null;
    const p = patch as { name?: string; enabled?: boolean };
    const prev = pick(f, Object.keys(p)) as { name?: string; enabled?: boolean };
    return () =>
      push({
        label: fmt(h().filterChange, { name: f.name }),
        key: `filter:${filter}:${Object.keys(p).sort().join(",")}`,
        undo: async () => void (await rc().updateFilter(U(owner as Uuid), U(filter as Uuid), prev)),
        redo: async () => void (await rc().updateFilter(U(owner as Uuid), U(filter as Uuid), p)),
      });
  },
  updateFilterSettings: ([owner, filter, settings]) => {
    const f = filtersOf(owner as Uuid).find((x) => x.uuid === filter);
    if (!f) return null;
    const s = settings as Record<string, unknown>;
    const prev = pick(f.settings, Object.keys(s));
    return () =>
      push({
        label: fmt(h().filterChange, { name: f.name }),
        key: `fsettings:${filter}`,
        undo: async () => void (await rc().updateFilterSettings(U(owner as Uuid), U(filter as Uuid), prev)),
        redo: async () => void (await rc().updateFilterSettings(U(owner as Uuid), U(filter as Uuid), s)),
      });
  },
  reorderFilters: ([owner, list]) => {
    const prev = filtersOf(owner as Uuid).map((x) => x.uuid);
    return () =>
      push({
        label: h().filterOrder,
        undo: async () => void (await rc().reorderFilters(U(owner as Uuid), prev.map(U))),
        redo: async () => void (await rc().reorderFilters(U(owner as Uuid), (list as Uuid[]).map(U))),
      });
  },
  createScene: ([name]) => (result) => {
    const r = result as { uuid: Uuid };
    push({
      label: fmt(h().createScene, { name: name as string }),
      undo: async () => void (await rc().deleteScene(U(r.uuid))),
      redo: async () => {
        const n = await rc().createScene(name as string);
        remapUuid(r.uuid, n.uuid);
      },
    });
  },
  duplicateScene: ([uuid, name]) => (result) => {
    const r = result as { uuid: Uuid };
    push({
      label: fmt(h().duplicateScene, { name: findScene(uuid as Uuid)?.name ?? (name as string) }),
      undo: async () => void (await rc().deleteScene(U(r.uuid))),
      redo: async () => {
        const n = await rc().duplicateScene(U(uuid as Uuid), name as string);
        remapUuid(r.uuid, n.uuid);
      },
    });
  },
  renameScene: ([uuid, name]) => {
    const sc = findScene(uuid as Uuid);
    if (!sc) return null;
    const prev = sc.name;
    return () =>
      push({
        label: fmt(h().renameScene, { name: prev }),
        undo: async () => void (await rc().renameScene(U(uuid as Uuid), prev)),
        redo: async () => void (await rc().renameScene(U(uuid as Uuid), name as string)),
      });
  },
  reorderScenes: ([list]) => {
    const prev = (st()?.scenes ?? []).map((s) => s.uuid);
    return () =>
      push({
        label: h().sceneOrder,
        undo: async () => void (await rc().reorderScenes(prev.map(U))),
        redo: async () => void (await rc().reorderScenes((list as Uuid[]).map(U))),
      });
  },
  deleteScene: ([uuid]) => {
    const sc = findScene(uuid as Uuid);
    if (!sc) return null;
    const snap = clone(sc);
    const prevOrder = (st()?.scenes ?? []).map((s) => s.uuid);
    // Sources that only live in this scene are destroyed with it.
    const sources = new Map<Uuid, SourceInfo>();
    for (const it of sc.items) {
      const s = findSource(it.sourceUuid);
      if (s && !s.globalSlot) sources.set(s.uuid, clone(s));
    }
    return () =>
      push({
        label: fmt(h().deleteScene, { name: sc.name }),
        undo: async () => {
          const n = await rc().createScene(snap.name);
          remapUuid(snap.uuid, n.uuid);
          for (const it of snap.items) {
            if (it.isGroup) continue;
            await restoreItem(snap.uuid, it, null, sources.get(it.sourceUuid)).catch(() => {});
          }
          for (const f of snap.filters) await restoreFilter(U(snap.uuid), f).catch(() => {});
          await rc().reorderScenes(prevOrder.map(U)).catch(() => {});
        },
        redo: async () => void (await rc().deleteScene(U(snap.uuid))),
      });
  },
};

function transformRecorder(scene: Uuid, id: number, again: (s: Uuid, i: number) => Promise<unknown>): ((r: unknown) => void) | null {
  const item = findItem(scene, id);
  if (!item) return null;
  const prev = pick(item, TRANSFORM);
  return () =>
    push({
      label: fmt(h().transform, { name: item.name }),
      undo: async () => void (await rc().updateItem(U(scene), I(scene, id), prev)),
      redo: async () => void (await again(U(scene), I(scene, id))),
    });
}

function orderRecorder(scene: Uuid, again: () => Promise<unknown>): ((r: unknown) => void) | null {
  const prev = order(scene);
  return () =>
    push({
      label: h().order,
      undo: async () => void (await rc().reorderItems(U(scene), prev.map((i) => I(scene, i)))),
      redo: async () => void (await again()),
    });
}

/** Structural changes the history can't follow: start over. */
const CLEARS = new Set<string>(["groupItems", "ungroupItem", "switchSceneCollection", "createSceneCollection", "deleteSceneCollection", "importObsCollection", "arrangeVertical", "setupDevices"]);

/** Wrap the core client so editing calls are recorded. */
export function withHistory(client: VexcastClient): VexcastClient {
  raw = client;
  return new Proxy(client, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver);
      if (typeof prop !== "string" || typeof v !== "function") return v;
      const rec = RECORDERS[prop as keyof VexcastClient];
      if (rec) {
        return async (...args: Args) => {
          let after: ((r: unknown) => void) | null = null;
          try {
            after = rec(args);
          } catch {
            after = null;
          }
          const r = await (v as (...a: Args) => Promise<unknown>)(...args);
          try {
            after?.(r);
          } catch {
            /* never break the real call */
          }
          return r;
        };
      }
      if (CLEARS.has(prop)) {
        return async (...args: Args) => {
          const r = await (v as (...a: Args) => Promise<unknown>)(...args);
          clearHistory();
          return r;
        };
      }
      return v;
    },
  });
}

setClientWrapper(withHistory);

// The scene collection changed (from here, the remote app or a hotkey): ids are meaningless now.
useStore.subscribe((s, prev) => {
  const a = s.state?.sceneCollection;
  const b = prev.state?.sceneCollection;
  if (a && b && a !== b) clearHistory();
});

// ------------------------------------------------------------------ actions

async function step(dir: "undo" | "redo") {
  const st0 = useHistory.getState();
  if (st0.busy) return;
  const t = h();
  const list = dir === "undo" ? st0.undo : st0.redo;
  const e = list[list.length - 1];
  if (!e) {
    toast(dir === "undo" ? t.nothingUndo : t.nothingRedo, { duration: 1500 });
    return;
  }
  useHistory.setState({ busy: true });
  try {
    await (dir === "undo" ? e.undo() : e.redo());
    useHistory.setState((s) =>
      dir === "undo" ? { undo: s.undo.slice(0, -1), redo: [...s.redo, { ...e, ts: 0 }] } : { redo: s.redo.slice(0, -1), undo: [...s.undo, { ...e, ts: 0 }] },
    );
    toast(fmt(dir === "undo" ? t.undone : t.redone, { label: e.label }), { duration: 1500 });
  } catch (err) {
    toast.error(fmt(t.failed, { label: e.label, error: errorMessage(err) }));
    // Drop the broken entry so the rest of the history stays usable.
    useHistory.setState((s) => (dir === "undo" ? { undo: s.undo.slice(0, -1) } : { redo: s.redo.slice(0, -1) }));
  } finally {
    useHistory.setState({ busy: false });
  }
}

export const undo = () => step("undo");
export const redo = () => step("redo");

// Dev builds: reachable from the console / automated UI checks.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__vexcastHistory = { undo, redo, useHistory, client: () => useStore.getState().client, state: () => useStore.getState().state };
}

/** Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z, except while typing in a text field (native undo there). */
export function installUndoShortcuts(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k !== "z" && k !== "y") return;
    const el = document.activeElement as HTMLElement | null;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
    e.preventDefault();
    if (k === "y" || e.shiftKey) void redo();
    else void undo();
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
