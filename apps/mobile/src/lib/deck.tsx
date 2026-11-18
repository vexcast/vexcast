/**
 * Stream Deck tab: a grid of buttons, each bound to one action of the core's
 * API (go live, switch scene, mute a source, show/hide an item…). The layout is
 * saved on the phone, per paired PC, and every button shows the live state.
 */
import type { AlertType, AppState, VexcastClient } from "@vexcast/protocol";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { IconName } from "@/components/ui";
import type { TFunction } from "@/lib/i18n";
import { getJSON, setJSON } from "@/lib/storage";
import { useRemote } from "@/state/remote";
import { colors } from "@/theme";

export type DeckAction =
  | { type: "stream" }
  | { type: "record" }
  | { type: "recordPause" }
  | { type: "recordSplit" }
  | { type: "replay" }
  | { type: "replaySave" }
  | { type: "vcam" }
  | { type: "studioMode" }
  | { type: "studioTransition" }
  | { type: "scene"; scene: string }
  | { type: "transition"; transition: string }
  | { type: "mute"; source: string }
  | { type: "visibility"; scene: string; item: number }
  | { type: "media"; source: string }
  | { type: "screenshot" }
  | { type: "skipAlert" }
  | { type: "testAlert"; alert: AlertType }
  | { type: "chat"; text: string }
  | { type: "speak"; text: string };

export type DeckActionType = DeckAction["type"];

export interface DeckButton {
  id: string;
  action: DeckAction;
  /** Custom label (empty = the action's own name). */
  label?: string;
  /** Accent used while the button is "on" (and for its icon). */
  color?: string;
}

export interface Deck {
  columns: 3 | 4;
  buttons: DeckButton[];
}

export const DECK_COLORS = ["#E5E5E5", "#EF4444", "#F97316", "#F59E0B", "#10B981", "#38BDF8", "#6366F1", "#A855F7", "#EC4899"] as const;

/** Action types in the order the editor lists them, grouped. */
export const ACTION_GROUPS: { group: "outputs" | "scenes" | "audio" | "alerts"; types: DeckActionType[] }[] = [
  { group: "outputs", types: ["stream", "record", "recordPause", "recordSplit", "replay", "replaySave", "vcam", "screenshot"] },
  { group: "scenes", types: ["scene", "studioMode", "studioTransition", "transition", "visibility", "media"] },
  { group: "audio", types: ["mute"] },
  { group: "alerts", types: ["skipAlert", "testAlert", "chat", "speak"] },
];

export const ALERT_TYPES: AlertType[] = ["follow", "subscription", "gift_sub", "raid", "bits", "superchat", "donation", "kofi", "member", "host"];

const ICONS: Record<DeckActionType, IconName> = {
  stream: "radio",
  record: "radio-button-on",
  recordPause: "pause",
  recordSplit: "cut-outline",
  replay: "film-outline",
  replaySave: "save-outline",
  vcam: "videocam-outline",
  studioMode: "git-compare-outline",
  studioTransition: "swap-horizontal",
  scene: "albums-outline",
  transition: "shuffle",
  mute: "mic",
  visibility: "eye-outline",
  media: "play",
  screenshot: "camera-outline",
  skipAlert: "play-skip-forward",
  testAlert: "notifications-outline",
  chat: "chatbubble-ellipses-outline",
  speak: "megaphone-outline",
};

export const actionIcon = (type: DeckActionType) => ICONS[type];

/** A fresh action of the given type, pointing at the first sensible target. */
export function newAction(type: DeckActionType, state: AppState | null): DeckAction {
  switch (type) {
    case "scene":
      return { type, scene: state?.scenes[0]?.uuid ?? "" };
    case "transition":
      return { type, transition: state?.transitions[0]?.uuid ?? "" };
    case "mute":
      return { type, source: state?.sources.find((s) => s.audio)?.uuid ?? "" };
    case "media":
      return { type, source: state?.sources.find((s) => s.controllableMedia)?.uuid ?? "" };
    case "visibility": {
      const scene = state?.scenes.find((s) => s.uuid === state.programSceneUuid) ?? state?.scenes[0];
      return { type, scene: scene?.uuid ?? "", item: scene?.items[0]?.id ?? -1 };
    }
    case "testAlert":
      return { type, alert: "follow" };
    case "chat":
    case "speak":
      return { type, text: "" };
    default:
      return { type } as DeckAction;
  }
}

/** What a button shows right now. */
export interface ButtonView {
  label: string;
  icon: IconName;
  /** "On": live, recording, current scene, muted, visible… */
  active: boolean;
  /** Short state line under the label. */
  status?: string;
  /** The target no longer exists (deleted scene/source). */
  missing: boolean;
  /** Can't run now (e.g. pause while not recording). */
  disabled: boolean;
  /** Color of the "on" state when the user picked none. */
  tone: string;
}

