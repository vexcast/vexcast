/**
 * Alert canvas: the real renderer (widgets/alert-preview.html in an iframe, the
 * same code as the overlay) with draggable/resizable layer boxes on top, plus a
 * small read-only thumbnail used by the alert cards.
 */
import type { AlertDesign, AlertLayer } from "@vexcast/protocol";
import { Film, Image as ImageIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT } from "@/i18n";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

/** Dark checkerboard: shows the alert as it will look over the stream. */
export const CHECKER: React.CSSProperties = {
  backgroundColor: "#15151b",
  backgroundImage: "conic-gradient(#1e1e26 25%, transparent 0 50%, #1e1e26 0 75%, transparent 0)",
  backgroundSize: "22px 22px",
};

const HANDLES: [number, number][] = [
  [0, 0],
  [0.5, 0],
  [1, 0],
  [0, 0.5],
  [1, 0.5],
  [0, 1],
  [0.5, 1],
  [1, 1],
];

export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/** Iframe running the overlay renderer; re-renders whenever design/event/mode change. */
function usePreviewFrame(design: AlertDesign, event: Record<string, unknown>, mode: "static" | "play", playKey: number, onDone?: () => void) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      if (e.data?.type === "vx-alert-preview-ready") setReady(true);
      if (e.data?.type === "vx-alert-preview-done") onDone?.();
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [onDone]);
  const designJson = JSON.stringify(design);
  const eventJson = JSON.stringify(event);
  useEffect(() => {
    if (!ready) return;
    frame.current?.contentWindow?.postMessage({ type: "vx-alert-preview", design: JSON.parse(designJson), event: JSON.parse(eventJson), mode }, "*");
  }, [ready, designJson, eventJson, mode, playKey]);
  return frame;
}

/** Read-only, scaled preview of a design (alert cards, template gallery). */
/** Thumbnail: the preview iframe only exists while the card is on (or near) screen. */
export function AlertThumb({ design, event, className }: { design: AlertDesign; event: Record<string, unknown>; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") return setNear(true);
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={box} className={cn("relative overflow-hidden rounded-md", className)} style={{ ...CHECKER, aspectRatio: `${design.width} / ${design.height}` }}>
      {near && <ThumbFrame design={design} event={event} />}
    </div>
  );
}

function ThumbFrame({ design, event }: { design: AlertDesign; event: Record<string, unknown> }) {
  const client = useStore((s) => s.client);
  const frame = usePreviewFrame(design, event, "static", 0);
  if (!client) return null;
  return <iframe ref={frame} title={design.name} src={client.alertPreviewUrl()} loading="lazy" className="pointer-events-none absolute inset-0 size-full border-0" tabIndex={-1} />;
}

