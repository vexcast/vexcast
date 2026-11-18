export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatBitrate(kbps: number): string {
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`;
  return `${Math.round(kbps)} kbps`;
}

export function formatTime(ts: number, locale: string): string {
  try {
    return new Date(ts).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  } catch {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
}

/** Meter range: -60..0 dBFS → 0..1 (OBS meters use the same floor). */
export const METER_MIN_DB = -60;
export function dbToUnit(db: number): number {
  if (!Number.isFinite(db)) return 0;
  return Math.min(1, Math.max(0, (db - METER_MIN_DB) / -METER_MIN_DB));
}

// OBS log fader curve (libobs/obs-audio-controls.c, OBS_FADER_LOG).
const LOG_OFFSET_DB = 6;
const LOG_RANGE_DB = 96;
const LOG_OFFSET_VAL = -Math.log10(LOG_OFFSET_DB);
const LOG_RANGE_VAL = -Math.log10(LOG_RANGE_DB + LOG_OFFSET_DB);

/** Fader position 0..1 → dB (-Infinity at 0, 0 dB at 1). */
export function faderToDb(pos: number): number {
  if (pos >= 1) return 0;
  if (pos <= 0) return -Infinity;
  const range = LOG_RANGE_DB + LOG_OFFSET_DB;
  return -range * Math.pow(range / LOG_OFFSET_DB, -pos) + LOG_OFFSET_DB;
}

/** dB → fader position 0..1 (anything >= 0 dB sits at the top). */
export function dbToFader(db: number): number {
  if (!Number.isFinite(db) || db <= -LOG_RANGE_DB) return 0;
  if (db >= 0) return 1;
  return (-Math.log10(-db + LOG_OFFSET_DB) - LOG_RANGE_VAL) / (LOG_OFFSET_VAL - LOG_RANGE_VAL);
}

/** OBS linear volume multiplier → dB. */
export function volumeToDb(volume: number): number {
  return volume > 0 ? 20 * Math.log10(volume) : -Infinity;
}

export function dbLabel(db: number): string {
  if (!Number.isFinite(db) || db <= -LOG_RANGE_DB) return "-∞ dB";
  const r = Math.round(db * 10) / 10;
  return `${r > 0 ? "+" : ""}${r.toFixed(1)} dB`;
}

export function formatMemory(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

/** Stable pleasant color for a user name without a color. */
export function nameColor(name: string): string {
  const palette = ["#A78BFA", "#22D3EE", "#F472B6", "#34D399", "#FBBF24", "#60A5FA", "#FB923C", "#C084FC", "#2DD4BF"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palette[h % palette.length]!;
}
