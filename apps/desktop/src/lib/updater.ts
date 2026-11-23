import { isTauri } from "./tauri";

/**
 * Desktop app: checks now and opens the update window (run by the Rust side, see
 * src-tauri/src/updater.rs). Returns false when there's no update.
 */
export async function openUpdateWindow(): Promise<boolean> {
  if (!isTauri()) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<boolean>("update_open");
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
