// Tiny software compositor for the mock core preview.
//
// Renders a scene like libobs does: items bottom-to-top, each mapped with the
// OBS scene item transform (pos, rot, scale, alignment, bounds, crop, groups),
// sampling a procedural per-source "texture" generated in source pixel space.
// Frames are encoded as PNG with node:zlib (no image libraries needed).

import zlib from "node:zlib";

const ALIGN_LEFT = 1;
const ALIGN_RIGHT = 2;
const ALIGN_TOP = 4;
const ALIGN_BOTTOM = 8;

// ------------------------------------------------------------------ PNG
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  if (typeof zlib.crc32 === "function") return zlib.crc32(buf) >>> 0;
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** Encode an RGB (3 bytes/pixel) buffer as PNG. */
export function encodePng(w, h, rgb) {
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 3 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ 5x7 bitmap font
// prettier-ignore
const FONT = {
  A: [14,17,17,31,17,17,17], B: [30,17,17,30,17,17,30], C: [14,17,16,16,16,17,14], D: [28,18,17,17,17,18,28],
  E: [31,16,16,30,16,16,31], F: [31,16,16,30,16,16,16], G: [14,17,16,23,17,17,15], H: [17,17,17,31,17,17,17],
  I: [14,4,4,4,4,4,14], J: [7,2,2,2,2,18,12], K: [17,18,20,24,20,18,17], L: [16,16,16,16,16,16,31],
  M: [17,27,21,21,17,17,17], N: [17,17,25,21,19,17,17], O: [14,17,17,17,17,17,14], P: [30,17,17,30,16,16,16],
  Q: [14,17,17,17,21,18,13], R: [30,17,17,30,20,18,17], S: [15,16,16,14,1,1,30], T: [31,4,4,4,4,4,4],
  U: [17,17,17,17,17,17,14], V: [17,17,17,17,17,10,4], W: [17,17,17,21,21,21,10], X: [17,17,10,4,10,17,17],
  Y: [17,17,17,10,4,4,4], Z: [31,1,2,4,8,16,31],
  0: [14,17,19,21,25,17,14], 1: [4,12,4,4,4,4,14], 2: [14,17,1,2,4,8,31], 3: [31,2,4,2,1,17,14],
  4: [2,6,10,18,31,2,2], 5: [31,16,30,1,1,17,14], 6: [6,8,16,30,17,17,14], 7: [31,1,2,4,8,8,8],
  8: [14,17,17,14,17,17,14], 9: [14,17,17,15,1,2,12],
  " ": [0,0,0,0,0,0,0], "!": [4,4,4,4,4,0,4], "¡": [4,0,4,4,4,4,4], "?": [14,17,1,2,4,0,4], "¿": [4,0,4,8,16,17,14],
  ".": [0,0,0,0,0,12,12], ",": [0,0,0,0,12,4,8], ":": [0,12,12,0,12,12,0], ";": [0,12,12,0,12,4,8],
  "-": [0,0,0,31,0,0,0], _: [0,0,0,0,0,0,31], "'": [4,4,8,0,0,0,0], '"': [10,10,0,0,0,0,0],
  "(": [2,4,8,8,8,4,2], ")": [8,4,2,2,2,4,8], "/": [1,1,2,4,8,16,16], "+": [0,4,4,31,4,4,0],
  "=": [0,0,31,0,31,0,0], "%": [24,25,2,4,8,19,3], "#": [10,10,31,10,31,10,10], "@": [14,17,1,13,21,21,14],
  "&": [12,18,20,8,21,18,13], "*": [0,4,21,14,21,4,0], "<": [2,4,8,16,8,4,2], ">": [8,4,2,1,2,4,8],
  "[": [14,8,8,8,8,8,14], "]": [14,2,2,2,2,2,14], $: [4,15,20,14,5,30,4], "|": [4,4,4,4,4,4,4],
};
/** Uppercase, strip accents, keep only glyphs we have. */
export function normalizeText(str) {
  return String(str ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .split("")
    .map((c) => (c === "\n" || FONT[c] ? c : c.charCodeAt(0) > 0x2000 ? "" : "?"))
    .join("");
}

/** Native size of a text source (GDI+ approximation matching our bitmap font). */
export function textNativeSize(s) {
  if (s.extents) return { w: Math.max(0, s.extents_cx | 0), h: Math.max(0, s.extents_cy | 0) };
  const text = s.read_from_file ? "texto desde archivo" : (s.text ?? "");
  const lines = normalizeText(text).split("\n");
  if (s.chatlog) lines.splice(0, Math.max(0, lines.length - (s.chatlog_lines | 0 || 6)));
  const maxLen = Math.max(0, ...lines.map((l) => l.length));
  if (!maxLen) return { w: 0, h: 0 };
  const size = s.font?.size ?? 256;
  const outline = s.outline ? (s.outline_size | 0) * 2 : 0;
  if (s.vertical) return { w: Math.round(lines.length * size * 0.75 + outline), h: Math.round(maxLen * size * 1.0 + outline) };
  return { w: Math.round(maxLen * size * 0.6 + outline), h: Math.round(lines.length * size * 1.2 + outline) };
}

/** Unfiltered native size of a source, by kind and settings. */
export function nativeSize(kind, s, canvasW = 1920, canvasH = 1080) {
  switch (kind) {
    case "monitor_capture":
      return String(s.monitor_id ?? "").includes("DEL41A8") ? { w: 2560, h: 1440 } : { w: 1920, h: 1080 };
    case "window_capture":
      return s.window ? { w: 1600, h: 900 } : { w: 0, h: 0 };
    case "game_capture":
      return { w: 1920, h: 1080 };
    case "dshow_input": {
      if (!s.video_device_id) return { w: 0, h: 0 };
      if (s.res_type === 1) {
        const m = /^(\d+)x(\d+)$/.exec(String(s.resolution ?? ""));
        if (m) return { w: +m[1], h: +m[2] };
      }
      return { w: 1280, h: 720 };
    }
    case "image_source":
      return s.file ? { w: 512, h: 512 } : { w: 0, h: 0 };
    case "color_source_v3":
    case "browser_source":
      return { w: Math.max(0, s.width | 0), h: Math.max(0, s.height | 0) };
    case "text_gdiplus_v3":
      return textNativeSize(s);
    case "text_ft2_source_v2":
      return textNativeSize({ text: s.text, font: s.font });
    case "ffmpeg_source":
      return (s.is_local_file !== false ? s.local_file : s.input) ? { w: 1920, h: 1080 } : { w: 0, h: 0 };
    case "slideshow_v2":
      return Array.isArray(s.files) && s.files.length ? { w: 1920, h: 1080 } : { w: 0, h: 0 };
    case "scene":
      return { w: canvasW, h: canvasH };
    default:
      return { w: 0, h: 0 };
  }
}

// ------------------------------------------------------------------ texture canvas
class Tex {
  constructor(w, h) {
    this.w = Math.max(1, Math.round(w));
    this.h = Math.max(1, Math.round(h));
    this.d = new Uint8ClampedArray(this.w * this.h * 4);
  }
  px(x, y, c) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    const a = (c[3] ?? 255) / 255;
    if (a >= 1) {
      this.d[i] = c[0];
      this.d[i + 1] = c[1];
      this.d[i + 2] = c[2];
      this.d[i + 3] = 255;
      return;
    }
    if (a <= 0) return;
    const da = this.d[i + 3] / 255;
    const oa = a + da * (1 - a);
    for (let k = 0; k < 3; k++) this.d[i + k] = (c[k] * a + this.d[i + k] * da * (1 - a)) / oa;
    this.d[i + 3] = oa * 255;
  }
  rect(x, y, w, h, c) {
    const x0 = Math.max(0, Math.round(x)),
      y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.w, Math.round(x + w)),
      y1 = Math.min(this.h, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.px(xx, yy, c);
  }
  roundRect(x, y, w, h, r, c) {
    const x0 = Math.max(0, Math.floor(x)),
      y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.w, Math.ceil(x + w)),
      y1 = Math.min(this.h, Math.ceil(y + h));
    r = Math.min(r, w / 2, h / 2);
    for (let yy = y0; yy < y1; yy++)
      for (let xx = x0; xx < x1; xx++) {
        const px = xx + 0.5,
          py = yy + 0.5;
        const dx = Math.max(x + r - px, 0, px - (x + w - r));
        const dy = Math.max(y + r - py, 0, py - (y + h - r));
        if (dx * dx + dy * dy <= r * r) this.px(xx, yy, c);
      }
  }
  circle(cx, cy, r, c) {
    for (let yy = Math.floor(cy - r); yy <= Math.ceil(cy + r); yy++)
      for (let xx = Math.floor(cx - r); xx <= Math.ceil(cx + r); xx++) {
        const dx = xx + 0.5 - cx,
          dy = yy + 0.5 - cy;
        if (dx * dx + dy * dy <= r * r) this.px(xx, yy, c);
      }
  }
  gradient(x, y, w, h, c1, c2, dir = "diag") {
    const x0 = Math.max(0, Math.round(x)),
      y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.w, Math.round(x + w)),
      y1 = Math.min(this.h, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++)
      for (let xx = x0; xx < x1; xx++) {
        const t = dir === "v" ? (yy - y) / h : dir === "h" ? (xx - x) / w : ((xx - x) / w + (yy - y) / h) / 2;
        this.px(xx, yy, [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t, c1[3] ?? 255]);
      }
  }
  /** Draw text with the bitmap font; `u` = size of one font pixel. Returns width. */
  text(str, x, y, u, c) {
    const s = normalizeText(str);
    let cx = x;
    for (const ch of s) {
      const g = FONT[ch];
      if (g) for (let row = 0; row < 7; row++) for (let col = 0; col < 5; col++) if (g[row] & (16 >> col)) this.rect(cx + col * u, y + row * u, Math.ceil(u), Math.ceil(u), c);
      cx += 6 * u;
    }
    return cx - x;
  }
}

