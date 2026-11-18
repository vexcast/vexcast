/**
 * OBS scene item transform math (same conventions as libobs / OBS Studio's
 * preview): `pos` is the anchor point selected by `alignment`, the box is
 * `(source - crop) * |scale|` (or `bounds` when a bounding box is set) and
 * `rot` rotates clockwise (degrees) around `pos`.
 */
import { ALIGN, type Alignment, type SceneItem } from "@vexcast/protocol";

export interface Pt {
  x: number;
  y: number;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Handle position on the box: 0 = left/top, 0.5 = middle, 1 = right/bottom. */
export interface Handle {
  hx: 0 | 0.5 | 1;
  hy: 0 | 0.5 | 1;
}

export const HANDLES: Handle[] = [
  { hx: 0, hy: 0 },
  { hx: 0.5, hy: 0 },
  { hx: 1, hy: 0 },
  { hx: 1, hy: 0.5 },
  { hx: 1, hy: 1 },
  { hx: 0.5, hy: 1 },
  { hx: 0, hy: 1 },
  { hx: 0, hy: 0.5 },
];

type TransformFields = Pick<
  SceneItem,
  "pos" | "rot" | "scale" | "alignment" | "boundsType" | "bounds" | "crop" | "sourceWidth" | "sourceHeight" | "boundsAlignment" | "cropToBounds"
>;

/** Cropped source size (before scale). */
export function croppedSize(it: TransformFields): { w: number; h: number } {
  return {
    w: Math.max(0, it.sourceWidth - it.crop.left - it.crop.right),
    h: Math.max(0, it.sourceHeight - it.crop.top - it.crop.bottom),
  };
}

/** Size of the item's box on the canvas (always positive). */
export function boxSize(it: TransformFields): { w: number; h: number } {
  if (it.boundsType !== "none") return { w: Math.abs(it.bounds.x), h: Math.abs(it.bounds.y) };
  const c = croppedSize(it);
  return { w: c.w * Math.abs(it.scale.x), h: c.h * Math.abs(it.scale.y) };
}

/** Offset from `pos` to the box's top-left corner (unrotated). */
export function alignOffset(align: Alignment, w: number, h: number): Pt {
  const x = align & ALIGN.LEFT ? 0 : align & ALIGN.RIGHT ? -w : -w / 2;
  const y = align & ALIGN.TOP ? 0 : align & ALIGN.BOTTOM ? -h : -h / 2;
  return { x, y };
}

export function rotate(p: Pt, deg: number): Pt {
  if (!deg) return p;
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/** Box-local point (from the box's top-left, unrotated) → canvas. */
export function localToCanvas(it: TransformFields, p: Pt): Pt {
  const { w, h } = boxSize(it);
  const o = alignOffset(it.alignment, w, h);
  const r = rotate({ x: o.x + p.x, y: o.y + p.y }, it.rot);
  return { x: it.pos.x + r.x, y: it.pos.y + r.y };
}

/** Canvas → box-local point. */
export function canvasToLocal(it: TransformFields, c: Pt): Pt {
  const { w, h } = boxSize(it);
  const o = alignOffset(it.alignment, w, h);
  const r = rotate({ x: c.x - it.pos.x, y: c.y - it.pos.y }, -it.rot);
  return { x: r.x - o.x, y: r.y - o.y };
}

export function corners(it: TransformFields): Pt[] {
  const { w, h } = boxSize(it);
  return [
    localToCanvas(it, { x: 0, y: 0 }),
    localToCanvas(it, { x: w, y: 0 }),
    localToCanvas(it, { x: w, y: h }),
    localToCanvas(it, { x: 0, y: h }),
  ];
}

export function aabb(it: TransformFields): Rect {
  const cs = corners(it);
  return {
    x0: Math.min(...cs.map((c) => c.x)),
    y0: Math.min(...cs.map((c) => c.y)),
    x1: Math.max(...cs.map((c) => c.x)),
    y1: Math.max(...cs.map((c) => c.y)),
  };
}

export function hitTest(it: TransformFields, c: Pt): boolean {
  const { w, h } = boxSize(it);
  const p = canvasToLocal(it, c);
  return p.x >= 0 && p.y >= 0 && p.x <= w && p.y <= h;
}

/** Child of a group → canvas (groups are plain, unbounded containers). */
export function groupChildCorners(group: TransformFields, child: TransformFields): Pt[] {
  const sx = Math.abs(group.scale.x);
  const sy = Math.abs(group.scale.y);
  return corners(child).map((p) => localToCanvas(group, { x: (p.x - group.crop.left) * sx, y: (p.y - group.crop.top) * sy }));
}

// ------------------------------------------------------------------ snapping

export interface SnapResult {
  dx: number;
  dy: number;
  guidesX: number[];
  guidesY: number[];
}

export interface SnapOptions {
  canvasW: number;
  canvasH: number;
  threshold: number;
  edges: boolean;
  center: boolean;
  others: Rect[];
}

/** Snap a moving rect: returns the extra offset to apply and the guide lines hit. */
export function snapRect(r: Rect, o: SnapOptions): SnapResult {
  const xs: number[] = [];
  const ys: number[] = [];
  if (o.edges) {
    xs.push(0, o.canvasW);
    ys.push(0, o.canvasH);
  }
  for (const other of o.others) {
    xs.push(other.x0, other.x1);
    ys.push(other.y0, other.y1);
  }
  const best = (vals: number[], targets: number[]) => {
    let d = Infinity;
    let line = NaN;
    for (const v of vals)
      for (const t of targets) {
        const diff = t - v;
        if (Math.abs(diff) < Math.abs(d)) {
          d = diff;
          line = t;
        }
      }
    return { d, line };
  };
  let bx = best([r.x0, r.x1], xs);
  let by = best([r.y0, r.y1], ys);
  if (o.center) {
    const cx = best([(r.x0 + r.x1) / 2], [o.canvasW / 2]);
    const cy = best([(r.y0 + r.y1) / 2], [o.canvasH / 2]);
    if (Math.abs(cx.d) < Math.abs(bx.d)) bx = cx;
    if (Math.abs(cy.d) < Math.abs(by.d)) by = cy;
  }
  const res: SnapResult = { dx: 0, dy: 0, guidesX: [], guidesY: [] };
  if (Math.abs(bx.d) <= o.threshold) {
    res.dx = bx.d;
    res.guidesX.push(bx.line);
  }
  if (Math.abs(by.d) <= o.threshold) {
    res.dy = by.d;
    res.guidesY.push(by.line);
  }
  return res;
}

/** Snap a single point (handle while resizing) to canvas edges/center. */
export function snapPoint(p: Pt, o: SnapOptions): { p: Pt; guidesX: number[]; guidesY: number[] } {
  const r = snapRect({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }, { ...o, center: false });
  const res = { p: { x: p.x + r.dx, y: p.y + r.dy }, guidesX: r.guidesX, guidesY: r.guidesY };
  if (o.center) {
    if (!r.guidesX.length && Math.abs(p.x - o.canvasW / 2) <= o.threshold) {
      res.p.x = o.canvasW / 2;
      res.guidesX = [o.canvasW / 2];
    }
    if (!r.guidesY.length && Math.abs(p.y - o.canvasH / 2) <= o.threshold) {
      res.p.y = o.canvasH / 2;
      res.guidesY = [o.canvasH / 2];
    }
  }
  return res;
}

// ------------------------------------------------------------------ edit operations

/** Re-position so the box-local point `anchorFrac` keeps its canvas position. */
function keepAnchor(prev: TransformFields, next: TransformFields, anchorFrac: Pt): Pt {
  const a = boxSize(prev);
  const anchorCanvas = localToCanvas(prev, { x: anchorFrac.x * a.w, y: anchorFrac.y * a.h });
  const b = boxSize(next);
  const o = alignOffset(next.alignment, b.w, b.h);
  const r = rotate({ x: o.x + anchorFrac.x * b.w, y: o.y + anchorFrac.y * b.h }, next.rot);
  return { x: anchorCanvas.x - r.x, y: anchorCanvas.y - r.y };
}

/**
 * Resize with a handle (OBS "stretch"). Without bounds it changes `scale`
 * keeping the aspect ratio unless `shift`; with bounds it changes `bounds`
 * freely unless `shift` (OBS behaviour). The opposite side stays fixed.
 */
export function resizeItem(start: TransformFields, handle: Handle, pointer: Pt, shift: boolean): Partial<SceneItem> {
  const { w, h } = boxSize(start);
  const bounded = start.boundsType !== "none";
  const p = canvasToLocal(start, pointer);
  const ax = (1 - handle.hx) * w;
  const ay = (1 - handle.hy) * h;
  let nw = w;
  let nh = h;
  if (handle.hx !== 0.5) nw = Math.max(1, handle.hx === 1 ? p.x - ax : ax - p.x);
  if (handle.hy !== 0.5) nh = Math.max(1, handle.hy === 1 ? p.y - ay : ay - p.y);
  const lock = bounded ? shift : !shift;
  if (lock && w > 0 && h > 0) {
    const aspect = w / h;
    if (handle.hx !== 0.5 && handle.hy !== 0.5) {
      if (nw / w > nh / h) nh = nw / aspect;
      else nw = nh * aspect;
    } else if (handle.hx !== 0.5) nh = nw / aspect;
    else nw = nh * aspect;
  }
  const patch: Partial<SceneItem> = {};
  if (bounded) patch.bounds = { x: round3(nw), y: round3(nh) };
  else {
    const c = croppedSize(start);
    if (c.w <= 0 || c.h <= 0) return {};
    const sx = (start.scale.x < 0 ? -1 : 1) * (nw / c.w);
    const sy = (start.scale.y < 0 ? -1 : 1) * (nh / c.h);
    patch.scale = { x: round6(sx), y: round6(sy) };
  }
  const next = { ...start, ...patch } as TransformFields;
  patch.pos = roundPt(keepAnchor(start, next, { x: 1 - handle.hx, y: 1 - handle.hy }));
  return patch;
}

/**
 * Alt+drag a handle = crop that side (in source pixels). The visible content
 * keeps its position on the canvas (the opposite side stays fixed).
 */
export function cropItem(start: TransformFields, handle: Handle, pointer: Pt): Partial<SceneItem> {
  const { w, h } = boxSize(start);
  const p = canvasToLocal(start, pointer);
  const crop = { ...start.crop };
  const bounded = start.boundsType !== "none";
  // Pixels of source per canvas pixel along each axis.
  const c = croppedSize(start);
  const kx = bounded ? (w > 0 ? c.w / w : 1) : 1 / Math.max(1e-6, Math.abs(start.scale.x));
  const ky = bounded ? (h > 0 ? c.h / h : 1) : 1 / Math.max(1e-6, Math.abs(start.scale.y));
  const flipX = start.scale.x < 0;
  const flipY = start.scale.y < 0;
  const W = start.sourceWidth;
  const H = start.sourceHeight;
  if (handle.hx === 0) {
    const side = flipX ? "right" : "left";
    const other = flipX ? crop.left : crop.right;
    crop[side] = clampInt(crop[side] + p.x * kx, 0, W - other - 1);
  } else if (handle.hx === 1) {
    const side = flipX ? "left" : "right";
    const other = flipX ? crop.right : crop.left;
    crop[side] = clampInt(crop[side] + (w - p.x) * kx, 0, W - other - 1);
  }
  if (handle.hy === 0) {
    const side = flipY ? "bottom" : "top";
    const other = flipY ? crop.top : crop.bottom;
    crop[side] = clampInt(crop[side] + p.y * ky, 0, H - other - 1);
  } else if (handle.hy === 1) {
    const side = flipY ? "top" : "bottom";
    const other = flipY ? crop.bottom : crop.top;
    crop[side] = clampInt(crop[side] + (h - p.y) * ky, 0, H - other - 1);
  }
  const patch: Partial<SceneItem> = { crop };
  const next = { ...start, crop } as TransformFields;
  if (!bounded) patch.pos = roundPt(keepAnchor(start, next, { x: handle.hx === 0 ? 1 : 0, y: handle.hy === 0 ? 1 : 0 }));
  return patch;
}

/** Rotation handle: angle from the box center; keeps the center fixed. */
export function rotateItem(start: TransformFields, pointer: Pt, shift: boolean): Partial<SceneItem> {
  const { w, h } = boxSize(start);
  const center = localToCanvas(start, { x: w / 2, y: h / 2 });
  let deg = (Math.atan2(pointer.y - center.y, pointer.x - center.x) * 180) / Math.PI + 90;
  if (shift) deg = Math.round(deg / 15) * 15;
  deg = ((deg % 360) + 360) % 360;
  const o = alignOffset(start.alignment, w, h);
  const r = rotate({ x: o.x + w / 2, y: o.y + h / 2 }, deg);
  return { rot: round3(deg), pos: roundPt({ x: center.x - r.x, y: center.y - r.y }) };
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;
const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
const roundPt = (p: Pt): Pt => ({ x: round3(p.x), y: round3(p.y) });
const clampInt = (v: number, min: number, max: number) => Math.round(Math.min(Math.max(v, min), Math.max(min, max)));

// ------------------------------------------------------------------ coordinate spaces (group children)

/** Maps between an item's parent space and the canvas (identity for top-level items). */
export interface Space {
  toCanvas: (p: Pt) => Pt;
  fromCanvas: (c: Pt) => Pt;
  /** Extra rotation applied by the parent (degrees). */
  rot: number;
  /** Canvas pixels per parent unit (average). */
  scale: number;
}

export const IDENTITY_SPACE: Space = { toCanvas: (p) => p, fromCanvas: (c) => c, rot: 0, scale: 1 };

/** Space of a group's children: their transforms are relative to the group's source space. */
export function groupSpace(g: TransformFields): Space {
  const sx = Math.abs(g.scale.x) || 1;
  const sy = Math.abs(g.scale.y) || 1;
  return {
    toCanvas: (q) => localToCanvas(g, { x: (q.x - g.crop.left) * sx, y: (q.y - g.crop.top) * sy }),
    fromCanvas: (c) => {
      const l = canvasToLocal(g, c);
      return { x: l.x / sx + g.crop.left, y: l.y / sy + g.crop.top };
    },
    rot: g.rot,
    scale: (sx + sy) / 2,
  };
}
