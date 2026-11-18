/** OBS-specific helpers: fader curve, colors, file filters, source icons. */
import {
  AppWindow,
  AudioLines,
  Box,
  Clapperboard,
  Film,
  Gamepad2,
  Globe,
  Image,
  Images,
  type LucideIcon,
  Mic,
  Monitor,
  Palette,
  Puzzle,
  Type,
  Video,
  Volume2,
} from "lucide-react";

// ------------------------------------------------------------------ fader (OBS_FADER_LOG)

const LOG_OFFSET_DB = 6;
const LOG_RANGE_DB = 96;
const LOG_OFFSET_VAL = -(LOG_RANGE_DB + LOG_OFFSET_DB);

/** dB → fader deflection 0..1 (same curve as OBS's volume sliders). */
export function dbToFader(db: number): number {
  if (db >= 0) return 1;
  if (db <= -LOG_RANGE_DB || !Number.isFinite(db)) return 0;
  return (-Math.log10(-db + LOG_OFFSET_DB) + Math.log10(LOG_RANGE_DB + LOG_OFFSET_DB)) / (Math.log10(LOG_RANGE_DB + LOG_OFFSET_DB) - Math.log10(LOG_OFFSET_DB));
}

/** Fader deflection 0..1 → dB (-Infinity at 0). */
export function faderToDb(def: number): number {
  if (def >= 1) return 0;
  if (def <= 0) return -Infinity;
  return LOG_OFFSET_VAL * Math.pow((LOG_RANGE_DB + LOG_OFFSET_DB) / LOG_OFFSET_DB, -def) + LOG_OFFSET_DB;
}

export const mulToDb = (mul: number) => (mul <= 0 ? -Infinity : 20 * Math.log10(mul));
export const dbToMul = (db: number) => (Number.isFinite(db) ? Math.pow(10, db / 20) : 0);

export function formatDb(db: number, digits = 1): string {
  if (!Number.isFinite(db) || db <= -96) return "-inf dB";
  return `${db.toFixed(digits)} dB`;
}

// ------------------------------------------------------------------ colors (OBS stores 0xAABBGGRR)

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function obsToRgba(v: unknown): Rgba {
  const n = typeof v === "number" ? v >>> 0 : 0xffffffff;
  return { r: n & 0xff, g: (n >>> 8) & 0xff, b: (n >>> 16) & 0xff, a: (n >>> 24) & 0xff };
}

export function rgbaToObs({ r, g, b, a }: Rgba): number {
  return (((a & 0xff) << 24) | ((b & 0xff) << 16) | ((g & 0xff) << 8) | (r & 0xff)) >>> 0;
}

const hex2 = (n: number) => n.toString(16).padStart(2, "0");
export const rgbaToHex = ({ r, g, b }: Rgba) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

// ------------------------------------------------------------------ file dialog filters

/** "Image Files (*.bmp *.png);;All Files (*.*)" → Tauri dialog filters. */
export function parseObsFilter(filter: string | null | undefined): { name: string; extensions: string[] }[] {
  if (!filter) return [];
  return filter
    .split(";;")
    .map((part) => {
      const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(part.trim());
      if (!m) return null;
      const exts = m[2]
        .split(/\s+/)
        .map((e) => e.replace(/^\*\.?/, ""))
        .filter((e) => e.length > 0)
        .map((e) => (e === "*" ? "*" : e));
      return { name: m[1] || part, extensions: exts.length ? exts : ["*"] };
    })
    .filter((x): x is { name: string; extensions: string[] } => !!x);
}

// ------------------------------------------------------------------ source icons

const ICONS: Record<string, LucideIcon> = {
  image: Image,
  color: Palette,
  slideshow: Images,
  audio_input: Mic,
  audio_output: Volume2,
  desktop: Monitor,
  window: AppWindow,
  game: Gamepad2,
  camera: Video,
  text: Type,
  media: Film,
  browser: Globe,
  process_audio: AudioLines,
  scene: Clapperboard,
  group: Box,
};

export function sourceIcon(icon: string | null | undefined): LucideIcon {
  return (icon && ICONS[icon]) || Puzzle;
}

/** Best-effort icon for an existing source from its kind. */
export function iconForKind(kind: string): LucideIcon {
  const k = kind.replace(/_v\d+$/, "");
  if (k === "group") return Box;
  if (k === "scene") return Clapperboard;
  if (k.includes("image_source")) return Image;
  if (k.includes("color_source")) return Palette;
  if (k.includes("slideshow")) return Images;
  if (k.includes("ffmpeg") || k.includes("vlc")) return Film;
  if (k.includes("text")) return Type;
  if (k.includes("monitor") || k.includes("display") || k.includes("screen")) return Monitor;
  if (k.includes("window")) return AppWindow;
  if (k.includes("game")) return Gamepad2;
  if (k.includes("dshow") || k.includes("av_capture") || k.includes("v4l2")) return Video;
  if (k.includes("process_output")) return AudioLines;
  if (k.includes("input_capture") || k.includes("pulse_input") || k.includes("coreaudio_input")) return Mic;
  if (k.includes("output_capture") || k.includes("pulse_output") || k.includes("coreaudio_output")) return Volume2;
  if (k.includes("browser")) return Globe;
  return Puzzle;
}
