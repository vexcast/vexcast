import { HealthIndicator } from "./health-indicator";
import type { Destination, OutputStatus } from "@vexcast/protocol";
import { Coffee, FolderOpen, Pause, Play, Scissors, Square, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { useT } from "@/i18n";
import { showRecordings, toggleRecording } from "@/lib/actions";
import { openDialog } from "@/lib/dialogs";
import { KOFI_URL, openExternal } from "@/lib/tauri";
import { act, EMPTY, useAppState, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

function useNow(active: boolean) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [active]);
}

const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
};

const pct = (dropped: number, total: number) => (total ? (dropped / total) * 100 : 0);

/** Amber above 1 %, red above 5 % dropped frames. */
const droppedClass = (p: number) => (p > 5 ? "text-red-500" : p > 1 ? "text-amber-500" : undefined);

const stateDot = (state: OutputStatus["state"]) =>
  state === "active" ? "bg-emerald-500" : state === "error" ? "bg-red-500" : state === "idle" ? "bg-muted-foreground/40" : "bg-amber-400";

const triggerClass = "flex h-5 items-center gap-1.5 rounded-sm px-1.5 font-mono tabular-nums outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:bg-accent data-[state=open]:text-accent-foreground";

/** Per-destination stream status (LIVE popover). */
function StreamDetails({ destinations, outputs, live }: { destinations: Destination[]; outputs: OutputStatus[]; live: number }) {
  const t = useT();
  const streaming = useAppState((s) => s.status.streaming);
  const rows = destinations.filter((d) => d.enabled || outputs.some((o) => o.id === d.id && o.state !== "idle"));
  return (
    <div className="flex flex-col gap-3" data-testid="status-live-details">
      <div className="flex items-center gap-2">
        <span className={cn("size-2 rounded-full", streaming ? "bg-red-500" : "bg-muted-foreground/40")} />
        <span className="text-sm font-medium">{t.statusDetails.streamTitle}</span>
        <span className="ml-auto font-mono text-sm tabular-nums">{fmtClock(live)}</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.statusDetails.noActive}</p>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr className="border-b">
              <th className="pb-1.5 text-left font-medium">{t.statusDetails.destination}</th>
              <th className="pb-1.5 pl-3 text-right font-medium">{t.statusDetails.bitrate}</th>
              <th className="pb-1.5 pl-3 text-right font-medium">{t.statusDetails.dropped}</th>
              <th className="pb-1.5 pl-3 text-right font-medium">{t.statusDetails.duration}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const o = outputs.find((x) => x.id === d.id);
              const state = o?.state ?? "idle";
              const p = o ? pct(o.droppedFrames, o.totalFrames) : 0;
              const active = !!o && state !== "idle";
              return (
                <tr key={d.id} className="border-b last:border-0">
                  <td className="max-w-40 py-1.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={cn("size-2 shrink-0 rounded-full", stateDot(state))} title={t.stats.states[state]} />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{d.name}</p>
                        <p className={cn("truncate text-[11px]", o?.error ? "text-destructive" : "text-muted-foreground")} title={o?.error ?? undefined}>
                          {o?.error ?? `${d.service} · ${t.stats.states[state]}`}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="py-1.5 pl-3 text-right font-mono tabular-nums">{active ? Math.round(o.kbps) : "—"}</td>
                  <td className={cn("py-1.5 pl-3 text-right font-mono whitespace-nowrap tabular-nums", active && droppedClass(p))}>
                    {active ? `${o.droppedFrames} (${p.toFixed(1)}%)` : "—"}
                  </td>
                  <td className="py-1.5 pl-3 text-right font-mono tabular-nums">{active ? fmtClock(o.durationMs) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <Button variant="outline" size="sm" onClick={() => openDialog("settings", "stream")}>
        {t.statusDetails.manage}
      </Button>
    </div>
  );
}

/** Recording details and controls (REC popover). */
function RecordingDetails({ rec }: { rec: number }) {
  const t = useT();
  const status = useAppState((s) => s.status);
  const recordingPath = useAppState((s) => s.output.recordingPath);
  const path = status.lastRecordingPath ?? recordingPath;
  return (
    <div className="flex flex-col gap-3" data-testid="status-rec-details">
      <div className="flex items-center gap-2">
        <span className={cn("size-2 rounded-full", status.recording ? (status.recordingPaused ? "bg-amber-400" : "bg-red-500") : "bg-muted-foreground/40")} />
        <span className="text-sm font-medium">{t.statusDetails.recTitle}</span>
        <span className="text-xs text-muted-foreground">
          {status.recording ? (status.recordingPaused ? t.statusDetails.paused : t.statusDetails.recording) : t.statusDetails.notRecording}
        </span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-muted-foreground">{t.statusDetails.elapsed}</dt>
        <dd className="text-right font-mono tabular-nums">{fmtClock(rec)}</dd>
        <dt className="text-muted-foreground">{t.statusDetails.path}</dt>
        <dd className="min-w-0 truncate text-right font-mono" title={path} dir="rtl">
          <bdi>{path}</bdi>
        </dd>
      </dl>
      {status.recording ? (
        <div className="grid grid-cols-3 gap-1.5">
          <Button variant="outline" size="sm" onClick={() => act((c) => c.pauseRecording(!status.recordingPaused))}>
            {status.recordingPaused ? <Play /> : <Pause />}
            {status.recordingPaused ? t.statusDetails.resume : t.statusDetails.pause}
          </Button>
          <Button variant="outline" size="sm" onClick={() => act((c) => c.splitRecording())}>
            <Scissors />
            {t.statusDetails.split}
          </Button>
          <Button variant="destructive" size="sm" onClick={() => toggleRecording()}>
            <Square />
            {t.statusDetails.stop}
          </Button>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => toggleRecording()}>
          {t.statusDetails.start}
        </Button>
      )}
      <Button variant="ghost" size="sm" className="justify-start" onClick={() => showRecordings()}>
        <FolderOpen />
        {t.statusDetails.showRecordings}
      </Button>
    </div>
  );
}