const abgr = (v, alpha = null) => {
  const n = Number(v ?? 0) >>> 0;
  return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, alpha ?? (n >>> 24) & 255];
};
const bgr = (v, alpha = 255) => {
  const c = abgr(v);
  c[3] = alpha;
  return c;
};

// ------------------------------------------------------------------ procedural content per kind
function drawWindow(t, x, y, w, h, u, theme) {
  const dark = theme === "dark";
  t.roundRect(x + 6 * u, y + 10 * u, w, h, 10 * u, [0, 0, 0, 70]); // shadow
  t.roundRect(x, y, w, h, 10 * u, dark ? [30, 32, 40] : [243, 244, 246]);
  t.rect(x, y + 10 * u, w, 26 * u, dark ? [22, 24, 30] : [226, 228, 233]);
  t.roundRect(x, y, w, 36 * u, 10 * u, dark ? [22, 24, 30] : [226, 228, 233]);
  const btn = [
    [239, 68, 68],
    [245, 158, 11],
    [34, 197, 94],
  ];
  btn.forEach((c, i) => t.circle(x + w - (20 + i * 24) * u, y + 18 * u, 6 * u, c));
  const lineColors = dark
    ? [
        [139, 92, 246],
        [34, 211, 238],
        [148, 163, 184],
        [250, 204, 21],
      ]
    : [
        [156, 163, 175],
        [203, 213, 225],
      ];
  let ly = y + 56 * u;
  let i = 0;
  while (ly < y + h - 24 * u) {
    const lw = (0.3 + ((i * 37) % 55) / 100) * (w - 60 * u);
    t.rect(x + (24 + (dark ? (i % 4) * 16 : 0)) * u, ly, lw, 9 * u, lineColors[i % lineColors.length]);
    ly += 22 * u;
    i++;
  }
}

