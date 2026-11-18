import { ChevronDown, ChevronRight, Image as ImageIcon, LayoutTemplate, Maximize, Plus, RectangleHorizontal, RectangleVertical, Smartphone, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/i18n";
import { confirmDialog } from "@/lib/dialogs";
import { fmt } from "@/lib/format";
import { act, baseSceneUuid, useStore } from "@/lib/store";
import { iconForKind } from "@/lib/obs";
import { cn } from "@/lib/utils";

type Mode = "auto" | "tiktok" | "fit";
const BG_KEY = "vexcast.verticalBackground";
const readBg = () => {
  try {
    return localStorage.getItem(BG_KEY) ?? "";
  } catch {
    return "";
  }
};

/** Rebuild the 9:16 version of the current scene (or every scene) from its 16:9 layout. */
export function ArrangeVerticalMenu({ compact }: { compact?: boolean }) {
  const t = useT();
  const v = t.vertical;
  const base = useStore((s) => (s.state ? baseSceneUuid(s.state) : null));
  const sceneName = useStore((s) => s.state?.scenes.find((x) => x.uuid === base)?.name ?? "");
  const sceneIds = useStore((s) => (s.state?.scenes ?? []).map((x) => x.uuid).join(","));
  // Portrait videos/images that can fill behind a vertical scene.
  const bgKey = useStore((s) =>
    JSON.stringify((s.state?.sources ?? []).filter((x) => (x.kind === "ffmpeg_source" || x.kind === "image_source") && x.height > x.width && x.width > 0).map((x) => [x.uuid, x.name])),
  );
  const backgrounds = useMemo(() => JSON.parse(bgKey) as [string, string][], [bgKey]);
  const [bg, setBgState] = useState(readBg);
  const background = backgrounds.some(([u]) => u === bg) ? bg : "";
  const setBg = (u: string) => {
    setBgState(u);
    try {
      localStorage.setItem(BG_KEY, u);
    } catch {
      /* private mode */
    }
  };
  const setCanvas = useStore((s) => s.setCanvas);

  const arrange = async (mode: Mode, all: boolean) => {
    const ok = await confirmDialog({
      title: all ? v.confirmAllTitle : fmt(v.confirmTitle, { name: sceneName }),
      description: v.confirmDesc,
      confirmLabel: v.confirm,
    });
    if (!ok) return;
    const ids = all ? sceneIds.split(",").filter(Boolean) : base ? [base] : [];
    let done = 0;
    let items = 0;
    for (const id of ids) {
      const r = await act((c) => c.arrangeVertical(id, mode, background || undefined));
      if (r) {
        done++;
        items = r.items;
      }
    }
    if (!done) return;
    setCanvas("vertical");
    toast.success(all ? fmt(v.doneAll, { n: done }) : fmt(v.done, { n: items }));
  };

  const option = (mode: Mode, Icon: typeof Wand2, label: string, desc: string, testId?: string) => (
    <DropdownMenuItem onSelect={() => arrange(mode, false)} data-testid={testId}>
      <Icon />
      <div className="grid">
        <span>{label}</span>
        <span className="text-[11px] text-muted-foreground">{desc}</span>
      </div>
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-xs" disabled={!base} data-testid="arrange-vertical">
              <Wand2 />
              {!compact && <span className="hidden md:inline">{v.arrange}</span>}
              <ChevronDown className="size-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{v.arrangeHint}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{fmt(v.forScene, { name: sceneName })}</DropdownMenuLabel>
        {option("tiktok", Smartphone, v.arrangeTiktok, v.arrangeTiktokDesc, "arrange-tiktok")}
        {option("auto", LayoutTemplate, v.arrangeAuto, v.arrangeAutoDesc, "arrange-auto")}
        {option("fit", Maximize, v.arrangeFit, v.arrangeFitDesc)}
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <ImageIcon />
            <span className="min-w-0 flex-1 truncate">{fmt(v.background, { name: backgrounds.find(([u]) => u === background)?.[1] ?? v.noBackground })}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-64">
            <DropdownMenuRadioGroup value={background} onValueChange={setBg}>
              <DropdownMenuRadioItem value="">{v.noBackground}</DropdownMenuRadioItem>
              {backgrounds.map(([u, name]) => (
                <DropdownMenuRadioItem key={u} value={u}>
                  <span className="truncate">{name}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            {!backgrounds.length && <p className="px-2 py-1.5 text-[11px] text-muted-foreground">{v.backgroundHint}</p>}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => arrange("tiktok", true)}>
          <Wand2 />
          {v.arrangeAll}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 16:9 | 9:16 switch of the canvas the sources list and the editor work on. */
export function EditCanvasSwitch() {
  const t = useT();
  const enabled = useStore((s) => !!s.state?.video.verticalEnabled);
  const canvas = useStore((s) => s.canvas);
  const setCanvas = useStore((s) => s.setCanvas);
  const setPreviewCanvas = useStore((s) => s.setPreviewCanvas);
  if (!enabled) return null;
  return (
    <ToggleGroup
      type="single"
      size="sm"
      value={canvas}
      onValueChange={(c) => {
        if (!c) return;
        setCanvas(c as "horizontal" | "vertical");
        setPreviewCanvas(c as "horizontal" | "vertical");
      }}
      className="h-6 rounded-md border p-0.5"
      data-testid="edit-canvas-switch"
    >
      <ToggleGroupItem value="horizontal" className="h-5 min-w-0 gap-1 px-1.5 text-[10px]" aria-label={t.preview.horizontal}>
        <RectangleHorizontal className="size-3" /> 16:9
      </ToggleGroupItem>
      <ToggleGroupItem value="vertical" className="h-5 min-w-0 gap-1 px-1.5 text-[10px]" aria-label={t.preview.vertical}>
        <RectangleVertical className="size-3" /> 9:16
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

/** Sources of the horizontal scene that the vertical version doesn't show, with quick add. */
export function MissingInVertical() {
  const t = useT();
  const v = t.vertical;
  const [open, setOpen] = useState(false);
  const key = useStore((s) => {
    const st = s.state;
    if (!st || s.canvas !== "vertical" || !st.video.verticalEnabled) return "";
    const base = st.scenes.find((x) => x.uuid === baseSceneUuid(st));
    const twin = st.verticalScenes?.find((x) => x.uuid === base?.verticalSceneUuid);
    if (!base || !twin) return "";
    const have = new Set(twin.items.map((i) => i.sourceUuid));
    const miss = [...base.items].reverse().filter((i) => !have.has(i.sourceUuid));
    return JSON.stringify({ twin: twin.uuid, miss: miss.map((i) => [i.sourceUuid, i.name]) });
  });
  const kinds = useStore((s) => s.state?.sources);
  const data = useMemo(() => (key ? (JSON.parse(key) as { twin: string; miss: [string, string][] }) : null), [key]);
  if (!data || !data.miss.length) return null;

  const add = async (uuids: string[]) => {
    for (const u of uuids) {
      const item = await act((c) => c.addSourceToScene(data.twin, u));
      if (item) await act((c) => c.transformItem(data.twin, item.id, "fit"));
    }
  };

  return (
    <div className="shrink-0 border-t bg-muted/30" data-testid="missing-in-vertical">
      <div className="flex h-7 items-center gap-1 pr-1 pl-1.5">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-1 text-left text-[11px] text-muted-foreground hover:text-foreground" onClick={() => setOpen(!open)} title={v.missingHint}>
          {open ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />}
          <span className="truncate">{fmt(v.missing, { n: data.miss.length })}</span>
        </button>
        <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" onClick={() => add(data.miss.map(([u]) => u))}>
          <Plus className="size-3" /> {v.addAll}
        </Button>
      </div>
      {open && (
        <ul className="max-h-36 overflow-y-auto px-1 pb-1">
          {data.miss.map(([u, name]) => {
            const Icon = iconForKind(kinds?.find((s) => s.uuid === u)?.kind ?? "");
            return (
              <li key={u} className={cn("group flex h-7 items-center gap-2 rounded-sm px-1.5 text-xs hover:bg-accent/60")}>
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{name}</span>
                <Button variant="ghost" size="icon-sm" className="size-6" aria-label={v.add} title={v.add} onClick={() => add([u])}>
                  <Plus className="size-3.5" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
