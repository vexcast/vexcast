import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Platform } from "react-native";

import { getJSON, setJSON } from "@/lib/storage";

/**
 * Bottom navigation:
 * - `native`  iOS's own tab bar (Expo Router NativeTabs) — the system's Liquid Glass on iOS 26
 * - `glass`   the app's floating pill on Liquid Glass (expo-glass-effect) or a translucent fill
 * - `classic` the app's docked bar, like the desktop's
 */
export type TabBarStyle = "native" | "glass" | "classic";

/** iOS's tab bar is only offered on iPhone/iPad (Android's native bar is Material, not glass). */
export const nativeTabBarAvailable = Platform.OS === "ios";

export interface Prefs {
  tabBar: TabBarStyle;
  tabBarLabels: boolean;
  /** Floating program thumbnail on the tabs other than Home. */
  miniPlayer: boolean;
}

// iPhone: iOS's own bar (Liquid Glass on iOS 26). Android: the docked bar.
const DEFAULTS: Prefs = { tabBar: nativeTabBarAvailable ? "native" : "classic", tabBarLabels: true, miniPlayer: true };
const KEY = "vexcast.prefs.v2";

interface PrefsValue extends Prefs {
  setPrefs: (patch: Partial<Prefs>) => void;
}

const PrefsContext = createContext<PrefsValue | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setState] = useState<Prefs>(DEFAULTS);

  useEffect(() => {
    getJSON<Partial<Prefs>>(KEY, {}).then((p) => setState((s) => ({ ...s, ...p })));
  }, []);

  const setPrefs = useCallback((patch: Partial<Prefs>) => {
    setState((s) => {
      const next = { ...s, ...patch };
      void setJSON(KEY, next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      ...prefs,
      // A choice synced from an iPhone backup is meaningless elsewhere.
      tabBar: prefs.tabBar === "native" && !nativeTabBarAvailable ? "classic" : prefs.tabBar,
      setPrefs,
    }),
    [prefs, setPrefs],
  );
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): PrefsValue {
  const v = useContext(PrefsContext);
  if (!v) throw new Error("usePrefs outside PrefsProvider");
  return v;
}

/**
 * Extra bottom space a tab screen must leave for a floating tab bar
 * (glass and native float over the content; the docked bar takes its own room).
 */
export const TabBarInsetContext = createContext(0);
export const useTabBarInset = () => useContext(TabBarInsetContext);