export function describe(b: DeckButton, s: AppState, t: TFunction): ButtonView {
  const a = b.action;
  const st = s.status;
  const name = (fallback: string) => b.label?.trim() || fallback;
  const base = { icon: ICONS[a.type], missing: false, disabled: false, tone: colors.primary };
  switch (a.type) {
    case "stream":
      return { ...base, label: name(st.streaming ? t("dash.endStream") : t("dash.goLive")), active: st.streaming, status: st.streaming ? t("dash.live") : undefined, tone: colors.live, disabled: !st.ready && !st.streaming };
    case "record":
      return { ...base, label: name(t("deck.a.record")), active: st.recording, status: st.recording ? (st.recordingPaused ? t("dash.paused") : "REC") : undefined, tone: colors.live, disabled: !st.ready && !st.recording };
    case "recordPause":
      return { ...base, icon: st.recordingPaused ? "play" : "pause", label: name(st.recordingPaused ? t("dash.resume") : t("dash.pause")), active: st.recordingPaused, disabled: !st.recording, tone: colors.warning };
    case "recordSplit":
      return { ...base, label: name(t("deck.a.recordSplit")), active: false, disabled: !st.recording };
    case "replay":
      return { ...base, label: name(t("deck.a.replay")), active: st.replayBufferActive, status: st.replayBufferActive ? t("common.on") : undefined };
    case "replaySave":
      return { ...base, label: name(t("dash.replaySave")), active: false, disabled: !st.replayBufferActive };
    case "vcam":
      return { ...base, label: name(t("deck.a.vcam")), active: st.virtualCamActive, status: st.virtualCamActive ? t("common.on") : undefined };
    case "studioMode":
      return { ...base, label: name(t("scenes.studio")), active: st.studioMode, status: st.studioMode ? t("common.on") : undefined };
    case "studioTransition":
      return { ...base, label: name(t("scenes.transition")), active: false, disabled: !st.studioMode };
    case "scene": {
      const scene = s.scenes.find((x) => x.uuid === a.scene);
      const program = s.programSceneUuid === a.scene;
      const preview = st.studioMode && s.previewSceneUuid === a.scene;
      return {
        ...base,
        label: name(scene?.name ?? t("deck.missing")),
        missing: !scene,
        active: program || preview,
        status: program ? t("mini.program") : preview ? t("mini.preview") : undefined,
        tone: program ? colors.live : colors.primary,
      };
    }
    case "transition": {
      const tr = s.transitions.find((x) => x.uuid === a.transition);
      return { ...base, label: name(tr?.name ?? t("deck.missing")), missing: !tr, active: s.currentTransitionUuid === a.transition };
    }
    case "mute": {
      const src = s.sources.find((x) => x.uuid === a.source);
      const muted = !!src?.muted;
      return {
        ...base,
        icon: muted ? "mic-off" : "mic",
        label: name(src?.name ?? t("deck.missing")),
        missing: !src,
        active: muted,
        status: muted ? t("audio.muted") : undefined,
        tone: colors.live,
      };
    }
    case "visibility": {
      const scene = s.scenes.find((x) => x.uuid === a.scene);
      const item = findItem(scene?.items ?? [], a.item);
      return {
        ...base,
        icon: item?.visible === false ? "eye-off-outline" : "eye-outline",
        label: name(item?.name ?? t("deck.missing")),
        missing: !item,
        active: !!item?.visible,
        status: item ? (item.visible ? t("deck.visible") : t("deck.hidden")) : undefined,
      };
    }
    case "media": {
      const src = s.sources.find((x) => x.uuid === a.source);
      const playing = src?.mediaState === "playing";
      return { ...base, icon: playing ? "pause" : "play", label: name(src?.name ?? t("deck.missing")), missing: !src, active: playing, status: playing ? t("deck.playing") : undefined };
    }
    case "screenshot":
      return { ...base, label: name(t("deck.a.screenshot")), active: false };
    case "skipAlert":
      return { ...base, label: name(t("deck.a.skipAlert")), active: false };
    case "testAlert":
      return { ...base, label: name(t(`alert.${a.alert}` as never)), active: false, status: t("alerts.testBadge") };
    case "chat":
      return { ...base, label: name(a.text || t("deck.a.chat")), active: false, disabled: !a.text.trim() };
    case "speak":
      return { ...base, label: name(a.text || t("deck.a.speak")), active: false, disabled: !a.text.trim() };
  }
}

type Item = AppState["scenes"][number]["items"][number];
function findItem(items: Item[], id: number): Item | undefined {
  for (const it of items) {
    if (it.id === id) return it;
    const nested = it.items?.length ? findItem(it.items, id) : undefined;
    if (nested) return nested;
  }
  return undefined;
}