function genDesktop(t, s, sw, sh) {
  const u = t.w / 1920;
  const second = s.monitor_id && String(s.monitor_id).includes("DEL41A8");
  if (second) t.gradient(0, 0, t.w, t.h, [15, 118, 110], [8, 47, 73]);
  else t.gradient(0, 0, t.w, t.h, [30, 58, 138], [124, 58, 237]);
  t.circle(t.w * 0.78, t.h * 0.22, 260 * u, [255, 255, 255, 18]);
  t.circle(t.w * 0.18, t.h * 0.85, 340 * u, [255, 255, 255, 12]);
  drawWindow(t, 120 * u, 90 * u, 1000 * u, 620 * u, u, "light");
  drawWindow(t, 900 * u, 330 * u, 860 * u, 560 * u, u, "dark");
  const tb = 52 * u;
  t.rect(0, t.h - tb, t.w, tb, [17, 24, 39, 235]);
  for (let i = 0; i < 6; i++) t.roundRect(t.w / 2 - 170 * u + i * 58 * u, t.h - tb + 9 * u, 34 * u, 34 * u, 6 * u, i === 0 ? [96, 165, 250] : [75, 85, 99]);
  t.text("18:30", t.w - 150 * u, t.h - tb + 17 * u, 3.2 * u, [229, 231, 235]);
}

function genWindow(t, s) {
  const u = t.w / 1600;
  const v = String(s.window ?? "");
  t.rect(0, 0, t.w, t.h, [12, 12, 16]);
  if (!v) return;
  const dark = /Discord|Code|Spotify|hollow/i.test(v);
  drawWindow(t, 0, 0, t.w, t.h, u, dark ? "dark" : "light");
  t.text(v.split(":")[0].slice(0, 30), 20 * u, 12 * u, 2.2 * u, dark ? [226, 232, 240] : [55, 65, 81]);
}

function genGame(t) {
  const u = t.w / 1920;
  t.gradient(0, 0, t.w, t.h * 0.65, [56, 189, 248], [253, 186, 116], "v");
  t.circle(t.w * 0.7, t.h * 0.35, 90 * u, [254, 240, 138]);
  for (let x = 0; x < t.w; x++) {
    const fx = x / t.w;
    const m1 = t.h * (0.45 + 0.1 * Math.sin(fx * 9) + 0.05 * Math.sin(fx * 23));
    const m2 = t.h * (0.58 + 0.05 * Math.sin(fx * 13 + 1));
    for (let y = Math.max(0, Math.floor(m1)); y < t.h; y++) t.px(x, y, y < m2 ? [76, 29, 149] : [21, 128, 61]);
  }
  t.rect(0, t.h * 0.82, t.w, t.h * 0.18, [20, 83, 45]);
  t.roundRect(40 * u, 40 * u, 420 * u, 70 * u, 12 * u, [0, 0, 0, 140]);
  t.text("HP 100  LVL 7", 64 * u, 58 * u, 5 * u, [255, 255, 255]);
}

