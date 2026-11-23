import { ChartNoAxesCombined } from "lucide-react";
import { create } from "zustand";
import type { SessionSummary } from "@vexcast/protocol";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/i18n";
import { formatDuration } from "@/lib/format";
import { goTo } from "@/lib/prefs";

export interface SessionEnded {
  id: string;
  title: string;
  summary: SessionSummary;
  droppedPct: number;
}

const usePostStream = create<{ ended: SessionEnded | null }>(() => ({ ended: null }));

/** Called when the core reports that a stream ended (WebSocket `session_ended`). */
export function showPostStream(ended: SessionEnded) {
  usePostStream.setState({ ended });
}

/** Summary shown when a stream ends, with a link to the full report. */
export function PostStreamDialog() {
  const t = useT();
  const r = t.reports;
  const ended = usePostStream((s) => s.ended);
  const close = () => usePostStream.setState({ ended: null });
  if (!ended) return null;
  const s = ended.summary;
  const stats: [string, string][] = [
    [r.duration, formatDuration(s.durationMs)],
    [r.peak, String(s.peakViewers)],
    [r.avg, s.avgViewers.toFixed(1)],
    [r.chat, String(s.chatMessages)],
    [r.chatters, String(s.chatters)],
    [r.follows, String(s.follows)],
    [r.subs, String(s.subs)],
    [r.droppedFrames, `${ended.droppedPct.toFixed(1)} %`],
  ];
  if (s.bits) stats.push([r.bits, String(s.bits)]);
  if (s.donations) stats.push([r.donations, s.donations.toFixed(2)]);
  if (s.raids) stats.push([r.raids, String(s.raids)]);
  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-lg" data-testid="post-stream-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ChartNoAxesCombined className="size-5 text-primary" /> {r.endedTitle}
          </DialogTitle>
          <DialogDescription>{ended.title || r.untitled}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {stats.map(([label, value]) => (
            <div key={label} className="rounded-md border bg-muted/30 px-3 py-2">
              <div className="text-lg font-semibold tabular-nums">{value}</div>
              <div className="text-xs text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>
        {ended.droppedPct >= 1 && <p className="text-xs text-amber-500">{r.droppedHint}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            {r.close}
          </Button>
          <Button
            onClick={() => {
              close();
              goTo("reports");
            }}
          >
            {r.openReport}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
