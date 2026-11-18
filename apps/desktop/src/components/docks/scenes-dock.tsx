import type { SceneInfo, Uuid } from "@vexcast/protocol";
import { ArrowDown, ArrowUp, Copy, Filter, Image, LayoutGrid, List, Minus, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MenuItems, type MenuNode, sep } from "@/components/menu";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useT } from "@/i18n";
import { activateScene, addScene, duplicateScene, moveScene, removeScene, transitionToProgram } from "@/lib/actions";
import { openDialog } from "@/lib/dialogs";
import { usePrefs } from "@/lib/prefs";
import { act, useAppState, useStore } from "@/lib/store";
import { useReorder } from "@/lib/useReorder";
import { cn } from "@/lib/utils";
import { Dock, InlineRename, ToolButton } from "./dock";

type View = "list" | "grid";
const VIEW_KEY = "vexcast.scenesView";
const THUMBS_KEY = "vexcast.scenesThumbs";

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocal(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/** A local UI setting persisted in localStorage. */
function useLocal<T extends string>(key: string, parse: (v: string | null) => T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => parse(readLocal(key)));
  return [
    v,
    (next: T) => {
      setV(next);
      writeLocal(key, next);
    },
  ];
}

// ------------------------------------------------------------------ live thumbnails

/**
 * Thumbnails are polled JPEG snapshots (~every 2 s) instead of one MJPEG stream per
 * scene: long-lived streams would each hold one of the browser's ~6 connections to
 * the core and starve the main preview and API calls with many scenes. A small
 * global limiter keeps at most two snapshot requests in flight.
 */