function genCamera(t, s) {
  if (s.active === false) return t.rect(0, 0, t.w, t.h, [0, 0, 0]);
  const u = t.w / 1280;
  t.gradient(0, 0, t.w, t.h, [36, 196, 70], [20, 160, 55], "v"); // green screen
  // person silhouette
  const cx = t.w * 0.5;
  t.roundRect(cx - 300 * u, 470 * u, 600 * u, 400 * u, 160 * u, [49, 46, 129]); // hoodie
  t.roundRect(cx - 70 * u, 390 * u, 140 * u, 110 * u, 30 * u, [214, 170, 140]); // neck
  t.circle(cx, 300 * u, 140 * u, [224, 182, 150]); // head
  t.roundRect(cx - 150 * u, 150 * u, 300 * u, 110 * u, 60 * u, [55, 38, 30]); // hair
  t.circle(cx - 50 * u, 300 * u, 12 * u, [40, 30, 30]);
  t.circle(cx + 50 * u, 300 * u, 12 * u, [40, 30, 30]);
  t.roundRect(cx - 45 * u, 360 * u, 90 * u, 16 * u, 8 * u, [150, 80, 80]);
  t.roundRect(cx - 220 * u, 120 * u, 440 * u, 50 * u, 25 * u, [30, 30, 36]); // headset band
  t.roundRect(cx - 175 * u, 240 * u, 50 * u, 120 * u, 20 * u, [30, 30, 36]);
  t.roundRect(cx + 125 * u, 240 * u, 50 * u, 120 * u, 20 * u, [30, 30, 36]);
}

function genImage(t, s) {
  if (!s.file) return;
  const u = t.w / 512;
  t.roundRect(32 * u, 32 * u, 448 * u, 448 * u, 96 * u, [124, 58, 237]);
  t.roundRect(32 * u, 32 * u, 448 * u, 224 * u, 96 * u, [139, 92, 246, 200]);
  t.circle(256 * u, 256 * u, 150 * u, [34, 211, 238, 90]);
  t.text("V", 256 * u - 2.5 * 44 * u, 256 * u - 3.5 * 44 * u, 44 * u, [255, 255, 255]);
}

function genColor(t, s) {
  t.rect(0, 0, t.w, t.h, abgr(s.color));
}

function genBrowser(t, s) {
  const u = t.w / 1920;
  const url = String(s.is_local_file ? s.local_file : s.url);
  if (/alerts/i.test(url)) {
    const w = 900 * u,
      h = 210 * u;
    const x = (t.w - w) / 2,
      y = t.h * 0.62;
    t.roundRect(x, y, w, h, 28 * u, [17, 12, 40, 220]);
    t.roundRect(x, y, 14 * u, h, 7 * u, [139, 92, 246]);
    t.text("NUEVO SEGUIDOR", x + 60 * u, y + 46 * u, 7 * u, [196, 181, 253]);
    t.text("LUNAPIXEL", x + 60 * u, y + 116 * u, 9 * u, [255, 255, 255]);
    return;
  }
  if (/chat/i.test(url)) {
    for (let i = 0; i < 6; i++) {
      const y = t.h - (i + 1) * 120 * u;
      t.roundRect(30 * u, y, t.w * 0.7, 96 * u, 20 * u, [15, 15, 25, 190]);
      t.text(["LUNA", "RAYO", "MOD", "GALAXIA", "NACHO", "CARLA"][i] + ": HOLA!", 56 * u, y + 32 * u, 5 * u, [229, 231, 235]);
    }
    return;
  }
  if (/goal/i.test(url)) {
    t.roundRect(0, t.h * 0.3, t.w, t.h * 0.4, 30 * u, [15, 15, 25, 200]);
    t.roundRect(30 * u, t.h * 0.45, (t.w - 60 * u) * 0.45, t.h * 0.15, 20 * u, [139, 92, 246]);
    return;
  }
  // generic web page
  t.rect(0, 0, t.w, t.h, [250, 250, 252]);
  t.rect(0, 0, t.w, 90 * u, [48, 52, 64]);
  t.text("OBS STUDIO", 40 * u, 26 * u, 6 * u, [255, 255, 255]);
  for (let i = 0; i < 8; i++) t.rect(40 * u, (150 + i * 70) * u, ((i * 211) % 900) * u + 500 * u, 26 * u, [209, 213, 219]);
}

function genText(t, s, sw, sh) {
  const k = t.w / Math.max(1, sw);
  const size = (s.font?.size ?? 256) * k;
  const unit = size / 10;
  const alpha = Math.round(((s.opacity ?? 100) / 100) * 255);
  if ((s.bk_opacity ?? 0) > 0) t.rect(0, 0, t.w, t.h, bgr(s.bk_color, Math.round((s.bk_opacity / 100) * 255)));
  const color = bgr(s.color, alpha);
  const text = s.read_from_file ? "texto desde archivo" : (s.text ?? "");
  const lines = normalizeText(text).split("\n");
  const pad = s.outline ? (s.outline_size | 0) * k : 0;
  const lineH = size * 1.2;
  const totalH = lines.length * lineH;
  const yOff = s.valign === "center" ? (t.h - totalH) / 2 : s.valign === "bottom" ? t.h - totalH - pad : pad;
  lines.forEach((line, i) => {
    const lw = line.length * 6 * unit;
    const x = s.align === "center" ? (t.w - lw) / 2 : s.align === "right" ? t.w - lw - pad : pad;
    const y = yOff + i * lineH + unit * 1.5;
    if (s.outline) {
      const oc = bgr(s.outline_color, Math.round(((s.outline_opacity ?? 100) / 100) * 255));
      const o = Math.max(1, pad);
      for (const [dx, dy] of [
        [-o, 0],
        [o, 0],
        [0, -o],
        [0, o],
      ])
        t.text(line, x + dx, y + dy, unit, oc);
    }
    t.text(line, x, y, unit, color);
  });
}

