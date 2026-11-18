import type { OutputStatus } from "@vexcast/protocol";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useT } from "@/i18n";
import { useAppState, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Dock } from "./dock";

export function StatsView() {
  const t = useT();
  const stats = useStore((s) => s.stats);
  const destinations = useAppState((s) => s.destinations);
  const outName = (o: OutputStatus) =>
    o.id === "record" ? t.stats.recording : o.id === "replay" ? t.stats.replay : o.id === "virtualcam" ? t.stats.virtualcam : (destinations.find((d) => d.id === o.id)?.name ?? o.id);
  const pctOf = (a: number, b: number) => (b > 0 ? ((a / b) * 100).toFixed(1) : "0.0");
  const rows: [string, string, boolean?][] = stats
    ? [
        [t.stats.fps, `${stats.fps.toFixed(2)} / ${stats.targetFps.toFixed(2)}`, stats.fps < stats.targetFps * 0.95],
        [t.stats.cpu, `${stats.cpu.toFixed(1)}%`, stats.cpu > 80],
        [t.stats.memory, `${stats.memoryMb.toFixed(1)} MB`],
        [t.stats.disk, stats.diskFreeGb == null ? "—" : `${stats.diskFreeGb.toFixed(1)} GB`],
        [t.stats.renderTime, `${stats.averageRenderMs.toFixed(1)} ms`],
        [t.stats.missed, `${stats.renderSkipped} / ${stats.renderTotal} (${pctOf(stats.renderSkipped, stats.renderTotal)}%)`, stats.renderSkipped > 0],
        [t.stats.skipped, `${stats.encodingSkipped} / ${stats.encodingTotal} (${pctOf(stats.encodingSkipped, stats.encodingTotal)}%)`, stats.encodingSkipped > 0],
      ]
    : [];
  return (
    <div className="flex flex-col gap-3 p-2.5 text-xs">
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5">
        {rows.map(([k, v, warn]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className={cn("text-right font-mono tabular-nums", warn && "text-amber-500")}>{v}</dd>
          </div>
        ))}
      </dl>
      <Table className="text-xs">
        <TableHeader>
          <TableRow>
            <TableHead className="h-7">{t.stats.output}</TableHead>
            <TableHead className="h-7">{t.stats.state}</TableHead>
            <TableHead className="h-7 text-right">{t.stats.dropped}</TableHead>
            <TableHead className="h-7 text-right">{t.stats.bitrate}</TableHead>
            <TableHead className="h-7 text-right">{t.stats.total}</TableHead>
            <TableHead className="h-7 text-right">{t.stats.congestion}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(stats?.outputs ?? []).length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="py-3 text-center text-muted-foreground">
                {t.stats.noOutputs}
              </TableCell>
            </TableRow>
          )}
          {(stats?.outputs ?? []).map((o) => (
            <TableRow key={o.id}>
              <TableCell className="py-1.5 font-medium">{outName(o)}</TableCell>
              <TableCell className={cn("py-1.5", o.state === "error" && "text-destructive", o.state === "reconnecting" && "text-amber-500")}>{t.stats.states[o.state]}</TableCell>
              <TableCell className="py-1.5 text-right font-mono tabular-nums">
                {o.droppedFrames} / {o.totalFrames} ({pctOf(o.droppedFrames, o.totalFrames)}%)
              </TableCell>
              <TableCell className="py-1.5 text-right font-mono tabular-nums">{Math.round(o.kbps)} kb/s</TableCell>
              <TableCell className="py-1.5 text-right font-mono tabular-nums">{(o.totalBytes / 1048576).toFixed(1)} MB</TableCell>
              <TableCell className="py-1.5 text-right font-mono tabular-nums">{Math.round(o.congestion * 100)}%</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function StatsDock() {
  const t = useT();
  return (
    <Dock title={t.docks.stats} testId="dock-stats">
      <ScrollArea className="h-full">
        <StatsView />
      </ScrollArea>
    </Dock>
  );
}
