/**
 * OBS-style preview: the core's MJPEG picture plus an interactive overlay for
 * selecting, moving, resizing (Shift = free), cropping (Alt) and rotating
 * scene items, with snapping. Items inside groups can be edited too (their
 * transform is relative to the group). All math lives in lib/transform.ts.
 */
import type { SceneItem, Uuid } from "@vexcast/protocol";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { MenuItems } from "@/components/menu";
import { useSourceMenu } from "@/components/source-menu";
import { useT } from "@/i18n";
import { openDialog } from "@/lib/dialogs";
import { throttle } from "@/lib/format";
import { usePrefs } from "@/lib/prefs";
import { act, api, canvasSize, findScene, mapScene, useStore } from "@/lib/store";
import {
  aabb,
  boxSize,
  corners,
  cropItem,
  groupSpace,
  HANDLES,
  type Handle,
  hitTest,
  IDENTITY_SPACE,
  localToCanvas,
  type Pt,
  resizeItem,
  rotateItem,
  snapPoint,
  snapRect,
  type Space,
} from "@/lib/transform";
import { cn } from "@/lib/utils";
import { LiveImage } from "@/components/preview/live-image";

interface Props {
  sceneUuid: Uuid | null;
  /** Interactive overlay (false for the Program pane in studio mode). */
  editable: boolean;
  /** MJPEG of the program (true) or of `sceneUuid` (studio preview). */
  program?: boolean;
  /** Program MJPEG of the vertical (9:16) canvas. */
  vertical?: boolean;
  /** Called before handling a click (e.g. to make this pane's canvas the edited one). */
  onActivate?: () => void;
  className?: string;
}

/** An editable item with the space it lives in (canvas, or its group). */
interface Entity {
  item: SceneItem;
  space: Space;
  /** Parent group (null for top-level items). */
  group: SceneItem | null;
}

type Drag =
  | { mode: "move"; start: Pt; ents: Entity[]; moved: boolean }
  | { mode: "resize" | "crop"; start: Pt; ent: Entity; handle: Handle }
  | { mode: "rotate"; start: Pt; ent: Entity };

const HANDLE_PX = 8;
const ROT_OFFSET_PX = 26;
const SNAP_PX = 10;

const handleCursor = (h: Handle) =>
  h.hx === 0.5 ? "ns-resize" : h.hy === 0.5 ? "ew-resize" : (h.hx === 0) === (h.hy === 0) ? "nwse-resize" : "nesw-resize";

function patchItems(items: SceneItem[], id: number, patch: Partial<SceneItem>): SceneItem[] {
  return items.map((it) => (it.id === id ? { ...it, ...patch } : it.isGroup && it.items ? { ...it, items: patchItems(it.items, id, patch) } : it));
}

const topEnt = (it: SceneItem): Entity => ({ item: it, space: IDENTITY_SPACE, group: null });