function genMedia(t, s) {
  const bars = [
    [192, 192, 192],
    [192, 192, 0],
    [0, 192, 192],
    [0, 192, 0],
    [192, 0, 192],
    [192, 0, 0],
    [0, 0, 192],
  ];
  const bw = t.w / bars.length;
  bars.forEach((c, i) => t.rect(i * bw, 0, bw + 1, t.h * 0.7, c));
  t.gradient(0, t.h * 0.7, t.w, t.h * 0.3, [10, 10, 10], [235, 235, 235], "h");
  const name = String(s.local_file || s.input || (Array.isArray(s.files) && s.files[0]?.value) || "MEDIA")
    .split(/[\\/]/)
    .pop();
  const u = t.w / 1920;
  t.roundRect(40 * u, 40 * u, Math.min(t.w - 80 * u, (name.length * 6 * 6 + 60) * u), 90 * u, 14 * u, [0, 0, 0, 170]);
  t.text(name.slice(0, 40), 70 * u, 64 * u, 6 * u, [255, 255, 255]);
}

const GENERATORS = {
  monitor_capture: genDesktop,
  window_capture: genWindow,
  game_capture: genGame,
  dshow_input: genCamera,
  image_source: genImage,
  color_source_v3: genColor,
  browser_source: genBrowser,
  text_gdiplus_v3: genText,
  text_ft2_source_v2: (t, s, sw, sh) => genText(t, { ...s, color: s.color1, opacity: 100 }, sw, sh),
  ffmpeg_source: genMedia,
  slideshow_v2: genMedia,
};

// ------------------------------------------------------------------ filters (subset)
function keyColorFor(fs) {
  switch (fs.key_color_type) {
    case "blue":
      return [0, 0, 255];
    case "red":
      return [255, 0, 0];
    case "magenta":
      return [255, 0, 255];
    case "custom":
      return bgr(fs.key_color);
    default:
      return [0, 255, 0];
  }
}
const cbcr = (r, g, b) => [(-0.1687 * r - 0.3313 * g + 0.5 * b) / 255, (0.5 * r - 0.4187 * g - 0.0813 * b) / 255];

function applyFilters(t, filters) {
  for (const f of filters ?? []) {
    if (!f.enabled) continue;
    const s = f.settings ?? {};
    const d = t.d;
    if (f.kind === "chroma_key_filter_v2" || f.kind === "color_key_filter_v2") {
      const [kr, kg, kb] = keyColorFor(s);
      const [kcb, kcr] = cbcr(kr, kg, kb);
      const chroma = f.kind === "chroma_key_filter_v2";
      const sim = (s.similarity ?? 400) / 1000;
      const smooth = (s.smoothness ?? 80) / 1000;
      const opacity = s.opacity ?? 1;
      for (let i = 0; i < d.length; i += 4) {
        let dist;
        if (chroma) {
          const [cb, cr] = cbcr(d[i], d[i + 1], d[i + 2]);
          dist = Math.hypot(cb - kcb, cr - kcr);
        } else dist = Math.hypot(d[i] - kr, d[i + 1] - kg, d[i + 2] - kb) / 441;
        const a = Math.min(1, Math.max(0, (dist - sim) / Math.max(0.0001, smooth)));
        d[i + 3] = d[i + 3] * a * opacity;
      }
    } else if (f.kind === "color_filter_v2") {
      const br = s.brightness ?? 0,
        ct = (s.contrast ?? 0) + 1,
        sat = (s.saturation ?? 0) + 1,
        g = s.gamma ?? 0;
      const gp = g < 0 ? 1 - g : 1 / (1 + g);
      const mul = bgr(s.color_multiply ?? 0xffffff),
        add = bgr(s.color_add ?? 0);
      const op = s.opacity ?? 1;
      for (let i = 0; i < d.length; i += 4) {
        let r = d[i] / 255,
          gg = d[i + 1] / 255,
          b = d[i + 2] / 255;
        r = Math.pow(r, gp);
        gg = Math.pow(gg, gp);
        b = Math.pow(b, gp);
        r = (r - 0.5) * ct + 0.5 + br;
        gg = (gg - 0.5) * ct + 0.5 + br;
        b = (b - 0.5) * ct + 0.5 + br;
        const l = 0.299 * r + 0.587 * gg + 0.114 * b;
        r = l + (r - l) * sat;
        gg = l + (gg - l) * sat;
        b = l + (b - l) * sat;
        d[i] = (r * mul[0]) / 1 + add[0];
        d[i + 1] = (gg * mul[1]) / 1 + add[1];
        d[i + 2] = (b * mul[2]) / 1 + add[2];
        d[i + 3] *= op;
      }
    }
  }
}

