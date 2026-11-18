import { create } from "zustand";
import type { Uuid } from "@vexcast/protocol";

export type SettingsTab = "general" | "stream" | "output" | "audio" | "video" | "hotkeys" | "advanced";
export type ToolPanel = "chat" | "alerts" | "bot" | "ai" | "remote";

export type PropertiesTarget = { type: "source"; uuid: Uuid } | { type: "transition"; uuid: Uuid };

interface ConfirmRequest {
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  resolve: (ok: boolean) => void;
}

interface PromptRequest {
  title: string;
  label?: string;
  defaultValue: string;
  resolve: (value: string | null) => void;
}

interface Dialogs {
  properties: PropertiesTarget | null;
  /** Source/scene uuid whose filters are being edited. */
  filters: Uuid | null;
  transform: { scene: Uuid; item: number } | null;
  advancedAudio: boolean;
  settings: SettingsTab | null;
  /** "Create new / Add existing" dialog for a source type id. */
  addSource: string | null;
  importObs: boolean;
  about: boolean;
  releaseNotes: boolean;
  /** Title/category editor for the linked accounts. */
  streamInfo: boolean;
  /** First-run wizard. */
  wizard: boolean;
  /** Command palette (Ctrl+K). */
  palette: boolean;
  tool: ToolPanel | null;
  /** Interactive source (browser) being interacted with. */
  interact: Uuid | null;
  confirm: ConfirmRequest | null;
  prompt: PromptRequest | null;
  open: <K extends keyof Omit<Dialogs, "open" | "close">>(key: K, value: Dialogs[K]) => void;
  close: (key: keyof Omit<Dialogs, "open" | "close">) => void;
}

export const useDialogs = create<Dialogs>((set) => ({
  properties: null,
  filters: null,
  transform: null,
  advancedAudio: false,
  settings: null,
  addSource: null,
  importObs: false,
  about: false,
  releaseNotes: false,
  streamInfo: false,
  wizard: false,
  palette: false,
  tool: null,
  interact: null,
  confirm: null,
  prompt: null,
  open: (key, value) => set({ [key]: value } as Partial<Dialogs>),
  close: (key) => set({ [key]: key === "advancedAudio" || key === "importObs" || key === "about" || key === "releaseNotes" || key === "streamInfo" || key === "wizard" || key === "palette" ? false : null } as Partial<Dialogs>),
}));

export const openDialog = useDialogs.getState().open;

/** Promise-based confirmation dialog (AlertDialog). */
export function confirmDialog(opts: Omit<ConfirmRequest, "resolve">): Promise<boolean> {
  return new Promise((resolve) => useDialogs.setState({ confirm: { ...opts, resolve } }));
}

/** Promise-based text prompt (rename, new scene…). Resolves null when cancelled. */
export function promptDialog(opts: Omit<PromptRequest, "resolve">): Promise<string | null> {
  return new Promise((resolve) => useDialogs.setState({ prompt: { ...opts, resolve } }));
}
