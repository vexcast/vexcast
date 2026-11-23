/** User actions shared by docks, menus, hotkeys and the preview. */
import { preflightDialog } from "@/components/dialogs/preflight-dialog";
import type { OrderAction, SceneInfo, SceneItem, TransformAction, Uuid } from "@vexcast/protocol";
import { toast } from "sonner";
import { getT } from "@/i18n";
import { confirmDialog, openDialog, promptDialog } from "./dialogs";
import { fmt } from "./format";
import { usePrefs } from "./prefs";
import { act, api, editingScene, editingSceneUuid, errorMessage, findItem, flattenItems, mapScene, useStore } from "./store";
import { exitApp, openExternal, pickSaveFile, revealPath } from "./tauri";

const st = () => useStore.getState().state!;

function uniqueName(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) {
    const n = `${base} ${i}`;
    if (!taken.includes(n)) return n;
  }
}

// ------------------------------------------------------------------ scenes

export async function addScene() {
  const t = getT();
  const names = st().scenes.map((s) => s.name);
  let n = st().scenes.length + 1;
  while (names.includes(fmt(t.scenes.defaultName, { n }))) n++;
  const name = await promptDialog({ title: t.scenes.newTitle, label: t.scenes.nameLabel, defaultValue: fmt(t.scenes.defaultName, { n }) });
  if (!name?.trim()) return;
  await act((c) => c.createScene(name.trim()));
}

export async function renameScene(scene: SceneInfo) {
  const t = getT();
  const name = await promptDialog({ title: t.scenes.rename, label: t.scenes.nameLabel, defaultValue: scene.name });
  if (!name?.trim() || name === scene.name) return;
  await act((c) => c.renameScene(scene.uuid, name.trim()));
}

export async function duplicateScene(scene: SceneInfo) {
  const t = getT();
  const def = uniqueName(fmt(t.scenes.duplicateName, { name: scene.name }), st().scenes.map((s) => s.name));
  const name = await promptDialog({ title: t.scenes.duplicate, label: t.scenes.nameLabel, defaultValue: def });
  if (!name?.trim()) return;
  await act((c) => c.duplicateScene(scene.uuid, name.trim()));
}

export async function removeScene(scene: SceneInfo) {
  const t = getT();
  const ok = await confirmDialog({ title: fmt(t.scenes.removeConfirm, { name: scene.name }), description: t.scenes.removeDesc, confirmLabel: t.common.delete, destructive: true });
  if (ok) await act((c) => c.deleteScene(scene.uuid));
}

export function moveScene(scene: SceneInfo, action: OrderAction) {
  const ids = st().scenes.map((s) => s.uuid);
  const i = ids.indexOf(scene.uuid);
  ids.splice(i, 1);
  const to = action === "up" ? Math.max(0, i - 1) : action === "down" ? Math.min(ids.length, i + 1) : action === "top" ? 0 : ids.length;
  ids.splice(to, 0, scene.uuid);
  return act((c) => c.reorderScenes(ids));
}

/** Click on a scene: program (or preview in studio mode). */
export function activateScene(uuid: Uuid) {
  const s = st();
  if (s.status.studioMode) return act((c) => c.setPreviewScene(uuid));
  return act((c) => c.setProgramScene(uuid));
}

export function transitionToProgram() {
  return act((c) => c.transitionToProgram());
}

// ------------------------------------------------------------------ items

export function sceneUuid(): Uuid | null {
  return editingSceneUuid(st());
}

export function selectedItems(): SceneItem[] {
  const scene = editingScene(st());
  const sel = useStore.getState().selection;
  return sel.map((id) => findItem(scene, id)).filter((x): x is SceneItem => !!x);
}

export function updateItem(scene: Uuid, id: number, patch: Partial<SceneItem>) {
  // Optimistic local update so lists/toggles feel instant.
  useStore.getState().mutate((s) => mapScene(s, scene, (sc) => ({ ...sc, items: patchItems(sc.items, id, patch) })));
  return act((c) => c.updateItem(scene, id, patch));
}

function patchItems(items: SceneItem[], id: number, patch: Partial<SceneItem>): SceneItem[] {
  return items.map((it) => (it.id === id ? { ...it, ...patch } : it.isGroup && it.items ? { ...it, items: patchItems(it.items, id, patch) } : it));
}

export function transformItems(items: SceneItem[], action: TransformAction) {
  const scene = sceneUuid();
  if (!scene) return;
  for (const it of items) act((c) => c.transformItem(scene, it.id, action));
}