/** Apply crop/pad filters to a native size (they change the source size in OBS). */
export function filteredSize(w, h, filters) {
  for (const f of filters ?? []) {
    if (!f.enabled || f.kind !== "crop_filter") continue;
    const s = f.settings ?? {};
    if (s.relative === false) {
      w = s.cx > 0 ? s.cx : Math.max(0, w - (s.left | 0));
      h = s.cy > 0 ? s.cy : Math.max(0, h - (s.top | 0));
    } else {
      w = Math.max(0, w - (s.left | 0) - (s.right | 0));
      h = Math.max(0, h - (s.top | 0) - (s.bottom | 0));
    }
  }
  return { w, h };
}

// ------------------------------------------------------------------ textures (cached)
const texCache = new Map();
const MAX_TEX = 720;

/**
 * Texture of a source at reduced resolution. `nativeW/H` is the unfiltered
 * native size; crop filters are applied after generation.
 */
function sourceTexture(ctx, src, depth) {
  if (src.kind === "scene") return null;
  const { w: nativeW, h: nativeH } = nativeSize(src.kind, src.settings ?? {}, ctx.canvasW, ctx.canvasH);
  if (!nativeW || !nativeH || !src.video) return null;
  const key = JSON.stringify([src.kind, src.settings, nativeW, nativeH, src.filters]);
  const cached = texCache.get(src.uuid);
  if (cached && cached.key === key) return cached.tex;
  const k = Math.min(1, MAX_TEX / Math.max(nativeW, nativeH));
  let t = new Tex(nativeW * k, nativeH * k);
  GENERATORS[src.kind]?.(t, src.settings ?? {}, nativeW, nativeH);
  // crop filters
  for (const f of src.filters ?? []) {
    if (!f.enabled || f.kind !== "crop_filter") continue;
    const s = f.settings ?? {};
    const l = Math.max(0, (s.left | 0) * k),
      tp = Math.max(0, (s.top | 0) * k);
    const fw = filteredSize(t.w / k, t.h / k, [f]);
    const nt = new Tex(Math.max(1, fw.w * k), Math.max(1, fw.h * k));
    for (let y = 0; y < nt.h; y++)
      for (let x = 0; x < nt.w; x++) {
        const sx = Math.round(x + l),
          sy = Math.round(y + tp);
        if (sx < 0 || sy < 0 || sx >= t.w || sy >= t.h) continue;
        const si = (sy * t.w + sx) * 4,
          di = (y * nt.w + x) * 4;
        nt.d[di] = t.d[si];
        nt.d[di + 1] = t.d[si + 1];
        nt.d[di + 2] = t.d[si + 2];
        nt.d[di + 3] = t.d[si + 3];
      }
    t = nt;
  }
  applyFilters(t, src.filters);
  texCache.set(src.uuid, { key, tex: t });
  return t;
}

// ------------------------------------------------------------------ transforms
function addAlign(o, align, cx, cy) {
  if (align & ALIGN_RIGHT) o.x += cx;
  else if (!(align & ALIGN_LEFT)) o.x += cx / 2;
  if (align & ALIGN_BOTTOM) o.y += cy;
  else if (!(align & ALIGN_TOP)) o.y += cy / 2;
}

/**
 * OBS item geometry. Returns the forward affine matrix mapping the item's
 * cropped base space ([0,cw]x[0,ch], source pixels after crop) to the parent
 * space, plus info for crop-to-bounds clipping.
 */
export function itemGeometry(item) {
  const sw = item.sourceWidth || 0,
    sh = item.sourceHeight || 0;
  const c = item.crop ?? { left: 0, top: 0, right: 0, bottom: 0 };
  const cw = Math.max(0, sw - c.left - c.right),
    ch = Math.max(0, sh - c.top - c.bottom);
  let sx = item.scale?.x ?? 1,
    sy = item.scale?.y ?? 1;
  const origin = { x: 0, y: 0 };
  let boxW, boxH;
  let boundsOrigin = null;
  const bt = item.boundsType ?? "none";
  if (bt !== "none" && cw > 0 && ch > 0) {
    const bx = item.bounds?.x ?? 0,
      by = item.bounds?.y ?? 0;
    const w = cw * Math.abs(sx),
      h = ch * Math.abs(sy);
    const itemAspect = w / h,
      boundsAspect = bx / (by || 1);
    let type = bt;
    if (bt === "max_only" && (w > bx || h > by)) type = "scale_inner";
    if (type === "scale_inner" || type === "scale_outer") {
      let useWidth = boundsAspect < itemAspect;
      if (type === "scale_outer") useWidth = !useWidth;
      const mul = useWidth ? bx / w : by / h;
      sx *= mul;
      sy *= mul;
    } else if (type === "scale_to_width") {
      sx *= bx / w;
      sy *= bx / w;
    } else if (type === "scale_to_height") {
      sx *= by / h;
      sy *= by / h;
    } else if (type === "stretch") {
      sx = Math.sign(sx || 1) * (bx / cw);
      sy = Math.sign(sy || 1) * (by / ch);
    }
    const width = cw * sx,
      height = ch * sy;
    addAlign(origin, item.boundsAlignment ?? 0, -(bx - Math.abs(width)), -(by - Math.abs(height)));
    if (width < 0) origin.x += width;
    if (height < 0) origin.y += height;
    boundsOrigin = { x: origin.x, y: origin.y, w: bx, h: by };
    boxW = bx;
    boxH = by;
  } else {
    boxW = cw * sx;
    boxH = ch * sy;
  }
  addAlign(origin, item.alignment ?? 5, boxW, boxH);
  const r = ((item.rot ?? 0) * Math.PI) / 180;
  const cos = Math.cos(r),
    sin = Math.sin(r);
  const px = item.pos?.x ?? 0,
    py = item.pos?.y ?? 0;
  const m = [cos * sx, sin * sx, -sin * sy, cos * sy, -cos * origin.x + sin * origin.y + px, -sin * origin.x - cos * origin.y + py];
  return { m, cw, ch, sx, sy, crop: c, sw, sh, boundsOrigin, clip: !!item.cropToBounds && !!boundsOrigin };
}

