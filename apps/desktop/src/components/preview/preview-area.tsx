import { ArrowRight, Gauge, RectangleHorizontal, RectangleVertical, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/i18n";
import { transitionToProgram } from "@/lib/actions";
import { PREVIEW_QUALITIES, type PreviewQuality, usePrefs } from "@/lib/prefs";
import { act, baseSceneUuid, useStore } from "@/lib/store";
import { PreviewPane } from "./preview-editor";
import { ArrangeVerticalMenu } from "./vertical-tools";

/** Horizontal | Vertical switch of the main preview (only when the vertical canvas is enabled). */
function CanvasToggle() {
  const t = useT();
  const canvas = useStore((s) => s.previewCanvas);
  const setCanvas = useStore((s) => s.setPreviewCanvas);
  return (
    <ToggleGroup type="single" variant="outline" size="sm" value={canvas} onValueChange={(v) => v && setCanvas(v as "horizontal" | "vertical")} data-testid="canvas-toggle">
      <ToggleGroupItem value="horizontal" className="h-7 gap-1.5 px-2.5 text-xs" data-testid="canvas-horizontal" aria-label={t.preview.horizontal}>
        <RectangleHorizontal /> <span className="hidden sm:inline">{t.preview.horizontal}</span>
      </ToggleGroupItem>
      <ToggleGroupItem value="vertical" className="h-7 gap-1.5 px-2.5 text-xs" data-testid="canvas-vertical" aria-label={t.preview.vertical}>
        <RectangleVertical /> <span className="hidden sm:inline">{t.preview.vertical}</span>
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

const Q_KEYS: Record<PreviewQuality, ["qLow" | "qMedium" | "qHigh" | "qFull", "qLowDesc" | "qMediumDesc" | "qHighDesc" | "qFullDesc"]> = {
  low: ["qLow", "qLowDesc"],
  medium: ["qMedium", "qMediumDesc"],
  high: ["qHigh", "qHighDesc"],
  full: ["qFull", "qFullDesc"],
};

/** Preview quality picker (size and frame rate of the previews; never the stream itself). */
export function PreviewQualityMenu() {
  const t = useT();
  const p = t.preview;
  const quality = usePrefs((x) => x.previewQuality);
  const set = usePrefs((x) => x.set);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs text-muted-foreground" title={p.qualityTitle} data-testid="preview-quality">
          <Gauge />
          <span className="hidden sm:inline">{p[Q_KEYS[quality][0]]}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>{p.qualityTitle}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={quality} onValueChange={(v) => set({ previewQuality: v as PreviewQuality })}>
          {PREVIEW_QUALITIES.map((q) => (
            <DropdownMenuRadioItem key={q} value={q} className="items-start">
              <span className="flex flex-col">
                <span>{p[Q_KEYS[q][0]]}</span>
                <span className="text-xs text-muted-foreground">{p[Q_KEYS[q][1]]}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-xs text-muted-foreground">{p.qualityHint}</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const twinOf = (scenes: { uuid: string; verticalSceneUuid: string | null }[], u: string | null) => scenes.find((s) => s.uuid === u)?.verticalSceneUuid ?? null;

/** Main preview panel: the edited scene (preview scene in studio mode) on the selected canvas. */
export function PreviewPanel() {
  const t = useT();
  const verticalEnabled = useStore((s) => s.state!.video.verticalEnabled);
  const vertical = useStore((s) => s.previewCanvas === "vertical") && verticalEnabled;
  const studio = useStore((s) => s.state!.status.studioMode);
  const base = useStore((s) => baseSceneUuid(s.state!));
  const scenes = useStore((s) => s.state!.scenes);
  const setCanvas = useStore((s) => s.setCanvas);
  const scene = vertical ? twinOf(scenes, base) : base;
  const name = scenes.find((s) => s.uuid === base)?.name ?? t.preview.noScene;
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="panel-preview">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-2">
        {studio && (
          <span className="min-w-0 truncate text-xs text-muted-foreground" title={name}>
            {t.preview.preview}: <span className="font-medium text-foreground">{name}</span>
          </span>
        )}
        <span className="flex-1" />
        <PreviewQualityMenu />
        {vertical && <ArrangeVerticalMenu />}
        {verticalEnabled && <CanvasToggle />}
      </div>
      <PreviewPane
        key={vertical ? "v" : "h"}
        sceneUuid={scene}
        editable
        program={!studio}
        vertical={vertical && !studio}
        onActivate={() => setCanvas(vertical ? "vertical" : "horizontal")}
        className="h-full"
      />
    </div>
  );
}

/** Program output (studio mode) with the Transition button and quick transitions. */
export function ProgramPanel() {
  const t = useT();
  const verticalEnabled = useStore((s) => s.state!.video.verticalEnabled);
  const vertical = useStore((s) => s.previewCanvas === "vertical") && verticalEnabled;
  const studio = useStore((s) => s.state!.status.studioMode);
  const program = useStore((s) => s.state!.programSceneUuid);
  const scenes = useStore((s) => s.state!.scenes);
  const transitions = useStore((s) => s.state!.transitions);
  const quick = usePrefs((p) => p.quickTransitions);
  const showQuick = usePrefs((p) => p.studioQuickTransitions);
  const name = scenes.find((s) => s.uuid === program)?.name ?? t.preview.noScene;
  const runQuick = async (transition: string | null, ms: number) => {
    if (transition) await act((c) => c.setCurrentTransition(transition));
    await act((c) => c.setTransitionDuration(ms));
    await transitionToProgram();
  };
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="panel-program">
      <div className="flex h-9 shrink-0 items-center gap-1.5 overflow-hidden border-b px-2">
        <span className="min-w-0 shrink truncate text-xs text-muted-foreground" title={name}>
          {t.preview.program}: <span className="font-medium text-foreground">{name}</span>
        </span>
        <span className="flex-1" />
        {studio && showQuick &&
          quick.map((q) => {
            const tr = transitions.find((x) => x.uuid === q.transition) ?? transitions.find((x) => x.kind === (q.id === "q2" ? "cut_transition" : "fade_transition")) ?? transitions[0];
            if (!tr) return null;
            return (
              <Tooltip key={q.id}>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7 max-w-28 px-2 text-xs" onClick={() => runQuick(tr.uuid, q.durationMs)}>
                    <Zap />
                    <span className="hidden truncate md:inline">{tr.name}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {tr.name}
                  {tr.kind === "cut_transition" ? "" : ` · ${q.durationMs} ms`}
                </TooltipContent>
              </Tooltip>
            );
          })}
        {studio && (
          <Button size="sm" className="h-7 px-2.5 text-xs" onClick={() => transitionToProgram()} data-testid="studio-transition">
            {t.preview.transition}
            <ArrowRight />
          </Button>
        )}
      </div>
      <PreviewPane key={vertical ? "rv" : "rh"} sceneUuid={vertical ? twinOf(scenes, program) : program} editable={false} program vertical={vertical} className="h-full" />
    </div>
  );
}

/** Vertical (9:16) canvas editor, so both canvases can be shown side by side. */
export function VerticalPreviewPanel() {
  const t = useT();
  const enabled = useStore((s) => s.state!.video.verticalEnabled);
  const studio = useStore((s) => s.state!.status.studioMode);
  const base = useStore((s) => baseSceneUuid(s.state!));
  const scenes = useStore((s) => s.state!.scenes);
  const setCanvas = useStore((s) => s.setCanvas);
  if (!enabled)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center" data-testid="panel-preview-vertical">
        <RectangleVertical className="size-8 text-muted-foreground" />
        <p className="max-w-56 text-sm text-muted-foreground">{t.workspace.verticalOff}</p>
        <Button size="sm" variant="outline" onClick={() => act((c) => c.setVideo({ verticalEnabled: true }))}>
          {t.workspace.enableVertical}
        </Button>
      </div>
    );
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="panel-preview-vertical">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-2">
        <RectangleVertical className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate text-xs text-muted-foreground">9:16</span>
        <span className="flex-1" />
        <ArrangeVerticalMenu compact />
      </div>
      <PreviewPane sceneUuid={twinOf(scenes, base)} editable program={!studio} vertical={!studio} onActivate={() => setCanvas("vertical")} className="h-full" />
    </div>
  );
}