export function orderItems(items: SceneItem[], action: OrderAction) {
  const scene = sceneUuid();
  if (!scene) return;
  for (const it of items) act((c) => c.orderItem(scene, it.id, action));
}

export async function removeItems(items: SceneItem[]) {
  const scene = sceneUuid();
  if (!scene || !items.length) return;
  const t = getT();
  const ok = await confirmDialog({
    title: fmt(t.sources.removeConfirm, { name: items.map((i) => i.name).join(", ") }),
    description: t.sources.removeSourceDesc,
    confirmLabel: t.common.delete,
    destructive: true,
  });
  if (!ok) return;
  for (const it of items) await act((c) => c.removeItem(scene, it.id));
  useStore.getState().select([]);
}

export async function renameSource(uuid: Uuid) {
  const t = getT();
  const src = st().sources.find((s) => s.uuid === uuid);
  const scene = st().scenes.find((s) => s.uuid === uuid);
  const cur = src?.name ?? scene?.name ?? "";
  const name = await promptDialog({ title: t.sources.rename, label: t.sources.name, defaultValue: cur });
  if (!name?.trim() || name === cur) return;
  if (scene) await act((c) => c.renameScene(uuid, name.trim()));
  else await act((c) => c.updateSource(uuid, { name: name.trim() }));
}

export function copySource(uuid: Uuid) {
  useStore.getState().setClipboard(uuid);
  toast(getT().sources.copied);
}

export async function pasteSource(duplicate: boolean) {
  const uuid = useStore.getState().clipboard;
  const scene = sceneUuid();
  if (!uuid || !scene) return;
  if (!duplicate) return act((c) => c.addSourceToScene(scene, uuid));
  const src = st().sources.find((s) => s.uuid === uuid);
  if (!src) return;
  const name = uniqueName(src.name, st().sources.map((s) => s.name));
  return act((c) => c.duplicateSource(uuid, name, scene));
}

/** Duplicate the sources of these items into the edited scene (Ctrl+D). */
export async function duplicateItems(items: SceneItem[]) {
  const scene = sceneUuid();
  if (!scene) return;
  for (const it of items) {
    if (it.isGroup) continue;
    const src = st().sources.find((s) => s.uuid === it.sourceUuid);
    if (!src) continue;
    const name = uniqueName(src.name, st().sources.map((s) => s.name));
    await act((c) => c.duplicateSource(src.uuid, name, scene));
  }
}

export async function groupSelected() {
  const scene = sceneUuid();
  const items = selectedItems();
  if (!scene || !items.length) return;
  const t = getT();
  const all = flattenItems(editingScene(st())?.items ?? []).filter((i) => i.isGroup).map((i) => i.name);
  let n = 1;
  while (all.includes(fmt(t.sources.groupName, { n }))) n++;
  const name = await promptDialog({ title: t.sources.groupSelected, label: t.sources.name, defaultValue: fmt(t.sources.groupName, { n }) });
  if (!name?.trim()) return;
  await act((c) => c.groupItems(scene, items.map((i) => i.id), name.trim()));
}

export async function screenshotSource(uuid?: Uuid) {
  const r = await act((c) => c.screenshot(uuid));
  if (r?.path) toast.success(fmt(getT().sources.screenshotSaved, { path: r.path }));
}

/** Arrow-key nudge of the selection (1 px, Shift = 10 px). */
export function nudgeSelection(dx: number, dy: number) {
  const scene = sceneUuid();
  if (!scene || usePrefs.getState().previewLocked) return;
  for (const it of selectedItems()) {
    if (it.locked) continue;
    updateItem(scene, it.id, { pos: { x: it.pos.x + dx, y: it.pos.y + dy } });
  }
}

// ------------------------------------------------------------------ collections

export async function newCollection() {
  const t = getT();
  const name = await promptDialog({ title: t.collection.newTitle, label: t.collection.name, defaultValue: uniqueName("Escenas", st().sceneCollections.map((c) => c.name)) });
  if (name?.trim()) await act((c) => c.createSceneCollection(name.trim()));
}

export async function duplicateCollection() {
  const t = getT();
  const cur = st().sceneCollection;
  const name = await promptDialog({ title: t.collection.duplicateTitle, label: t.collection.name, defaultValue: uniqueName(cur, st().sceneCollections.map((c) => c.name)) });
  if (!name?.trim()) return;
  await act((c) => c.duplicateSceneCollection(cur, name.trim()));
}