export const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export const compose = (p, m) => [
  p[0] * m[0] + p[2] * m[1],
  p[1] * m[0] + p[3] * m[1],
  p[0] * m[2] + p[2] * m[3],
  p[1] * m[2] + p[3] * m[3],
  p[0] * m[4] + p[2] * m[5] + p[4],
  p[1] * m[4] + p[3] * m[5] + p[5],
];
export function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return null;
  const a = m[3] / det,
    b = -m[1] / det,
    c = -m[2] / det,
    d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

/** Axis-aligned bounding box of an item in parent space. */
export function itemBBox(item) {
  const g = itemGeometry(item);
  const pts = [
    [0, 0],
    [g.cw, 0],
    [0, g.ch],
    [g.cw, g.ch],
  ].map(([x, y]) => apply(g.m, x, y));
  const xs = pts.map((p) => p[0]),
    ys = pts.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
}

// ------------------------------------------------------------------ compositor
class Frame {
  constructor(w, h, bg = [0, 0, 0]) {
    this.w = w;
    this.h = h;
    this.rgb = Buffer.alloc(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      this.rgb[i * 3] = bg[0];
      this.rgb[i * 3 + 1] = bg[1];
      this.rgb[i * 3 + 2] = bg[2];
    }
  }
}

function blend(mode, dst, src) {
  switch (mode) {
    case "additive":
      return Math.min(255, dst + src);
    case "subtract":
      return Math.max(0, dst - src);
    case "screen":
      return 255 - ((255 - dst) * (255 - src)) / 255;
    case "multiply":
      return (dst * src) / 255;
    case "lighten":
      return Math.max(dst, src);
    case "darken":
      return Math.min(dst, src);
    default:
      return src;
  }
}

function drawLeaf(frame, M, g, tex, blendMode) {
  const inv = invert(M);
  if (!inv || g.cw <= 0 || g.ch <= 0) return;
  const corners = [
    [0, 0],
    [g.cw, 0],
    [0, g.ch],
    [g.cw, g.ch],
  ].map(([x, y]) => apply(M, x, y));
  const x0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[0]))));
  const x1 = Math.min(frame.w, Math.ceil(Math.max(...corners.map((c) => c[0]))));
  const y0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[1]))));
  const y1 = Math.min(frame.h, Math.ceil(Math.max(...corners.map((c) => c[1]))));
  const kx = tex.w / g.sw,
    ky = tex.h / g.sh;
  const out = frame.rgb,
    td = tex.d;
  for (let y = y0; y < y1; y++) {
    const fy = y + 0.5;
    for (let x = x0; x < x1; x++) {
      const fx = x + 0.5;
      const bx = inv[0] * fx + inv[2] * fy + inv[4];
      const by = inv[1] * fx + inv[3] * fy + inv[5];
      if (bx < 0 || by < 0 || bx >= g.cw || by >= g.ch) continue;
      if (g.clip) {
        const qx = bx * g.sx - g.boundsOrigin.x,
          qy = by * g.sy - g.boundsOrigin.y;
        if (qx < 0 || qy < 0 || qx > g.boundsOrigin.w || qy > g.boundsOrigin.h) continue;
      }
      const tx = Math.min(tex.w - 1, ((bx + g.crop.left) * kx) | 0);
      const ty = Math.min(tex.h - 1, ((by + g.crop.top) * ky) | 0);
      const ti = (ty * tex.w + tx) * 4;
      const a = td[ti + 3] / 255;
      if (a <= 0) continue;
      const oi = (y * frame.w + x) * 3;
      for (let k = 0; k < 3; k++) {
        const s = blend(blendMode, out[oi + k], td[ti + k]);
        out[oi + k] = s * a + out[oi + k] * (1 - a);
      }
    }
  }
}

function drawItems(ctx, frame, items, parent, depth) {
  for (const item of items ?? []) {
    if (!item.visible) continue;
    const g = itemGeometry(item);
    const M = compose(parent, g.m);
    if (item.isGroup) {
      drawItems(ctx, frame, item.items, M, depth);
      continue;
    }
    let tex = null;
    const nested = ctx.scenes.get(item.sourceUuid);
    if (nested) {
      if (depth > 3) continue;
      tex = sceneTexture(ctx, nested, depth + 1);
    } else {
      const src = ctx.sources.get(item.sourceUuid);
      if (!src || !src.enabled) continue;
      tex = sourceTexture(ctx, src, depth);
    }
    if (tex) drawLeaf(frame, M, g, tex, item.blendMode);
  }
}

