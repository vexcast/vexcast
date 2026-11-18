import { isTauri } from "./tauri";

/**
 * Tauri: check → download & install (reporting progress 0..1, or null when the
 * size is unknown) → relaunch. Returns false when no update is available.
 */
export async function installTauriUpdate(onProgress: (p: number | null, phase: "download" | "install" | "restart") => void): Promise<boolean> {
  if (!isTauri()) return false;
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) return false;
  let total = 0;
  let done = 0;
  await update.downloadAndInstall((ev) => {
    switch (ev.event) {
      case "Started":
        total = ev.data.contentLength ?? 0;
        onProgress(total ? 0 : null, "download");
        break;
      case "Progress":
        done += ev.data.chunkLength;
        onProgress(total ? Math.min(1, done / total) : null, "download");
        break;
      case "Finished":
        onProgress(1, "install");
        break;
    }
  });
  onProgress(1, "restart");
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
  return true;
}

/** Tauri-side check (signature-verified updater). Returns the new version or null. */
export async function checkTauriUpdate(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const u = await check();
    return u?.version ?? null;
  } catch {
    return null;
  }
}