/** Runs a button's action. Stream start/stop is confirmed by the caller. */
export async function runAction(a: DeckAction, c: VexcastClient, s: AppState): Promise<unknown> {
  const st = s.status;
  switch (a.type) {
    case "stream":
      return st.streaming ? c.stopStream() : c.startStream();
    case "record":
      return st.recording ? c.stopRecording() : c.startRecording();
    case "recordPause":
      return c.pauseRecording(!st.recordingPaused);
    case "recordSplit":
      return c.splitRecording();
    case "replay":
      return st.replayBufferActive ? c.stopReplayBuffer() : c.startReplayBuffer();
    case "replaySave":
      return c.saveReplay();
    case "vcam":
      return st.virtualCamActive ? c.stopVirtualCam() : c.startVirtualCam();
    case "studioMode":
      return c.setStudioMode(!st.studioMode);
    case "studioTransition":
      return c.transitionToProgram();
    case "scene":
      // In studio mode the core stages it in preview; a second tap on the staged scene sends it live.
      if (st.studioMode && s.previewSceneUuid === a.scene && s.programSceneUuid !== a.scene) return c.transitionToProgram();
      return c.setProgramScene(a.scene);
    case "transition":
      return c.setCurrentTransition(a.transition);
    case "mute": {
      const src = s.sources.find((x) => x.uuid === a.source);
      return c.updateSource(a.source, { muted: !src?.muted });
    }
    case "visibility": {
      const scene = s.scenes.find((x) => x.uuid === a.scene);
      const item = findItem(scene?.items ?? [], a.item);
      return c.updateItem(a.scene, a.item, { visible: !item?.visible });
    }
    case "media": {
      const src = s.sources.find((x) => x.uuid === a.source);
      const st2 = src?.mediaState;
      return c.mediaAction(a.source, st2 === "playing" ? "pause" : st2 === "ended" || st2 === "stopped" ? "restart" : "play");
    }
    case "screenshot":
      return c.screenshot();
    case "skipAlert":
      return c.skipAlert();
    case "testAlert":
      return c.testAlert(a.alert);
    case "chat":
      return c.sendChat(a.text.trim());
    case "speak":
      return c.speak(a.text.trim());
  }
}

/** A starting layout built from the PC's own scenes and audio devices. */
export function defaultDeck(s: AppState | null): Deck {
  const id = () => Math.random().toString(36).slice(2, 10);
  const buttons: DeckButton[] = [
    { id: id(), action: { type: "stream" } },
    { id: id(), action: { type: "record" } },
    { id: id(), action: { type: "replaySave" } },
  ];
  for (const scene of (s?.scenes ?? []).slice(0, 6)) buttons.push({ id: id(), action: { type: "scene", scene: scene.uuid } });
  for (const src of (s?.sources ?? []).filter((x) => x.audio && x.globalSlot != null).slice(0, 2)) buttons.push({ id: id(), action: { type: "mute", source: src.uuid } });
  buttons.push({ id: id(), action: { type: "skipAlert" } }, { id: id(), action: { type: "screenshot" } });
  return { columns: 3, buttons };
}

export const newButtonId = () => `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

// ------------------------------------------------------------------ storage (per paired PC)

interface DeckValue {
  deck: Deck | null;
  setDeck: (d: Deck) => void;
  saveButton: (b: DeckButton) => void;
  removeButton: (id: string) => void;
  moveButton: (id: string, delta: number) => void;
  reset: () => void;
}

const DeckContext = createContext<DeckValue | null>(null);
const keyFor = (connId: string) => `vexcast.deck.v1.${connId}`;

export function DeckProvider({ children }: { children: ReactNode }) {
  const { session, state } = useRemote();
  const connId = session?.conn.id ?? null;
  const [deck, setDeckState] = useState<Deck | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Load this PC's deck; the first time, build one from its state.
  useEffect(() => {
    if (!connId) {
      setDeckState(null);
      setLoadedFor(null);
      return;
    }
    let cancelled = false;
    getJSON<Deck | null>(keyFor(connId), null).then((d) => {
      if (cancelled) return;
      setDeckState(d);
      setLoadedFor(connId);
    });
    return () => {
      cancelled = true;
    };
  }, [connId]);

  useEffect(() => {
    if (connId && loadedFor === connId && deck === null && state) {
      const d = defaultDeck(state);
      setDeckState(d);
      void setJSON(keyFor(connId), d);
    }
  }, [connId, loadedFor, deck, state]);

  const setDeck = useCallback(
    (d: Deck) => {
      setDeckState(d);
      if (connId) void setJSON(keyFor(connId), d);
    },
    [connId],
  );

  const value = useMemo<DeckValue>(() => {
    const cur = deck ?? { columns: 3, buttons: [] };
    return {
      deck,
      setDeck,
      saveButton: (b) => {
        const exists = cur.buttons.some((x) => x.id === b.id);
        setDeck({ ...cur, buttons: exists ? cur.buttons.map((x) => (x.id === b.id ? b : x)) : [...cur.buttons, b] });
      },
      removeButton: (id) => setDeck({ ...cur, buttons: cur.buttons.filter((x) => x.id !== id) }),
      moveButton: (id, delta) => {
        const i = cur.buttons.findIndex((x) => x.id === id);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= cur.buttons.length) return;
        const next = [...cur.buttons];
        [next[i], next[j]] = [next[j]!, next[i]!];
        setDeck({ ...cur, buttons: next });
      },
      reset: () => setDeck(defaultDeck(state)),
    };
  }, [deck, setDeck, state]);

  return <DeckContext.Provider value={value}>{children}</DeckContext.Provider>;
}

export function useDeck(): DeckValue {
  const v = useContext(DeckContext);
  if (!v) throw new Error("useDeck outside DeckProvider");
  return v;
}
