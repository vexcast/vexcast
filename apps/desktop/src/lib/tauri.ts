/** Helpers that work both inside the Tauri shell and in a plain browser. */

export const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface CoreInfo {
  port: number;
  token: string;
}

export async function getCoreInfo(): Promise<CoreInfo> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<CoreInfo>("get_core_info");
}

/** Open a URL in the system browser. */
export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
      return;
    } catch {
      /* fall through */
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export type DialogFilter = { name: string; extensions: string[] };

/** Native open dialog (Tauri only). Returns null when cancelled or unavailable. */
export async function pickFile(filters?: DialogFilter[], defaultPath?: string): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const res = await open({ multiple: false, directory: false, filters: filters?.length ? filters : undefined, defaultPath: defaultPath || undefined });
  return typeof res === "string" ? res : null;
}

export async function pickFiles(filters?: DialogFilter[]): Promise<string[]> {
  if (!isTauri()) return [];
  const { open } = await import("@tauri-apps/plugin-dialog");
  const res = await open({ multiple: true, directory: false, filters: filters?.length ? filters : undefined });
  return Array.isArray(res) ? res : typeof res === "string" ? [res] : [];
}

export async function pickFolder(defaultPath?: string): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const res = await open({ multiple: false, directory: true, defaultPath: defaultPath || undefined });
  return typeof res === "string" ? res : null;
}

/** Native save dialog (Tauri only). */
export async function pickSaveFile(filters?: DialogFilter[], defaultPath?: string): Promise<string | null> {
  if (!isTauri()) return null;
  const { save } = await import("@tauri-apps/plugin-dialog");
  const res = await save({ filters: filters?.length ? filters : undefined, defaultPath: defaultPath || undefined });
  return typeof res === "string" ? res : null;
}

/** Reveal a file/folder in the system file manager. */
export async function revealPath(path: string): Promise<boolean> {
  if (!isTauri() || !path) return false;
  try {
    const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
    await revealItemInDir(path);
    return true;
  } catch {
    return false;
  }
}

/** Restart Vexcast (Tauri; the browser just reloads the page). */
export async function restartApp(): Promise<void> {
  if (isTauri()) {
    try {
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
      return;
    } catch {
      /* fall through */
    }
  }
  location.reload();
}

/** Quit the app (Tauri) or close the tab. */
export async function exitApp(): Promise<void> {
  if (isTauri()) {
    try {
      const { exit } = await import("@tauri-apps/plugin-process");
      await exit(0);
      return;
    } catch {
      /* fall through */
    }
  }
  window.close();
}

/** Toggle fullscreen (Tauri window or document). */
export async function toggleFullscreen(): Promise<void> {
  if (isTauri()) {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const w = getCurrentWindow();
      await w.setFullscreen(!(await w.isFullscreen()));
      return;
    } catch {
      /* fall through */
    }
  }
  if (document.fullscreenElement) await document.exitFullscreen();
  else await document.documentElement.requestFullscreen();
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export const KOFI_URL = "https://ko-fi.com/emanueldev";
export const GITHUB_URL = "https://github.com/vexcast/vexcast";
export const RELEASES_URL = "https://github.com/vexcast/vexcast/releases/latest";