function sceneTexture(ctx, scene, depth) {
  const w = Math.round(ctx.canvasW / 3),
    h = Math.round(ctx.canvasH / 3);
  const f = new Frame(w, h);
  drawItems(ctx, f, scene.items, [w / ctx.canvasW, 0, 0, h / ctx.canvasH, 0, 0], depth);
  const t = new Tex(w, h);
  for (let i = 0; i < w * h; i++) {
    t.d[i * 4] = f.rgb[i * 3];
    t.d[i * 4 + 1] = f.rgb[i * 3 + 1];
    t.d[i * 4 + 2] = f.rgb[i * 3 + 2];
    t.d[i * 4 + 3] = 255;
  }
  return t;
}

function makeCtx(state) {
  const vertical = state.verticalScenes ?? [];
  return {
    sources: new Map(state.sources.map((s) => [s.uuid, s])),
    scenes: new Map(state.scenes.map((s) => [s.uuid, s])),
    // vertical twins: only reachable as render roots (items never nest them)
    twins: new Map(vertical.map((s) => [s.uuid, s])),
    canvasW: state.video.baseWidth,
    canvasH: state.video.baseHeight,
    verticalW: state.video.verticalWidth || 1080,
    verticalH: state.video.verticalHeight || 1920,
  };
}

/**
 * Render a scene. Horizontal: the base canvas scaled to `maxW` wide.
 * Vertical: the scene's vertical twin (or the twin itself when `sceneUuid`
 * is a twin uuid) on the vertical canvas, scaled to `maxW` tall (e.g. 360x640).
 */
export function renderScene(state, sceneUuid, { canvas = "horizontal", maxW = 640 } = {}) {
  const ctx = makeCtx(state);
  let scene = ctx.scenes.get(sceneUuid) ?? null;
  let vertical = canvas === "vertical";
  if (!scene && ctx.twins.has(sceneUuid)) {
    scene = ctx.twins.get(sceneUuid);
    vertical = true;
  } else if (scene && vertical) {
    scene = ctx.twins.get(scene.verticalSceneUuid) ?? null;
  }
  let frame, root;
  if (vertical) {
    const vw = ctx.verticalW,
      vh = ctx.verticalH;
    const H = Math.round(maxW),
      W = Math.max(1, Math.round((H * vw) / vh));
    frame = new Frame(W, H);
    const k = H / vh;
    root = [k, 0, 0, k, 0, 0];
  } else {
    const cw = ctx.canvasW,
      chh = ctx.canvasH;
    const W = Math.round(maxW),
      H = Math.round((maxW * chh) / cw);
    frame = new Frame(W, H);
    const k = W / cw;
    root = [k, 0, 0, k, 0, 0];
  }
  if (scene) drawItems(ctx, frame, scene.items, root, 0);
  return encodePng(frame.w, frame.h, frame.rgb);
}

/** Render one source at its native aspect over a checkerboard (properties/filter previews). */
export function renderSource(state, sourceUuid, { maxW = 640, maxH = 360 } = {}) {
  const ctx = makeCtx(state);
  const src = ctx.sources.get(sourceUuid);
  const twin = ctx.twins.get(sourceUuid);
  const scene = ctx.scenes.get(sourceUuid) ?? twin;
  let w = src?.width || 0,
    h = src?.height || 0;
  if (scene) {
    w = twin ? ctx.verticalW : ctx.canvasW;
    h = twin ? ctx.verticalH : ctx.canvasH;
  }
  if (!w || !h) {
    const f = new Frame(320, 180, [24, 24, 30]);
    const t = new Tex(320, 180);
    t.text(src?.audio ? "AUDIO" : "SIN VIDEO", 160 - (src?.audio ? 5 : 9) * 9, 80, 3, [148, 163, 184]);
    for (let i = 0; i < 320 * 180; i++)
      if (t.d[i * 4 + 3]) {
        f.rgb[i * 3] = t.d[i * 4];
        f.rgb[i * 3 + 1] = t.d[i * 4 + 1];
        f.rgb[i * 3 + 2] = t.d[i * 4 + 2];
      }
    return encodePng(f.w, f.h, f.rgb);
  }
  const k = Math.min(maxW / w, maxH / h);
  const W = Math.max(1, Math.round(w * k)),
    H = Math.max(1, Math.round(h * k));
  const frame = new Frame(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const v = ((x >> 3) + (y >> 3)) & 1 ? 58 : 40;
      const i = (y * W + x) * 3;
      frame.rgb[i] = frame.rgb[i + 1] = frame.rgb[i + 2] = v;
    }
  if (scene) drawItems(ctx, frame, scene.items, [k, 0, 0, k, 0, 0], 0);
  else {
    const tex = sourceTexture(ctx, src, 0);
    if (tex) {
      const g = { cw: w, ch: h, sw: w, sh: h, sx: 1, sy: 1, crop: { left: 0, top: 0 }, clip: false };
      drawLeaf(frame, [k, 0, 0, k, 0, 0], g, tex, "normal");
    }
  }
  return encodePng(frame.w, frame.h, frame.rgb);
}
