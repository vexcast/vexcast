import Constants from "expo-constants";

import { compareVersions } from "./semver";
import { getJSON, setJSON } from "./storage";

export const GITHUB_URL = "https://github.com/vexcast/vexcast";
export const RELEASES_URL = `${GITHUB_URL}/releases`;
export const KOFI_URL = "https://ko-fi.com/emanueldev";
const LATEST_API = "https://api.github.com/repos/vexcast/vexcast/releases/latest";
const CACHE_KEY = "vexcast.updateCheck.v1";
const DAY = 24 * 60 * 60 * 1000;

export function appVersion(): string {
  return Constants.expoConfig?.version ?? "0.0.0";
}

export interface UpdateCheck {
  checkedAt: number;
  latestVersion: string | null;
  releaseUrl: string | null;
}

export interface UpdateStatus extends UpdateCheck {
  updateAvailable: boolean;
}

function withStatus(c: UpdateCheck): UpdateStatus {
  return { ...c, updateAvailable: !!c.latestVersion && compareVersions(c.latestVersion, appVersion()) > 0 };
}

/**
 * Checks GitHub for the latest release at most once a day (unless `force`).
 * The last result is cached so the banner keeps showing between launches.
 */
export async function checkForUpdate(force = false): Promise<UpdateStatus | null> {
  const cached = await getJSON<UpdateCheck | null>(CACHE_KEY, null);
  if (!force && cached && Date.now() - cached.checkedAt < DAY) return withStatus(cached);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(LATEST_API, {
      headers: { Accept: "application/vnd.github+json" },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { tag_name?: string; html_url?: string };
    const tag = (body.tag_name ?? "").replace(/^v/i, "");
    const result: UpdateCheck = {
      checkedAt: Date.now(),
      latestVersion: tag || null,
      releaseUrl: body.html_url ?? RELEASES_URL,
    };
    await setJSON(CACHE_KEY, result);
    return withStatus(result);
  } catch {
    // Offline or rate limited: remember the attempt so we do not hammer the API.
    const result: UpdateCheck = {
      checkedAt: Date.now(),
      latestVersion: cached?.latestVersion ?? null,
      releaseUrl: cached?.releaseUrl ?? null,
    };
    await setJSON(CACHE_KEY, result);
    return cached ? withStatus(result) : null;
  }
}

const DISMISS_KEY = "vexcast.updateDismissed";
export const getDismissedUpdate = () => getJSON<string | null>(DISMISS_KEY, null);
export const dismissUpdate = (version: string) => setJSON(DISMISS_KEY, version);
