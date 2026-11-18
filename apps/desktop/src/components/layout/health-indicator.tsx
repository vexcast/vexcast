import type { HealthIssue, HealthReport, Stats } from "@vexcast/protocol";
import { Activity, AlertTriangle, CheckCircle2, Info, Loader2, MessageSquare, Mic, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useT } from "@/i18n";
import { fmt } from "@/lib/format";
import { goTo } from "@/lib/prefs";
import { act, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const OK: HealthReport = { level: "ok", issues: [] };
const MIC_KINDS = ["wasapi_input_capture", "coreaudio_input_capture", "pulse_input_capture", "alsa_input_capture"];
const HISTORY = 60;

// ------------------------------------------------------------------ live history (kept while the app runs)

/** kbps per output over the last minute (1 sample / s). */
const kbpsHistory: Record<string, number[]> = {};
/** Last time each audio source was heard (ms) and recent clipping moments. */
const lastHeard: Record<string, number> = {};
const clips: Record<string, number[]> = {};
let watching = false;

function watch() {
  if (watching) return;
  watching = true;
  useStore.subscribe((s, prev) => {
    if (s.stats && s.stats !== prev.stats) {
      for (const o of s.stats.outputs) {
        const h = (kbpsHistory[o.id] ??= []);
        h.push(o.kbps);
        if (h.length > HISTORY) h.shift();
      }
    }
    if (s.levels !== prev.levels) {
      const now = Date.now();
      for (const [uuid, l] of Object.entries(s.levels)) {
        const mag = Math.max(-100, ...(l.magnitude.length ? l.magnitude : [-100]));
        const peak = Math.max(-100, ...(l.peak.length ? l.peak : [-100]));
        if (mag > -50) lastHeard[uuid] = now;
        if (peak >= -0.5) {
          const c = (clips[uuid] ??= []);
          if (!c.length || now - c[c.length - 1] > 250) c.push(now);
        }
      }
    }
  });
}

function pct(a: number, b: number) {
  return b > 0 ? (a * 100) / b : 0;
}

function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** Bitrate a stream needs to look good at this resolution / frame rate (kbps). */
function recommendedKbps(height: number, fps: number) {
  if (height >= 1440) return fps >= 50 ? 9000 : 7000;
  if (height >= 1080) return fps >= 50 ? 6000 : 4500;
  if (height >= 720) return fps >= 50 ? 4500 : 3000;
  return 2000;
}

type Check = HealthIssue & { action?: { label: string; run: () => void } };

/** Checks the UI can do itself (audio, chat, bitrate), added to the core's report. */
function useClientChecks(now: number): { issues: Check[]; tips: Check[] } {
  const t = useT();
  const h = t.health;
  const state = useStore((s) => s.state);
  const levels = useStore((s) => s.levels);
  const live = !!state?.status.streaming;
  return useMemo(() => {
    const issues: Check[] = [];
    const tips: Check[] = [];
    if (!state) return { issues, tips };
    const mics = state.sources.filter((s) => s.audio && MIC_KINDS.includes(s.kind));
    if (live) {
      for (const m of mics) {
        if (m.muted) {
          issues.push({ id: `mic-muted:${m.uuid}`, level: "warn", title: fmt(h.micMuted, { name: m.name }), detail: h.micMutedDetail, fixes: [] });
        } else if (levels[m.uuid] && now - (lastHeard[m.uuid] ?? 0) > 60_000) {
          issues.push({ id: `mic-silent:${m.uuid}`, level: "warn", title: fmt(h.micSilent, { name: m.name }), detail: h.micSilentDetail, fixes: [] });
        }
      }
      const enabledChats = state.chat.filter((c) => c.enabled);
      for (const c of enabledChats.filter((c) => c.state === "error" || c.state === "disconnected")) {
        issues.push({
          id: `chat:${c.platform}`,
          level: "warn",
          title: fmt(h.chatDown, { platform: c.platform.charAt(0).toUpperCase() + c.platform.slice(1) }),
          detail: c.error ?? h.chatDownDetail,
          fixes: [],
          action: { label: h.openChat, run: () => goTo("chat") },
        });
      }
    }
    for (const s of state.sources.filter((x) => x.audio && !x.muted)) {
      const recent = (clips[s.uuid] ?? []).filter((x) => now - x < 10_000);
      clips[s.uuid] = recent;
      if (recent.length >= 4) {
        issues.push({ id: `clip:${s.uuid}`, level: "warn", title: fmt(h.clipping, { name: s.name }), detail: h.clippingDetail, fixes: [] });
      }
    }
    const v = state.video;
    const fps = v.fpsDen ? v.fpsNum / v.fpsDen : 30;
    const kbps = Number((state.output.streamEncoderSettings as Record<string, unknown>)?.bitrate ?? 0);
    const rec = recommendedKbps(v.outputHeight, fps);
    if (kbps > 0 && kbps < rec * 0.7) {
      tips.push({ id: "tip-bitrate", level: "warn", title: fmt(h.tipBitrate, { kbps, rec, res: `${v.outputHeight}p${Math.round(fps)}` }), detail: h.tipBitrateDetail, fixes: [] });
    }
    if (kbps > 8000 && state.destinations.some((d) => d.enabled && /twitch/i.test(d.service + d.server))) {
      tips.push({ id: "tip-twitch-max", level: "warn", title: fmt(h.tipTwitchMax, { kbps }), detail: h.tipTwitchMaxDetail, fixes: [] });
    }
    if (!live && mics.length === 0 && state.sources.length > 0) {
      tips.push({ id: "tip-no-mic", level: "warn", title: h.tipNoMic, detail: h.tipNoMicDetail, fixes: [] });
    }
    return { issues, tips };
  }, [state, levels, live, now, h]);
}

// ------------------------------------------------------------------ pieces

function Sparkline({ data, className }: { data: number[]; className?: string }) {
  if (data.length < 2) return <div className={className} />;
  const max = Math.max(...data, 1);
  const w = 100;
  const hgt = 24;
  const pts = data.map((v, i) => `${((i / (HISTORY - 1)) * w).toFixed(1)},${(hgt - 2 - (v / max) * (hgt - 4)).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${hgt}`} preserveAspectRatio="none" className={className} aria-hidden="true">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "warn" | "error" }) {
  return (
    <div className="rounded-md border px-2.5 py-1.5">
      <div className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className={cn("font-mono text-sm font-semibold tabular-nums", tone === "warn" && "text-amber-500", tone === "error" && "text-destructive")}>{value}</div>
      {sub && <div className="truncate text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function IssueCard({ i, busy, onFix }: { i: Check; busy: string | null; onFix: (id: string) => void }) {
  return (
    <li className={cn("rounded-md border p-2.5", i.level === "error" ? "border-destructive/40 bg-destructive/5" : "border-amber-500/40 bg-amber-500/5")}>
      <div className="text-sm font-medium">{i.title}</div>
      <p className="mt-0.5 text-xs text-muted-foreground">{i.detail}</p>
      {(i.fixes.length > 0 || i.action) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {i.fixes.map((f) => (
            <Button key={f.id} size="sm" variant="outline" className="h-7" disabled={busy === f.id} onClick={() => onFix(f.id)}>
              {busy === f.id && <Loader2 className="animate-spin" />}
              {f.label}
            </Button>
          ))}
          {i.action && (
            <Button size="sm" variant="outline" className="h-7" onClick={i.action.run}>
              {i.action.label}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

// ------------------------------------------------------------------ indicator

/** Status bar: stream health at a glance; the popover has live metrics, problems with fixes and tips. */
export function HealthIndicator({ className }: { className?: string }) {
  const t = useT();
  const h = t.health;
  const report = useStore((s) => s.health ?? OK);
  const state = useStore((s) => s.state);
  const stats = useStore((s) => s.stats);
  const client = useStore((s) => s.client);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  watch();
  useEffect(() => {
    client
      ?.getHealth()
      .then((health) => useStore.setState({ health }))
      .catch(() => {});
  }, [client]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(id);
  }, []);
  const live = !!state?.status.streaming;
  const recording = !!state?.status.recording;
  const { issues: local, tips } = useClientChecks(now);
  const issues: Check[] = [...report.issues, ...local];
  const level = issues.some((i) => i.level === "error") ? "error" : issues.length ? "warn" : "ok";
  const n = issues.length;
  const color = level === "error" ? "text-destructive" : level === "warn" ? "text-amber-500" : "text-emerald-500";
  const Icon = level === "error" ? XCircle : level === "warn" ? AlertTriangle : CheckCircle2;

  const dests = state?.destinations ?? [];
  const outs = (stats?.outputs ?? []).filter((o) => o.id !== "replay" && o.id !== "virtualcam" && (o.state === "active" || o.state === "reconnecting" || o.state === "starting" || o.state === "error"));
  const streamOuts = outs.filter((o) => o.id !== "record");
  const totalKbps = streamOuts.reduce((a, o) => a + o.kbps, 0);
  const dropped = streamOuts.reduce((a, o) => a + o.droppedFrames, 0);
  const frames = streamOuts.reduce((a, o) => a + o.totalFrames, 0);
  const dropPct = pct(dropped, frames);
  const summary = live ? fmt(h.liveSummary, { rate: (totalKbps / 1000).toFixed(1), drop: dropPct.toFixed(dropPct < 1 ? 1 : 0) }) : h.ok;

  const fix = async (id: string) => {
    setBusy(id);
    await act((c) => c.fixHealth(id));
    setBusy(null);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={cn("flex items-center gap-1.5 rounded-sm px-1.5 hover:bg-accent/60", className)} title={h.title} data-testid="status-health">
          <Activity className={cn("size-3.5", color)} />
          <span className={cn("hidden md:inline", n ? color : undefined)}>{n ? fmt(n === 1 ? h.one : h.many, { n }) : summary}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="max-h-[80vh] w-[28rem] max-w-[calc(100vw-1rem)] overflow-y-auto p-3">
        <div className="mb-2 flex items-center gap-2">
          <Icon className={cn("size-4", color)} />
          <span className="text-sm font-medium">{h.title}</span>
          <span className="ml-auto text-xs text-muted-foreground">
            {live && state?.status.streamStartedAt ? `${h.live} ${clock((state.status.serverTime || Date.now()) - state.status.streamStartedAt)}` : recording ? h.recording : h.offline}
          </span>
        </div>

        {stats && <Metrics stats={stats} recording={recording} />}

        {(live || recording) && outs.length > 0 && (
          <div className="mt-3 flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase">{h.outputs}</span>
            {outs.map((o) => {
              const name = o.id === "record" ? h.recordingOut : (dests.find((d) => d.id === o.id)?.name ?? o.id);
              const dp = pct(o.droppedFrames, o.totalFrames);
              const bad = o.state === "reconnecting" || o.state === "error" || dp > 2;
              return (
                <div key={o.id} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5">
                  <span className={cn("size-2 shrink-0 rounded-full", o.state === "active" ? (dp > 2 ? "bg-amber-500" : "bg-emerald-500") : o.state === "starting" ? "bg-sky-500" : "bg-destructive")} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">{name}</div>
                    <div className={cn("truncate text-[10px] text-muted-foreground", bad && "text-amber-500")}>
                      {o.state === "active" ? fmt(h.outLine, { drop: dp.toFixed(dp < 1 ? 2 : 1), n: o.droppedFrames }) : (h.states[o.state as keyof typeof h.states] ?? o.state)}
                    </div>
                  </div>
                  <Sparkline data={kbpsHistory[o.id] ?? []} className={cn("h-6 w-24 shrink-0", bad ? "text-amber-500" : "text-primary")} />
                  <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums">{(o.kbps / 1000).toFixed(1)} Mb/s</span>
                </div>
              );
            })}
          </div>
        )}

        <AudioRow now={now} />

        <div className="mt-3">
          {n === 0 ? (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <CheckCircle2 className="mt-px size-3.5 shrink-0 text-emerald-500" />
              {live ? h.allGoodLive : h.allGood}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {issues.map((i) => (
                <IssueCard key={i.id} i={i} busy={busy} onFix={fix} />
              ))}
            </ul>
          )}
        </div>

        {tips.length > 0 && (
          <div className="mt-3 flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase">{h.tips}</span>
            {tips.map((tip) => (
              <div key={tip.id} className="flex items-start gap-2 rounded-md border px-2.5 py-2">
                <Info className="mt-0.5 size-3.5 shrink-0 text-sky-500" />
                <div>
                  <div className="text-xs font-medium">{tip.title}</div>
                  <p className="text-[11px] text-muted-foreground">{tip.detail}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-[11px] text-muted-foreground">{h.hint}</p>
      </PopoverContent>
    </Popover>
  );
}

function Metrics({ stats, recording }: { stats: Stats; recording: boolean }) {
  const t = useT();
  const h = t.health;
  const budget = stats.targetFps > 0 ? 1000 / stats.targetFps : 16.7;
  const renderTone = stats.averageRenderMs > budget ? "error" : stats.averageRenderMs > budget * 0.7 ? "warn" : "ok";
  const fpsTone = stats.targetFps && stats.fps < stats.targetFps * 0.9 ? "warn" : "ok";
  const encSkip = pct(stats.encodingSkipped, stats.encodingTotal);
  const recKbps = stats.outputs.find((o) => o.id === "record" && o.state === "active")?.kbps ?? 0;
  const minutesLeft = recording && recKbps > 0 && stats.diskFreeGb != null ? Math.floor((stats.diskFreeGb * 8 * 1024 * 1024) / recKbps / 60) : null;
  return (
    <div className="grid grid-cols-3 gap-1.5">
      <Tile label="FPS" value={`${Math.round(stats.fps)} / ${Math.round(stats.targetFps)}`} tone={fpsTone} />
      <Tile label={h.render} value={`${stats.averageRenderMs.toFixed(1)} ms`} sub={fmt(h.budget, { ms: budget.toFixed(1) })} tone={renderTone} />
      <Tile label={h.encoder} value={`${encSkip.toFixed(1)} %`} sub={h.skipped} tone={encSkip > 2 ? "warn" : "ok"} />
      <Tile label="CPU" value={`${Math.round(stats.cpu)} %`} tone={stats.cpu > 90 ? "warn" : "ok"} />
      <Tile label="RAM" value={`${(stats.memoryMb / 1024).toFixed(1)} GB`} sub={h.vexcastUses} />
      <Tile
        label={h.disk}
        value={stats.diskFreeGb != null ? `${stats.diskFreeGb.toFixed(0)} GB` : "—"}
        sub={minutesLeft != null ? fmt(h.recLeft, { t: minutesLeft > 120 ? `${Math.floor(minutesLeft / 60)} h` : `${minutesLeft} min` }) : h.free}
        tone={stats.diskFreeGb != null && stats.diskFreeGb < 5 ? "warn" : "ok"}
      />
    </div>
  );
}

/** Microphone level right now and the chat connections (quick sanity check before/while live). */
function AudioRow({ now }: { now: number }) {
  const t = useT();
  const h = t.health;
  const sources = useStore((s) => s.state?.sources);
  const chat = useStore((s) => s.state?.chat);
  const levels = useStore((s) => s.levels);
  const mics = (sources ?? []).filter((s) => s.audio && MIC_KINDS.includes(s.kind));
  const chats = (chat ?? []).filter((c) => c.enabled);
  if (!mics.length && !chats.length) return null;
  return (
    <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
      {mics.slice(0, 2).map((m) => {
        const l = levels[m.uuid];
        const db = l ? Math.max(-100, ...(l.magnitude.length ? l.magnitude : [-100])) : -100;
        const w = Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
        const heard = now - (lastHeard[m.uuid] ?? 0) < 60_000;
        return (
          <div key={m.uuid} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5">
            <Mic className={cn("size-3.5 shrink-0", m.muted ? "text-destructive" : heard ? "text-emerald-500" : "text-muted-foreground")} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs">{m.name}</div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                <div className={cn("h-full rounded-full transition-[width] duration-150", db > -3 ? "bg-destructive" : db > -12 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${m.muted ? 0 : w}%` }} />
              </div>
            </div>
            <span className="text-[10px] text-muted-foreground">{m.muted ? h.muted : heard ? h.heard : h.quiet}</span>
          </div>
        );
      })}
      {chats.length > 0 && (
        <div className="flex items-center gap-2 rounded-md border px-2.5 py-1.5">
          <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
          <div className="flex min-w-0 flex-1 flex-wrap gap-x-2 gap-y-0.5 text-xs">
            {chats.map((c) => (
              <span key={c.platform} className="inline-flex items-center gap-1 capitalize">
                <span className={cn("size-1.5 rounded-full", c.state === "connected" ? "bg-emerald-500" : c.state === "connecting" ? "bg-sky-500" : "bg-destructive")} />
                {c.platform}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