/** OBS-like status bar: LIVE/REC timers (with detail popovers), CPU, FPS, dropped frames, bitrate. */
export function StatusBar() {
  const t = useT();
  const status = useAppState((s) => s.status);
  const destinations = useAppState((s) => s.destinations);
  const outputs = useStore((s) => s.stats?.outputs ?? EMPTY) as OutputStatus[];
  const stats = useStore((s) => s.stats);
  const connected = useStore((s) => s.connected);
  const clockOffset = useStore((s) => s.clockOffset);
  useNow(status.streaming || status.recording);
  const now = Date.now() + clockOffset;
  const live = status.streaming && status.streamStartedAt ? now - status.streamStartedAt : 0;
  const rec = status.recording && status.recordingStartedAt ? now - status.recordingStartedAt : 0;
  const streamOutputs = outputs.filter((o) => destinations.some((d) => d.id === o.id) && o.state !== "idle");
  const dropped = streamOutputs.reduce((a, o) => a + o.droppedFrames, 0);
  const total = streamOutputs.reduce((a, o) => a + o.totalFrames, 0);
  const droppedPct = pct(dropped, total);
  const kbps = streamOutputs.reduce((a, o) => a + o.kbps, 0);

  return (
    <footer className="flex h-7 shrink-0 items-center gap-2 overflow-hidden border-t bg-background px-2 text-[11px] whitespace-nowrap text-muted-foreground" data-testid="status-bar">
      {!connected && (
        <span className="flex items-center gap-1.5 text-destructive">
          <WifiOff className="size-3.5" /> {t.status.disconnected}
        </span>
      )}
      <span className="flex-1" />
      {status.streaming && streamOutputs.length > 0 && (
        <>
          <span title={t.status.dropped} className={cn("font-mono tabular-nums", droppedClass(droppedPct))} data-testid="status-dropped">
            <span className="hidden lg:inline">{t.status.dropped}: </span>
            {dropped} ({droppedPct.toFixed(1)}%)
          </span>
          <span className="font-mono tabular-nums" title={streamOutputs.map((o) => `${destinations.find((d) => d.id === o.id)?.name ?? o.id}: ${Math.round(o.kbps)} kb/s`).join("\n")}>
            {Math.round(kbps)} kb/s
          </span>
          <Separator orientation="vertical" className="!h-3.5" />
        </>
      )}
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className={cn(triggerClass, status.streaming && "text-foreground")} title={t.statusDetails.clickForDetails} data-testid="status-live">
            <span className={cn("size-2 rounded-full", status.streaming ? "bg-red-500" : "bg-muted-foreground/40")} />
            {status.rehearsal ? t.rehearsal.label : t.status.live}: {fmtClock(live)}
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="end" className="w-[26rem] max-w-[calc(100vw-1rem)] p-3">
          <StreamDetails destinations={destinations} outputs={outputs} live={live} />
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className={cn(triggerClass, status.recording && "text-foreground")} title={t.statusDetails.clickForDetails} data-testid="status-rec">
            <span className={cn("size-2 rounded-full", status.recording ? (status.recordingPaused ? "bg-amber-400" : "bg-red-500") : "bg-muted-foreground/40")} />
            {status.recordingPaused ? t.status.paused : t.status.rec}: {fmtClock(rec)}
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="end" className="w-80 max-w-[calc(100vw-1rem)] p-3">
          <RecordingDetails rec={rec} />
        </PopoverContent>
      </Popover>
      <Separator orientation="vertical" className="!h-3.5" />
      <HealthIndicator />
      <Separator orientation="vertical" className="!h-3.5" />
      <span className={cn("font-mono tabular-nums", stats && stats.cpu > 80 && "text-amber-500")} data-testid="status-cpu">
        {t.status.cpu}: {stats ? stats.cpu.toFixed(1) : "—"}%
      </span>
      <span className="font-mono tabular-nums">
        {stats ? `${stats.fps.toFixed(2)} / ${stats.targetFps.toFixed(2)}` : "—"} {t.status.fps}
      </span>
      <Separator orientation="vertical" className="!h-3.5" />
      <button className="flex items-center gap-1 hover:text-foreground" onClick={() => openExternal(KOFI_URL)} title={t.status.support}>
        <Coffee className="size-3.5" /> <span className="hidden md:inline">{t.status.support}</span>
      </button>
    </footer>
  );
}
