import { useSyncExternalStore } from "react";
import type { AudioLevel } from "@vexcast/protocol";

/**
 * Audio levels (per source, per channel) arrive ~20 times per second. They live outside React state so
 * only the meters re-render, not the whole app.
 */
const levels = new Map<string, AudioLevel>();
const listeners = new Set<() => void>();

export const levelsStore = {
  set(list: AudioLevel[]) {
    for (const l of list) levels.set(l.sourceUuid, l);
    listeners.forEach((f) => f());
  },
  clear() {
    levels.clear();
    listeners.forEach((f) => f());
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  get(id: string): AudioLevel | undefined {
    return levels.get(id);
  },
};

export function useLevel(sourceUuid: string): AudioLevel | undefined {
  return useSyncExternalStore(
    levelsStore.subscribe,
    () => levelsStore.get(sourceUuid),
    () => undefined,
  );
}