export function Canvas({
  design,
  selected,
  onSelect,
  onLayer,
  onEditLayer,
  event,
  playKey,
  onPlayEnd,
  onDropFiles,
}: {
  design: AlertDesign;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onLayer: (id: string, patch: Partial<AlertLayer>) => void;
  /** Double click on a layer (focus its text / file). */
  onEditLayer: (id: string) => void;
  event: Record<string, unknown>;
  playKey: number;
  onPlayEnd: () => void;
  onDropFiles: (files: File[], x: number, y: number) => void;
}) {
  const t = useT();
  const client = useStore((s) => s.client);
  const [wrapRef, wrap] = useElementSize<HTMLDivElement>();
  const playing = playKey > 0;
  const frame = usePreviewFrame(design, event, playing ? "play" : "static", playKey, onPlayEnd);
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  const W = design.width || 1920;
  const H = design.height || 1080;
  const scale = wrap.w && wrap.h ? Math.min((wrap.w - 24) / W, (wrap.h - 24) / H) : 0.3;

  // Drag / resize (snapping to the canvas center and edges; Alt disables it, Shift keeps the ratio).
  const drag = useRef<{ id: string; handle: [number, number] | null; px: number; py: number; x: number; y: number; w: number; h: number } | null>(null);
  const down = (e: React.PointerEvent, l: AlertLayer, handle: [number, number] | null) => {
    e.stopPropagation();
    onSelect(l.id);
    if (l.locked || e.button !== 0) return;
    drag.current = { id: l.id, handle, px: e.clientX, py: e.clientY, x: l.x, y: l.y, w: l.w, h: l.h };
    const move = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = (ev.clientX - d.px) / scale;
      const dy = (ev.clientY - d.py) / scale;
      if (!d.handle) {
        let x = Math.round(d.x + dx);
        let y = Math.round(d.y + dy);
        const g: { x?: number; y?: number } = {};
        const snap = 10 / scale;
        if (!ev.altKey) {
          const cx = x + d.w / 2;
          const cy = y + d.h / 2;
          if (Math.abs(cx - W / 2) < snap) (x = Math.round(W / 2 - d.w / 2)), (g.x = W / 2);
          else if (Math.abs(x) < snap) (x = 0), (g.x = 0);
          else if (Math.abs(x + d.w - W) < snap) (x = W - d.w), (g.x = W);
          if (Math.abs(cy - H / 2) < snap) (y = Math.round(H / 2 - d.h / 2)), (g.y = H / 2);
          else if (Math.abs(y) < snap) (y = 0), (g.y = 0);
          else if (Math.abs(y + d.h - H) < snap) (y = H - d.h), (g.y = H);
        }
        setGuides(g);
        onLayer(d.id, { x, y });
      } else {
        const [hx, hy] = d.handle;
        let x = d.x;
        let y = d.y;
        let w = d.w;
        let h = d.h;
        if (hx === 0) (x = d.x + dx), (w = d.w - dx);
        if (hx === 1) w = d.w + dx;
        if (hy === 0) (y = d.y + dy), (h = d.h - dy);
        if (hy === 1) h = d.h + dy;
        if (ev.shiftKey && hx !== 0.5 && hy !== 0.5) {
          const r = d.w / d.h;
          if (Math.abs(w / d.w) > Math.abs(h / d.h)) {
            const nh = w / r;
            if (hy === 0) y = d.y + d.h - nh;
            h = nh;
          } else {
            const nw = h * r;
            if (hx === 0) x = d.x + d.w - nw;
            w = nw;
          }
        }
        onLayer(d.id, { x: Math.round(x), y: Math.round(y), w: Math.round(Math.max(10, w)), h: Math.round(Math.max(10, h)) });
      }
    };
    const up = () => {
      drag.current = null;
      setGuides({});
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const stageRef = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={wrapRef}
      className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border bg-muted/20"
      onPointerDown={() => onSelect(null)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const files = Array.from(e.dataTransfer.files);
        if (!files.length || !stageRef.current) return;
        const r = stageRef.current.getBoundingClientRect();
        onDropFiles(files, (e.clientX - r.left) / scale, (e.clientY - r.top) / scale);
      }}
      data-testid="designer-canvas"
    >
      <div ref={stageRef} className="relative shrink-0 shadow-lg ring-1 ring-border" style={{ ...CHECKER, width: W * scale, height: H * scale }}>
        {client && <iframe ref={frame} title="preview" src={client.alertPreviewUrl()} className="pointer-events-none absolute inset-0 size-full border-0" />}
        {!playing && !design.customEnabled && (
          <div className="absolute inset-0">
            {design.layers.map((l) =>
              l.visible ? (
                <div
                  key={l.id}
                  onPointerDown={(e) => down(e, l, null)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    onEditLayer(l.id);
                  }}
                  className={cn("group/layer absolute", l.locked ? "cursor-default" : "cursor-move", selected === l.id ? "outline-2 outline-primary" : "outline-1 outline-dashed outline-white/20 hover:outline-primary/80", l.kind === "particles" && selected !== l.id && "pointer-events-none")}
                  style={{ left: l.x * scale, top: l.y * scale, width: l.w * scale, height: l.h * scale, transform: l.rotation ? `rotate(${l.rotation}deg)` : undefined }}
                  data-testid={`designer-layer-${l.name || l.kind}`}
                >
                  {(l.kind === "image" || l.kind === "video") && !l.src && (
                    <div className="pointer-events-none flex size-full flex-col items-center justify-center gap-1 overflow-hidden rounded-sm border border-dashed border-white/30 bg-white/5 p-1 text-center text-[11px] text-white/70">
                      {l.kind === "video" ? <Film className="size-5 shrink-0" /> : <ImageIcon className="size-5 shrink-0" />}
                      {t.designer.emptyMedia}
                    </div>
                  )}
                  {selected !== l.id && (
                    <span className="pointer-events-none absolute -top-5 left-0 hidden rounded-sm bg-primary px-1.5 py-px text-[10px] whitespace-nowrap text-primary-foreground group-hover/layer:block">
                      {l.name || t.designer.kinds[l.kind]}
                    </span>
                  )}
                  {selected === l.id &&
                    !l.locked &&
                    HANDLES.map(([hx, hy]) => (
                      <span
                        key={`${hx}-${hy}`}
                        onPointerDown={(e) => down(e, l, [hx, hy])}
                        className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-background"
                        style={{ left: `${hx * 100}%`, top: `${hy * 100}%`, cursor: hx === hy ? "nwse-resize" : hx + hy === 1 && hx !== 0.5 ? "nesw-resize" : hx === 0.5 ? "ns-resize" : "ew-resize" }}
                      />
                    ))}
                </div>
              ) : null,
            )}
            {guides.x !== undefined && <div className="pointer-events-none absolute top-0 bottom-0 w-px bg-pink-500" style={{ left: guides.x * scale }} />}
            {guides.y !== undefined && <div className="pointer-events-none absolute right-0 left-0 h-px bg-pink-500" style={{ top: guides.y * scale }} />}
          </div>
        )}
      </div>
    </div>
  );
}