const MAX_INFLIGHT = 2;
let inflight = 0;
const waiting: (() => void)[] = [];
function acquire(): Promise<void> {
  if (inflight < MAX_INFLIGHT) {
    inflight++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
}
function release() {
  const next = waiting.shift();
  if (next) next();
  else inflight--;
}

function SceneThumb({ uuid }: { uuid: Uuid }) {
  const client = useStore((s) => s.client);
  const ref = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    let alive = true;
    let visible = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let busy = false;
    const io = new IntersectionObserver(([e]) => {
      const was = visible;
      visible = e.isIntersecting;
      if (visible && !was && !timer && !busy) loop();
    });
    if (ref.current) io.observe(ref.current);

    const loop = async () => {
      timer = null;
      if (!alive || !visible) return;
      busy = true;
      await acquire();
      const url = `${client.previewUrl({ scene: uuid, fps: 2 }).replace("/preview.mjpeg", "/preview.jpg")}&t=${Date.now()}`;
      const img = new window.Image();
      img.onload = img.onerror = () => {
        release();
        busy = false;
        if (!alive) return;
        if (img.naturalWidth > 0) setSrc(url);
        timer = setTimeout(loop, 2000);
      };
      img.src = url;
    };

    return () => {
      alive = false;
      io.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [client, uuid]);

  return (
    <div ref={ref} className="absolute inset-0">
      {src && <img src={src} alt="" draggable={false} className="size-full object-contain" />}
    </div>
  );
}

// ------------------------------------------------------------------ dock

export function ScenesDock() {
  const t = useT();
  const scenes = useAppState((s) => s.scenes);
  const program = useAppState((s) => s.programSceneUuid);
  const preview = useAppState((s) => s.previewSceneUuid);
  const studio = useAppState((s) => s.status.studioMode);
  const dblClick = usePrefs((p) => p.studioDoubleClick);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [view, setView] = useLocal<View>(VIEW_KEY, (v) => (v === "grid" ? "grid" : "list"));
  const [thumbs, setThumbs] = useLocal<"on" | "off">(THUMBS_KEY, (v) => (v === "on" ? "on" : "off"));
  const current = studio ? preview : program;
  const currentScene = scenes.find((s) => s.uuid === current) ?? null;
  const { rowProps, indicator } = useReorder(
    scenes.map((s) => s.uuid),
    (ids) => act((c) => c.reorderScenes(ids)),
  );
  const grid = view === "grid";

  const menu = (scene: SceneInfo | null): MenuNode[] => [
    { type: "item", label: t.scenes.add, icon: Plus, onSelect: addScene },
    ...(scene
      ? ([
          sep,
          { type: "item", label: t.scenes.duplicate, icon: Copy, onSelect: () => duplicateScene(scene) },
          { type: "item", label: t.scenes.rename, icon: Pencil, onSelect: () => setRenaming(scene.uuid), shortcut: "F2" },
          { type: "item", label: t.common.delete, icon: Trash2, destructive: true, onSelect: () => removeScene(scene), shortcut: "Supr" },
          sep,
          {
            type: "sub",
            label: t.scenes.order,
            children: [
              { type: "item", label: t.scenes.moveUp, icon: ArrowUp, onSelect: () => moveScene(scene, "up") },
              { type: "item", label: t.scenes.moveDown, icon: ArrowDown, onSelect: () => moveScene(scene, "down") },
              sep,
              { type: "item", label: t.scenes.moveTop, onSelect: () => moveScene(scene, "top") },
              { type: "item", label: t.scenes.moveBottom, onSelect: () => moveScene(scene, "bottom") },
            ],
          },
          sep,
          { type: "item", label: t.scenes.filters, icon: Filter, onSelect: () => openDialog("filters", scene.uuid) },
          ...(studio ? [sep, { type: "item", label: t.scenes.transitionTo, onSelect: () => act((c) => c.setPreviewScene(scene.uuid)).then(() => transitionToProgram()) } as MenuNode] : []),
        ] as MenuNode[])
      : []),
  ];

  /** Shared interaction props for a scene row/card. */
  const entryProps = (scene: SceneInfo) => {
    const drag = rowProps(scene.uuid);
    return {
      ...drag,
      // The grid flows horizontally: decide before/after from X, mapped onto the hook's Y test.
      onDragOver: grid
        ? (e: React.DragEvent) => {
            const r = e.currentTarget.getBoundingClientRect();
            const after = e.clientX > r.left + r.width / 2;
            drag.onDragOver({ preventDefault: () => e.preventDefault(), currentTarget: e.currentTarget, clientY: after ? r.bottom : r.top } as unknown as React.DragEvent);
          }
        : drag.onDragOver,
      role: "option" as const,
      "aria-selected": scene.uuid === current,
      "data-testid": `scene-${scene.name}`,
      tabIndex: 0,
      onClick: () => activateScene(scene.uuid),
      onContextMenu: (e: React.MouseEvent) => e.stopPropagation(),
      onDoubleClick: () => (studio && dblClick ? act((c) => c.setPreviewScene(scene.uuid)).then(() => transitionToProgram()) : setRenaming(scene.uuid)),
      onKeyDown: (e: React.KeyboardEvent) => e.key === "F2" && setRenaming(scene.uuid),
    };
  };

  const nameOrRename = (scene: SceneInfo) =>
    renaming === scene.uuid ? (
      <InlineRename
        value={scene.name}
        onDone={(v) => {
          setRenaming(null);
          if (v && v !== scene.name) act((c) => c.renameScene(scene.uuid, v));
        }}
      />
    ) : (
      <span className="truncate" title={scene.name}>
        {scene.name}
      </span>
    );

  const withMenu = (scene: SceneInfo, node: React.ReactElement) => (
    <ContextMenu key={scene.uuid}>
      <ContextMenuTrigger asChild>{node}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <MenuItems nodes={menu(scene)} kind="context" />
      </ContextMenuContent>
    </ContextMenu>
  );

  const listRow = (scene: SceneInfo) => {
    const ind = indicator(scene.uuid);
    const isCurrent = scene.uuid === current;
    const isProgram = studio && scene.uuid === program;
    return withMenu(
      scene,
      <li
        {...entryProps(scene)}
        className={cn(
          "relative flex h-7 cursor-default items-center gap-2 rounded-sm px-2 text-sm outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50",
          isCurrent && "bg-accent font-medium text-accent-foreground hover:bg-accent",
          ind === "before" && "before:absolute before:inset-x-1 before:-top-px before:h-0.5 before:bg-primary",
          ind === "after" && "after:absolute after:inset-x-1 after:-bottom-px after:h-0.5 after:bg-primary",
        )}
      >
        {nameOrRename(scene)}
        {isProgram && <span className="ml-auto size-1.5 shrink-0 rounded-full bg-red-500" title={t.scenesView.program} />}
      </li>,
    );
  };

  const gridCard = (scene: SceneInfo) => {
    const ind = indicator(scene.uuid);
    const isCurrent = scene.uuid === current;
    const isProgram = studio && scene.uuid === program;
    return withMenu(
      scene,
      <li
        {...entryProps(scene)}
        className={cn(
          "group relative flex min-w-0 cursor-default flex-col gap-1 rounded-md p-1 outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/50",
          ind === "before" && "before:absolute before:inset-y-1 before:-left-[3px] before:w-0.5 before:bg-primary",
          ind === "after" && "after:absolute after:inset-y-1 after:-right-[3px] after:w-0.5 after:bg-primary",
        )}
      >
        <div
          className={cn(
            "relative aspect-video overflow-hidden rounded-sm border bg-muted",
            isCurrent && "border-primary ring-2 ring-primary",
          )}
        >
          {thumbs === "on" ? (
            <SceneThumb uuid={scene.uuid} />
          ) : (
            <span className="absolute inset-0 grid place-items-center text-lg font-semibold text-muted-foreground/60 uppercase select-none">{scene.name.trim().charAt(0) || "?"}</span>
          )}
          {isProgram && <span className="absolute top-1 right-1 size-2 rounded-full bg-red-500 ring-2 ring-background" title={t.scenesView.program} />}
        </div>
        <div className={cn("flex h-6 min-w-0 items-center px-0.5 text-xs", isCurrent ? "font-medium text-foreground" : "text-muted-foreground")}>{nameOrRename(scene)}</div>
      </li>,
    );
  };

  return (
    <Dock
      title={t.docks.scenes}
      testId="dock-scenes"
      actions={
        <>
          {grid && (
            <ToolButton
              icon={Image}
              label={t.scenesView.liveThumbs}
              active={thumbs === "on"}
              aria-pressed={thumbs === "on"}
              onClick={() => setThumbs(thumbs === "on" ? "off" : "on")}
              className="size-6"
              testId="scenes-thumbs"
            />
          )}
          <ToolButton
            icon={grid ? List : LayoutGrid}
            label={grid ? t.scenesView.list : t.scenesView.grid}
            onClick={() => setView(grid ? "list" : "grid")}
            className="size-6"
            testId="scenes-view"
          />
        </>
      }
      toolbar={
        <>
          <ToolButton icon={Plus} label={t.scenes.add} onClick={addScene} testId="scene-add" />
          <ToolButton icon={Minus} label={t.scenes.remove} disabled={!currentScene} onClick={() => currentScene && removeScene(currentScene)} />
          <ToolButton icon={Filter} label={t.scenes.filters} disabled={!currentScene} onClick={() => currentScene && openDialog("filters", currentScene.uuid)} />
          <span className="flex-1" />
          <ToolButton icon={ArrowUp} label={t.scenes.moveUp} disabled={!currentScene} onClick={() => currentScene && moveScene(currentScene, "up")} />
          <ToolButton icon={ArrowDown} label={t.scenes.moveDown} disabled={!currentScene} onClick={() => currentScene && moveScene(currentScene, "down")} />
        </>
      }
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <ScrollArea className="h-full">
            {grid ? (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-1.5 p-1.5" role="listbox" data-testid="scenes-grid">
                {scenes.map(gridCard)}
              </ul>
            ) : (
              <ul className="flex flex-col gap-px p-1" role="listbox">
                {scenes.map(listRow)}
              </ul>
            )}
          </ScrollArea>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-52">
          <MenuItems nodes={menu(null)} kind="context" />
        </ContextMenuContent>
      </ContextMenu>
    </Dock>
  );
}
