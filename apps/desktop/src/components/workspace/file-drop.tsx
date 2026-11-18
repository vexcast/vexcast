/**
 * Drag & drop of files/URLs onto the Studio workspace: images → Image,
 * video/audio → Media Source, .html/URLs → Browser. Files are uploaded to the
 * core first (the webview gives no file paths). Dropped on a preview, the new
 * item is placed at the drop position.
 */
import { FilePlus2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { getT, useT } from "@/i18n";
import { fmt } from "@/lib/format";
import { act, api, canvasSize, editingSceneUuid, errorMessage, findScene, flattenItems, useStore } from "@/lib/store";

const IMAGE = ["png", "jpg", "jpeg", "gif", "bmp", "webp", "tga", "psd", "jxr", "apng"];
const MEDIA = ["mp4", "mkv", "mov", "webm", "avi", "flv", "ts", "m4v", "mp3", "wav", "ogg", "flac", "m4a", "aac", "opus"];
const HTML = ["html", "htm"];

type Plan = { kind: string; settings: (path: string) => Record<string, unknown> };

export function planFor(name: string): Plan | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (IMAGE.includes(ext)) return { kind: "image_source", settings: (p) => ({ file: p }) };
  if (MEDIA.includes(ext)) return { kind: "ffmpeg_source", settings: (p) => ({ is_local_file: true, local_file: p }) };
  if (HTML.includes(ext)) return { kind: "browser_source", settings: (p) => ({ is_local_file: true, local_file: p, width: 1920, height: 1080 }) };
  return null;
}

function uniqueName(base: string) {
  const s = useStore.getState().state!;
  const taken = new Set([...s.sources.map((x) => x.name), ...s.scenes.map((x) => x.name)]);
  let n = base;
  for (let i = 2; taken.has(n); i++) n = `${base} ${i}`;
  return n;
}

/** Create a source in the edited scene and optionally move its item to a canvas point. */
async function create(name: string, kind: string, settings: Record<string, unknown>, at: { x: number; y: number } | null) {
  const sceneUuid = editingSceneUuid(useStore.getState().state!);
  if (!sceneUuid) return;
  const src = await act((c) => c.createSource({ name: uniqueName(name), kind, settings, sceneUuid }));
  if (!src) return;
  toast.success(fmt(getT().workspace.dropAdded, { name: src.name }));
  if (!at) return;
  const st = await api().getState();
  const item = flattenItems(findScene(st, sceneUuid)?.items ?? []).filter((i) => i.sourceUuid === src.uuid).pop();
  if (item) await act((c) => c.updateItem(sceneUuid, item.id, { pos: at, alignment: 5 }));
}

/** Canvas point under the cursor when it is over a preview stage. */
function canvasPoint(e: React.DragEvent): { x: number; y: number } | null {
  const stage = (document.elementsFromPoint(e.clientX, e.clientY) as HTMLElement[]).find((el) => el.dataset.testid === "preview-stage");
  if (!stage) return null;
  const st = useStore.getState().state!;
  const { w } = canvasSize(st, editingSceneUuid(st));
  const r = stage.getBoundingClientRect();
  const k = r.width / w;
  return { x: Math.round((e.clientX - r.left) / k), y: Math.round((e.clientY - r.top) / k) };
}

export function useFileDrop() {
  const t = useT();
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const accepts = (e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer.types);
    return types.includes("Files") || types.includes("text/uri-list");
  };
  const handlers = {
    onDragEnter: (e: React.DragEvent) => {
      if (!accepts(e)) return;
      depth.current++;
      setOver(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!accepts(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setOver(false);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!accepts(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    onDrop: async (e: React.DragEvent) => {
      if (!accepts(e)) return;
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      const at = canvasPoint(e);
      const files = Array.from(e.dataTransfer.files);
      if (!files.length) {
        const url = (e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain")).split("\n").find((l) => /^https?:\/\//.test(l.trim()));
        if (url) await create(new URL(url.trim()).hostname, "browser_source", { url: url.trim(), width: 1920, height: 1080 }, at);
        return;
      }
      for (const [i, f] of files.entries()) {
        const plan = planFor(f.name);
        if (!plan) {
          toast.error(fmt(t.workspace.dropUnsupported, { name: f.name }));
          continue;
        }
        try {
          const { path } = await api().uploadFile(f, f.name);
          const base = f.name.replace(/\.[^.]+$/, "");
          await create(base, plan.kind, plan.settings(path), at ? { x: at.x + i * 40, y: at.y + i * 40 } : null);
        } catch (err) {
          toast.error(errorMessage(err));
        }
      }
    },
  };
  const overlay = over ? (
    <div className="pointer-events-none absolute inset-2 z-50 grid place-items-center rounded-lg border-2 border-dashed border-primary/60 bg-background/70" data-testid="drop-overlay">
      <div className="flex items-center gap-2 rounded-md bg-popover px-3 py-2 text-sm shadow-sm ring-1 ring-border">
        <FilePlus2 className="size-4" /> {t.workspace.dropHint}
      </div>
    </div>
  ) : null;
  return { handlers, overlay };
}
