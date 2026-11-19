import type { SceneItem, Uuid } from "./obs";
import type { AppState } from "./types";

/**
 * Whether a scene shows a source: "visible", "hidden" (in the scene but turned off) or
 * "missing". Looks inside groups and nested scenes too.
 */
export function sourceInScene(state: AppState, sceneUuid: Uuid | null, sourceUuid: Uuid): "visible" | "hidden" | "missing" {
  if (!sceneUuid) return "missing";
  const sceneIds = new Set(state.scenes.map((s) => s.uuid));
  const seen = new Set<Uuid>();
  let hidden = false;
  const walk = (items: SceneItem[], parentVisible: boolean): boolean => {
    for (const it of items) {
      const visible = parentVisible && it.visible;
      if (it.sourceUuid === sourceUuid) {
        if (visible) return true;
        hidden = true;
      }
      if (it.isGroup && it.items && walk(it.items, visible)) return true;
      if (sceneIds.has(it.sourceUuid) && !seen.has(it.sourceUuid)) {
        seen.add(it.sourceUuid);
        const nested = state.scenes.find((s) => s.uuid === it.sourceUuid);
        if (nested && walk(nested.items, visible)) return true;
      }
    }
    return false;
  };
  const scene = state.scenes.find((s) => s.uuid === sceneUuid);
  if (!scene) return "missing";
  seen.add(sceneUuid);
  if (walk(scene.items, true)) return "visible";
  return hidden ? "hidden" : "missing";
}

/** The browser source showing a phone camera room (local or internet mode). */
export function phoneCamSource<T extends { settings: Record<string, unknown> }>(sources: T[], room: string): T | undefined {
  return sources.find((s) => typeof s.settings?.url === "string" && (s.settings.url as string).includes(room));
}

/**
 * How to make a source show in a scene: the items to turn visible (the source's own item
 * and any hidden group / nested scene above it), each with the scene it belongs to.
 * `null` = the source isn't in that scene at all (add it); `[]` = it already shows.
 */
export function revealPlan(state: AppState, sceneUuid: Uuid | null, sourceUuid: Uuid): { sceneUuid: Uuid; itemId: number }[] | null {
  if (!sceneUuid) return null;
  const sceneIds = new Set(state.scenes.map((s) => s.uuid));
  const seen = new Set<Uuid>([sceneUuid]);
  let best: { sceneUuid: Uuid; itemId: number }[] | null = null;
  // Group children are addressed through the scene that holds the group.
  const walk = (owner: Uuid, items: SceneItem[], path: { sceneUuid: Uuid; itemId: number }[]) => {
    for (const it of items) {
      const here = it.visible ? path : [...path, { sceneUuid: owner, itemId: it.id }];
      if (it.sourceUuid === sourceUuid && (!best || here.length < best.length)) best = here;
      if (it.isGroup && it.items) walk(owner, it.items, here);
      if (sceneIds.has(it.sourceUuid) && !seen.has(it.sourceUuid)) {
        seen.add(it.sourceUuid);
        const nested = state.scenes.find((s) => s.uuid === it.sourceUuid);
        if (nested) walk(nested.uuid, nested.items, here);
      }
    }
  };
  const scene = state.scenes.find((s) => s.uuid === sceneUuid);
  if (scene) walk(scene.uuid, scene.items, []);
  return best;
}
