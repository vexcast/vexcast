import { EMPTY } from "@/lib/store";
import { Camera, ChevronDown, Circle, Columns2, History, LogOut, Pause, PenLine, Play, Radio, Save, Scissors, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/i18n";
import { exitVexcast, toggleRecording, toggleReplayBuffer, toggleStreaming, toggleStudioMode, toggleVirtualCam } from "@/lib/actions";
import { openDialog } from "@/lib/dialogs";
import { act, useAppState, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Dock } from "./dock";

export function DestinationsList() {
  const t = useT();
  const destinations = useAppState((s) => s.destinations);
  const outputs = useStore((s) => s.stats?.outputs ?? EMPTY);
  const enabled = destinations.filter((d) => d.enabled);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">{t.controls.destinations}</p>
      {enabled.length === 0 && <p className="text-sm text-muted-foreground">{t.controls.noDestinations}</p>}
      {enabled.map((d) => {
        const o = outputs.find((x) => x.id === d.id);
        const state = o?.state ?? "idle";
        return (
          <div key={d.id} className="flex items-center gap-2 text-sm">
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                state === "active" ? "bg-emerald-500" : state === "error" ? "bg-red-500" : state === "idle" ? "bg-muted-foreground/40" : "bg-amber-400",
              )}
            />
            <span className="min-w-0 flex-1 truncate">{d.name}</span>
            <span className="text-xs text-muted-foreground">{d.service}</span>
            {o && state === "active" && <span className="font-mono text-xs tabular-nums">{Math.round(o.kbps)} kb/s</span>}
            {o?.error && <span className="truncate text-xs text-destructive">{o.error}</span>}
          </div>
        );
      })}
      <Button variant="outline" size="sm" className="mt-1" onClick={() => openDialog("settings", "stream")}>
        {t.controls.manageDestinations}
      </Button>
    </div>
  );
}

export function ControlsDock() {
  const t = useT();
  const status = useAppState((s) => s.status);
  const enabledCount = useAppState((s) => s.destinations.filter((d) => d.enabled).length);
  const outputs = useStore((s) => s.stats?.outputs ?? EMPTY);
  const hasAccounts = useStore((s) => s.state?.accounts?.some((a) => a.connected && a.platform !== "youtube") ?? false);
  const connecting = status.streaming && outputs.some((o) => o.state === "starting" || o.state === "reconnecting");

  const side = (icon: React.ReactNode, label: string, onClick: () => void, disabled = false, testId?: string) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" size="icon" className="shrink-0" onClick={onClick} disabled={disabled} aria-label={label} data-testid={testId}>
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );

  /** Icon + label; label hides (tooltip instead) when the dock is narrow. */
  const main = (icon: React.ReactNode, label: string, onClick: () => void, props: React.ComponentProps<typeof Button> = {}) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" className="min-w-0 flex-1 justify-center gap-2 px-2" onClick={onClick} aria-label={label} {...props}>
          {icon}
          <span className="hidden truncate @[12rem]:inline">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent className="@[12rem]:hidden">{label}</TooltipContent>
    </Tooltip>
  );

  const streamLabel = status.streaming ? (connecting ? t.controls.starting : status.rehearsal ? t.rehearsal.stop : t.controls.stopStreaming) : t.controls.startStreaming;
  return (
    <Dock title={t.docks.controls} testId="dock-controls">
      <ScrollArea className="h-full">
        <div className="@container flex flex-col gap-1.5 p-2">
          <div className="flex gap-1.5">
            {main(<Radio />, streamLabel, () => toggleStreaming(), { variant: status.streaming ? "destructive" : "default", "data-testid": "btn-stream" } as React.ComponentProps<typeof Button>)}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="shrink-0 gap-1 px-2" aria-label={t.controls.destinations}>
                  <span className="text-xs tabular-nums">{enabledCount}</span>
                  <ChevronDown />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80">
                <DestinationsList />
              </PopoverContent>
            </Popover>
          </div>
          {hasAccounts && <div className="flex">{main(<PenLine />, t.accounts.info.open, () => openDialog("streamInfo", true), { "data-testid": "btn-stream-info" } as React.ComponentProps<typeof Button>)}</div>}
          <div className="flex gap-1.5">
            {main(<Circle className={status.recording ? "fill-current" : undefined} />, status.recording ? t.controls.stopRecording : t.controls.startRecording, () => toggleRecording(), {
              variant: status.recording ? "destructive" : "outline",
              "data-testid": "btn-record",
            } as React.ComponentProps<typeof Button>)}
            {status.recording && side(status.recordingPaused ? <Play /> : <Pause />, status.recordingPaused ? t.controls.resume : t.controls.pause, () => act((c) => c.pauseRecording(!status.recordingPaused)))}
            {status.recording && side(<Scissors />, t.controls.split, () => act((c) => c.splitRecording()))}
          </div>
          <div className="flex gap-1.5">
            {main(<History />, status.replayBufferActive ? t.controls.stopReplay : t.controls.startReplay, () => toggleReplayBuffer(), { "data-active": status.replayBufferActive || undefined } as React.ComponentProps<typeof Button>)}
            {status.replayBufferActive && side(<Save />, t.controls.saveReplay, () => act((c) => c.saveReplay()))}
          </div>
          <div className="flex">{main(<Camera />, status.virtualCamActive ? t.controls.stopVirtualCam : t.controls.startVirtualCam, () => toggleVirtualCam())}</div>
          <div className="flex">
            {main(<Columns2 />, t.controls.studioMode, () => toggleStudioMode(), { variant: status.studioMode ? "secondary" : "outline", "aria-pressed": status.studioMode, "data-testid": "btn-studio" } as React.ComponentProps<typeof Button>)}
          </div>
          <div className="flex gap-1.5">
            {main(<Settings />, t.controls.settings, () => openDialog("settings", "general"), { "data-testid": "btn-settings" } as React.ComponentProps<typeof Button>)}
            {main(<LogOut />, t.controls.exit, () => exitVexcast())}
          </div>
        </div>
      </ScrollArea>
    </Dock>
  );
}
