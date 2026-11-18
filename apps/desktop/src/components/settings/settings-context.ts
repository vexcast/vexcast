import type { AdvancedSettings, AudioSettings, GeneralSettings, Hotkey, OutputSettings, VideoSettings } from "@vexcast/protocol";
import { createContext, useContext } from "react";
import type { Prefs } from "@/lib/prefs";

export type UiPrefs = Pick<Prefs, "confirmStreamStart" | "confirmStreamStop" | "confirmRecordStop" | "studioDoubleClick" | "studioQuickTransitions" | "studioSwap" | "snapping" | "preflight">;

export interface SettingsDraft {
  video: VideoSettings;
  audio: AudioSettings;
  output: OutputSettings;
  advanced: AdvancedSettings;
  general: GeneralSettings;
  prefs: UiPrefs;
  /** Changed hotkey bindings (id -> bindings). */
  hotkeys: Record<number, Hotkey["bindings"]>;
}

export interface SettingsCtx {
  draft: SettingsDraft;
  set: <K extends Exclude<keyof SettingsDraft, "hotkeys">>(key: K, patch: Partial<SettingsDraft[K]>) => void;
  setHotkey: (id: number, bindings: Hotkey["bindings"]) => void;
}

export const SettingsContext = createContext<SettingsCtx | null>(null);

export function useSettings(): SettingsCtx {
  const c = useContext(SettingsContext);
  if (!c) throw new Error("SettingsContext missing");
  return c;
}