export function PreviewPane({ sceneUuid, editable, program, vertical, onActivate, className }: Props) {
  const t = useT();
  const client = useStore((s) => s.client!);
  const video = useStore((s) => s.state!.video);
  const scene = useStore((s) => findScene(s.state!, sceneUuid));
  const sizeW = useStore((s) => canvasSize(s.state!, sceneUuid).w);
  const sizeH = useStore((s) => canvasSize(s.state!, sceneUuid).h);
  const overrides = useStore((s) => s.overrides);
  const selection = useStore((s) => s.selection);
  const prefs = usePrefs();
  const W = vertical ? video.verticalWidth : sizeW;
  const H = vertical ? video.verticalHeight : sizeH;

  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Canvas → screen scale.
  const k = useMemo(() => {
    if (prefs.previewScaling === "canvas") return 1;
    if (prefs.previewScaling === "output") return video.outputWidth / video.baseWidth;
    return Math.max(0.01, Math.min(box.w / W, box.h / H));
  }, [prefs.previewScaling, box, W, H, video.outputWidth, video.baseWidth]);
  const stageW = W * k;
  const stageH = H * k;

  const src = useMemo(
    () =>
      prefs.previewEnabled
        ? client.previewUrl({ ...(program || !sceneUuid ? (vertical ? { canvas: "vertical" as const } : {}) : { scene: sceneUuid }), quality: prefs.previewQuality })
        : "",
    [client, program, vertical, sceneUuid, prefs.previewEnabled, prefs.previewQuality],
  );

  // Effective items (optimistic overrides applied, also inside groups).
  const items = useMemo(() => {
    const ov = (it: SceneItem): SceneItem => {
      const o = overrides[it.id] ? { ...it, ...overrides[it.id] } : it;
      return o.isGroup && o.items ? { ...o, items: o.items.map(ov) } : o;
    };
    return scene ? scene.items.map(ov) : [];
  }, [scene, overrides]);

  /** Selected group children, edited in their group's space. */
  const childEnts = useMemo(() => {
    const out: Entity[] = [];
    for (const g of items) if (g.isGroup && g.items) for (const c of g.items) if (selection.includes(c.id)) out.push({ item: c, space: groupSpace(g), group: g });
    return out;
  }, [items, selection]);
  const entityOf = (id: number): Entity | null => {
    const top = items.find((i) => i.id === id);
    if (top) return topEnt(top);
    return childEnts.find((e) => e.item.id === id) ?? null;
  };

  const [hover, setHover] = useState<number | null>(null);
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  const [menuItem, setMenuItem] = useState<SceneItem | null>(null);
  const drag = useRef<Drag | null>(null);

  const toCanvas = (e: { clientX: number; clientY: number }): Pt => {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
  };

  const hits = (en: Entity, p: Pt) => {
    const { w, h } = boxSize(en.item);
    return en.item.visible && w > 0 && h > 0 && hitTest(en.item, en.space.fromCanvas(p));
  };
  /** Selected group children first (so they can be dragged), then top-level items top-down. */
  const pick = (p: Pt): Entity | null => {
    for (const en of childEnts) if (hits(en, p)) return en;
    for (let i = items.length - 1; i >= 0; i--) {
      const en = topEnt(items[i]);
      if (hits(en, p)) return en;
    }
    return null;
  };

  // Throttled network updates while dragging (~30/s).
  const pending = useRef(new Map<number, Partial<SceneItem>>());
  const send = useMemo(
    () =>
      throttle(() => {
        if (!sceneUuid) return;
        const batch = [...pending.current.entries()];
        pending.current.clear();
        for (const [id, patch] of batch) api().updateItem(sceneUuid, id, patch).catch(() => {});
      }, 33),
    [sceneUuid],
  );

  const apply = (id: number, patch: Partial<SceneItem>) => {
    useStore.getState().setOverride(id, patch);
    pending.current.set(id, { ...pending.current.get(id), ...patch });
    send();
  };

  const snapOpts = (exclude: Set<number>) => ({
    canvasW: W,
    canvasH: H,
    threshold: SNAP_PX / k,
    edges: prefs.snapToEdges,
    center: prefs.snapToCenter,
    others: prefs.snapToItems ? items.filter((i) => i.visible && !exclude.has(i.id) && boxSize(i).w > 0).map(aabb) : [],
  });

  const onPointerDown = (e: React.PointerEvent) => {
    if (editable) onActivate?.();
    if (!editable || !scene || e.button !== 0) return;
    const p = toCanvas(e);
    const target = e.target as Element;
    const hEl = target.closest("[data-handle]") as HTMLElement | null;
    const st = useStore.getState();
    if (hEl) {
      const en = entityOf(Number(hEl.dataset.item));
      if (!en || en.item.locked || prefs.previewLocked) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      if (hEl.dataset.handle === "rot") drag.current = { mode: "rotate", start: p, ent: en };
      else {
        const [hx, hy] = hEl.dataset.handle!.split(",").map(Number) as [Handle["hx"], Handle["hy"]];
        drag.current = { mode: e.altKey ? "crop" : "resize", start: p, ent: en, handle: { hx, hy } };
      }
      return;
    }
    const hit = pick(p);
    if (!hit) {
      if (!e.ctrlKey) st.select([]);
      return;
    }
    const id = hit.item.id;
    let sel = st.selection;
    if (e.ctrlKey || e.metaKey) {
      sel = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
      st.select(sel);
      return;
    }
    if (!sel.includes(id)) {
      sel = [id];
      st.select(sel);
    }
    if (prefs.previewLocked) return;
    const moving = hit.group ? (hit.item.locked ? [] : [hit]) : items.filter((i) => sel.includes(i.id) && !i.locked).map(topEnt);
    if (!moving.length) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode: "move", start: p, ents: moving, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = toCanvas(e);
    const d = drag.current;
    if (!d) {
      if (editable) setHover(pick(p)?.item.id ?? null);
      return;
    }
    if (d.mode === "move") {
      if (!d.moved && Math.hypot((p.x - d.start.x) * k, (p.y - d.start.y) * k) < 2) return;
      d.moved = true;
      if (d.ents[0].group) {
        // Inside a group: deltas measured in the group's space.
        const en = d.ents[0];
        const a = en.space.fromCanvas(d.start);
        const b = en.space.fromCanvas(p);
        apply(en.item.id, { pos: { x: round(en.item.pos.x + b.x - a.x), y: round(en.item.pos.y + b.y - a.y) } });
        return;
      }
      let dx = p.x - d.start.x;
      let dy = p.y - d.start.y;
      let gx: number[] = [];
      let gy: number[] = [];
      if (prefs.snapping) {
        const moved = d.ents.map(({ item: it }) => aabb({ ...it, pos: { x: it.pos.x + dx, y: it.pos.y + dy } }));
        const r = { x0: Math.min(...moved.map((m) => m.x0)), y0: Math.min(...moved.map((m) => m.y0)), x1: Math.max(...moved.map((m) => m.x1)), y1: Math.max(...moved.map((m) => m.y1)) };
        const s = snapRect(r, snapOpts(new Set(d.ents.map((x) => x.item.id))));
        dx += s.dx;
        dy += s.dy;
        gx = s.guidesX;
        gy = s.guidesY;
      }
      setGuides({ x: gx, y: gy });
      for (const { item: it } of d.ents) apply(it.id, { pos: { x: round(it.pos.x + dx), y: round(it.pos.y + dy) } });
      return;
    }
    const en = d.ent;
    if (d.mode === "rotate") {
      apply(en.item.id, rotateItem(en.item, en.space.fromCanvas(p), e.shiftKey));
      return;
    }
    let q = p;
    if (prefs.snapping && d.mode === "resize" && !en.item.rot && !en.group) {
      const s = snapPoint(p, snapOpts(new Set([en.item.id])));
      q = s.p;
      setGuides({ x: d.handle.hx === 0.5 ? [] : s.guidesX, y: d.handle.hy === 0.5 ? [] : s.guidesY });
    }
    const lq = en.space.fromCanvas(q);
    apply(en.item.id, d.mode === "crop" ? cropItem(en.item, d.handle, lq) : resizeItem(en.item, d.handle, lq, e.shiftKey));
  };

  const onPointerUp = async (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setGuides({ x: [], y: [] });
    if (!d || !sceneUuid) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    send.flush();
    const ids = d.mode === "move" ? d.ents.map((x) => x.item.id) : [d.ent.item.id];
    const ov = useStore.getState().overrides;
    // Final commit of the complete transform, then drop the optimistic layer.
    await Promise.all(
      ids.map(async (id) => {
        const patch = ov[id];
        if (!patch) return;
        const res = await act((c) => c.updateItem(sceneUuid, id, patch));
        if (res) useStore.getState().mutate((s) => mapScene(s, sceneUuid, (sc) => ({ ...sc, items: patchItems(sc.items, id, patch) })));
        useStore.getState().setOverride(id, null);
      }),
    );
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (!editable) return;
    const hit = pick(toCanvas(e));
    if (hit && !hit.item.isGroup) openDialog("properties", { type: "source", uuid: hit.item.sourceUuid });
  };

  const onContextMenu = (e: React.MouseEvent) => {
    if (!editable) return;
    onActivate?.();
    const hit = pick(toCanvas(e));
    const st = useStore.getState();
    if (hit && !st.selection.includes(hit.item.id)) st.select([hit.item.id]);
    if (!hit) st.select([]);
    setMenuItem(hit?.item ?? null);
  };

  const label = !scene && !program ? t.preview.noScene : null;
  const selected: Entity[] = [...items.filter((i) => selection.includes(i.id)).map(topEnt), ...childEnts];
  const hovered = hover != null && !selection.includes(hover) ? entityOf(hover) : null;
  const overlay = (
    <div
      ref={wrapRef}
      className={cn("relative min-h-0 min-w-0 flex-1 bg-muted/40", prefs.previewScaling === "window" ? "overflow-hidden" : "overflow-auto", className)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => !drag.current && setHover(null)}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      data-testid={editable ? "preview-editor" : "program-view"}
    >
      <div
        className={cn(prefs.previewScaling === "window" ? "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" : "relative m-4")}
        style={{ width: stageW, height: stageH }}
      >
        <div ref={stageRef} className="absolute inset-0 overflow-hidden bg-black shadow-sm ring-1 ring-border" data-testid="preview-stage">
          {src ? (
            <LiveImage src={src} className="pointer-events-none absolute inset-0 size-full object-fill select-none" />
          ) : (
            <div className="grid size-full place-items-center text-sm text-muted-foreground">{t.preview.disabled}</div>
          )}
          {label && <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">{label}</div>}
        </div>
        {editable && scene && <Overlay selected={selected} hovered={hovered} k={k} W={W} H={H} guides={guides} locked={prefs.previewLocked} />}
      </div>
    </div>
  );

  if (!editable) return overlay;
  return <PreviewContextMenu item={menuItem}>{overlay}</PreviewContextMenu>;
}

function PreviewContextMenu({ item, children }: { item: SceneItem | null; children: React.ReactNode }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        <SourceMenuItems item={item} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function SourceMenuItems({ item }: { item: SceneItem | null }) {
  const nodes = useSourceMenu(item);
  return <MenuItems nodes={nodes} kind="context" />;
}

const round = (v: number) => Math.round(v * 100) / 100;
const pts = (ps: Pt[]) => ps.map((p) => `${p.x},${p.y}`).join(" ");

function Overlay({
  selected,
  hovered,
  k,
  W,
  H,
  guides,
  locked,
}: {
  selected: Entity[];
  hovered: Entity | null;
  k: number;
  W: number;
  H: number;
  guides: { x: number[]; y: number[] };
  locked: boolean;
}) {
  const hs = HANDLE_PX / k;
  const cornersOf = (en: Entity) => corners(en.item).map(en.space.toCanvas);
  return (
    <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" data-testid="preview-overlay">
      {guides.x.map((x, i) => (
        <line key={`gx${i}`} x1={x} y1={0} x2={x} y2={H} className="stroke-sky-500" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray="4 3" />
      ))}
      {guides.y.map((y, i) => (
        <line key={`gy${i}`} x1={0} y1={y} x2={W} y2={y} className="stroke-sky-500" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray="4 3" />
      ))}
      {hovered && boxSize(hovered.item).w > 0 && <polygon points={pts(cornersOf(hovered))} fill="none" className="stroke-red-500/70" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
      {selected.map((en) => {
        const it = en.item;
        const { w, h } = boxSize(it);
        const toC = (p: Pt) => en.space.toCanvas(localToCanvas(it, p));
        const canEdit = !it.locked && !locked;
        const top = toC({ x: w / 2, y: 0 });
        const rot = toC({ x: w / 2, y: -ROT_OFFSET_PX / (k * en.space.scale) });
        const rotDeg = it.rot + en.space.rot;
        return (
          <g key={it.id} data-testid={`selection-${it.id}`}>
            {en.group && <polygon points={pts(corners(en.group))} fill="none" className="stroke-red-500/40" strokeWidth={1} strokeDasharray="5 3" vectorEffect="non-scaling-stroke" />}
            <polygon points={pts(cornersOf(en))} fill="none" className={it.locked ? "stroke-red-500/60" : "stroke-red-500"} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            {canEdit && (
              <>
                <line x1={top.x} y1={top.y} x2={rot.x} y2={rot.y} className="stroke-red-500" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                <circle
                  cx={rot.x}
                  cy={rot.y}
                  r={hs * 0.65}
                  className="pointer-events-auto fill-white stroke-red-500"
                  strokeWidth={1.5}
                  vectorEffect="non-scaling-stroke"
                  style={{ cursor: "grab" }}
                  data-handle="rot"
                  data-item={it.id}
                  data-testid={`rot-${it.id}`}
                />
                {HANDLES.map((hd) => {
                  const c = toC({ x: hd.hx * w, y: hd.hy * h });
                  return (
                    <rect
                      key={`${hd.hx},${hd.hy}`}
                      x={c.x - hs / 2}
                      y={c.y - hs / 2}
                      width={hs}
                      height={hs}
                      transform={rotDeg ? `rotate(${rotDeg} ${c.x} ${c.y})` : undefined}
                      className="pointer-events-auto fill-red-500 stroke-white"
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                      style={{ cursor: handleCursor(hd) }}
                      data-handle={`${hd.hx},${hd.hy}`}
                      data-item={it.id}
                      data-testid={`handle-${it.id}-${hd.hx}-${hd.hy}`}
                    />
                  );
                })}
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Keyboard editing for the preview selection (arrows, Delete, clipboard). */
export function usePreviewKeys(onKey: (e: KeyboardEvent) => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (document.querySelector("[role=dialog],[role=alertdialog],[role=menu]")) return;
      onKey(e);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onKey]);
}