export async function renameCollection() {
  const t = getT();
  const cur = st().sceneCollection;
  const name = await promptDialog({ title: t.collection.renameTitle, label: t.collection.name, defaultValue: cur });
  if (name?.trim() && name !== cur) await act((c) => c.renameSceneCollection(cur, name.trim()));
}

export async function removeCollection() {
  const t = getT();
  const cur = st().sceneCollection;
  const ok = await confirmDialog({ title: fmt(t.collection.removeConfirm, { name: cur }), description: t.collection.removeDesc, confirmLabel: t.common.delete, destructive: true });
  if (ok) await act((c) => c.deleteSceneCollection(cur));
}

/** Save the current scene collection (+ its files, alerts and widget looks) as a .vxoverlay package. */
export async function exportOverlay() {
  const t = getT();
  const name = st().sceneCollection;
  const path = await pickSaveFile([{ name: t.collection.overlayFilter, extensions: ["vxoverlay"] }], `${name}.vxoverlay`);
  if (!path) return;
  const r = await act((c) => c.exportOverlay(path));
  if (r) toast.success(fmt(t.collection.overlayExported, { name, files: r.files }));
}

// ------------------------------------------------------------------ outputs

export async function toggleStreaming() {
  const t = getT();
  const s = st();
  const prefs = usePrefs.getState();
  if (s.status.streaming) {
    // A rehearsal isn't public: stop it without asking.
    if (!s.status.rehearsal && prefs.confirmStreamStop && !(await confirmDialog({ title: t.controls.confirmStop, description: t.controls.confirmStopMsg, confirmLabel: t.controls.stopStreaming, destructive: true }))) return;
    return act((c) => c.stopStream());
  }
  if (prefs.preflight) {
    const choice = await preflightDialog();
    if (choice === "rehearsal") return act((c) => c.startRehearsal());
    if (choice !== "go") return;
  } else if (prefs.confirmStreamStart && !(await confirmDialog({ title: t.controls.confirmStart, description: t.controls.confirmStartMsg, confirmLabel: t.controls.startStreaming }))) return;
  return act((c) => c.startStream());
}

export async function toggleRecording() {
  const t = getT();
  const s = st();
  if (s.status.recording) {
    if (usePrefs.getState().confirmRecordStop && !(await confirmDialog({ title: t.controls.confirmRecStop, confirmLabel: t.controls.stopRecording, destructive: true }))) return;
    return act((c) => c.stopRecording());
  }
  return act((c) => c.startRecording());
}

/** Twitch clip of the last seconds of the stream, with a link to edit it. */
export async function createClip() {
  const c = useStore.getState().client;
  if (!c) return;
  const t = getT();
  try {
    const clip = await c.createClip();
    toast.success(t.controls.clipCreated, { description: clip.url, action: { label: t.controls.openClip, onClick: () => openExternal(clip.editUrl || clip.url) } });
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

export function toggleReplayBuffer() {
  const s = st();
  if (s.status.replayBufferActive) return act((c) => c.stopReplayBuffer());
  if (!s.output.replayBufferEnabled) {
    toast.warning(getT().controls.replayDisabled);
    return;
  }
  return act((c) => c.startReplayBuffer());
}

export function toggleVirtualCam() {
  return st().status.virtualCamActive ? act((c) => c.stopVirtualCam()) : act((c) => c.startVirtualCam());
}

export function toggleStudioMode() {
  return act((c) => c.setStudioMode(!st().status.studioMode));
}

export async function showRecordings() {
  const s = st();
  const path = s.status.lastRecordingPath ?? s.output.recordingPath;
  if (!(await revealPath(path))) toast(path);
}

export async function exitVexcast() {
  const t = getT();
  const s = st();
  const active = s.status.streaming || s.status.recording;
  if (active && s.advanced.confirmOnExit && !(await confirmDialog({ title: t.controls.exitConfirm, description: t.controls.exitConfirmMsg, confirmLabel: t.controls.exit, destructive: true }))) return;
  if (active) {
    if (s.status.streaming) await act((c) => c.stopStream());
    if (s.status.recording) await act((c) => c.stopRecording());
  }
  await exitApp();
}

export async function checkForUpdates() {
  const t = getT();
  const u = await act((c) => c.checkUpdates());
  if (!u) return;
  if (u.updateAvailable) openDialog("releaseNotes", true);
  else toast.success(t.update.upToDate);
}

export { api };
