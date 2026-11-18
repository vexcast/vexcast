import type { AccountPlatform, SceneItem, StreamInfo } from "@vexcast/protocol";
import { AlertTriangle, Camera, CheckCircle2, Clapperboard, Cpu, Gamepad2, HardDrive, Info, Loader2, Mic, Radio, Type, XCircle } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { create } from "zustand";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useT } from "@/i18n";
import { openDialog } from "@/lib/dialogs";
import { fmt } from "@/lib/format";
import { goTo, usePrefs } from "@/lib/prefs";
import { flattenItems, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

type Choice = "go" | "rehearsal" | null;

const usePreflight = create<{ resolve: ((c: Choice) => void) | null }>(() => ({ resolve: null }));

/** Show the pre-stream checklist; resolves with what the user chose. */
export function preflightDialog(): Promise<Choice> {
  return new Promise((resolve) => usePreflight.setState({ resolve }));
}

type Level = "ok" | "warn" | "error" | "info";
interface Check {
  id: string;
  icon: ReactNode;
  label: string;
  level: Level;
  text: string;
  action?: { label: string; run: () => void };
}

const MIC_KINDS = ["wasapi_input_capture", "coreaudio_input_capture", "pulse_input_capture", "alsa_input_capture"];
const CAM_KINDS = ["dshow_input", "av_capture_input", "av_capture_input_v2", "v4l2_input", "macos-avcapture"];

function LevelIcon({ level }: { level: Level }) {
  if (level === "ok") return <CheckCircle2 className="size-4 text-emerald-500" />;
  if (level === "warn") return <AlertTriangle className="size-4 text-amber-500" />;
  if (level === "error") return <XCircle className="size-4 text-destructive" />;
  return <Info className="size-4 text-muted-foreground" />;
}

export function PreflightDialog() {
  const t = useT();
  const p = t.preflight;
  const resolve = usePreflight((s) => s.resolve);
  const open = !!resolve;
  const state = useStore((s) => s.state);
  const stats = useStore((s) => s.stats);
  const client = useStore((s) => s.client);
  const [info, setInfo] = useState<Record<string, StreamInfo | null> | null>(null);
  const [heard, setHeard] = useState<Record<string, number>>({});
  const [listening, setListening] = useState(true);
  const [skipNext, setSkipNext] = useState(false);

  const linked = useMemo(() => (state?.accounts ?? []).filter((a) => a.connected && (a.platform === "twitch" || a.platform === "kick")).map((a) => a.platform as AccountPlatform), [state?.accounts]);

  // Titles from the linked accounts; loudest mic level over ~2.5 s.
  useEffect(() => {
    if (!open || !client) return;
    setInfo(null);
    setHeard({});
    setListening(true);
    setSkipNext(false);
    Promise.all(linked.map((pl) => client.getStreamInfo(pl).then((i) => [pl, i] as const, () => [pl, null] as const))).then((r) => setInfo(Object.fromEntries(r)));
    const timer = setInterval(() => {
      const lv = useStore.getState().levels;
      setHeard((h) => {
        const n = { ...h };
        for (const [u, l] of Object.entries(lv)) n[u] = Math.max(n[u] ?? -100, ...(l.magnitude.length ? l.magnitude : [-100]));
        return n;
      });
    }, 200);
    const stop = setTimeout(() => setListening(false), 2500);
    return () => {
      clearInterval(timer);
      clearTimeout(stop);
    };
  }, [open, client, linked]);

  const close = (c: Choice) => {
    if (c && skipNext) usePrefs.getState().set({ preflight: false });
    resolve?.(c);
    usePreflight.setState({ resolve: null });
  };

  const checks: Check[] = useMemo(() => {
    if (!state) return [];
    const out: Check[] = [];
    const dests = state.destinations.filter((d) => d.enabled);
    out.push(
      dests.length
        ? { id: "dest", icon: <Radio />, label: p.destinations, level: "ok", text: fmt(p.destinationsOk, { n: dests.length, names: dests.map((d) => d.name).join(", ") }) }
        : { id: "dest", icon: <Radio />, label: p.destinations, level: "error", text: p.destinationsNone, action: { label: p.openDestinations, run: () => (close(null), goTo("destinations")) } },
    );
    if (dests.some((d) => d.canvas === "vertical") && !state.video.verticalEnabled)
      out.push({ id: "vert", icon: <Radio />, label: p.destinations, level: "warn", text: p.verticalOff, action: { label: p.fix, run: () => (close(null), openDialog("settings", "video")) } });
    for (const pl of linked) {
      const name = pl === "twitch" ? "Twitch" : "Kick";
      const i = info?.[pl];
      if (info === null) out.push({ id: `title-${pl}`, icon: <Type />, label: p.titleRow, level: "info", text: p.checking });
      else if (!i || !i.title.trim())
        out.push({ id: `title-${pl}`, icon: <Type />, label: p.titleRow, level: "warn", text: fmt(p.noTitle, { name }), action: { label: p.openInfo, run: () => openDialog("streamInfo", true) } });
      else out.push({ id: `title-${pl}`, icon: <Type />, label: p.titleRow, level: "ok", text: `${fmt(p.titleOk, { name, title: i.title })}${i.category ? ` · ${i.category.name}` : ""}` });
    }
    const mics = state.sources.filter((s) => MIC_KINDS.includes(s.kind));
    if (!mics.length) out.push({ id: "mic", icon: <Mic />, label: p.mic, level: "warn", text: p.micNone });
    for (const m of mics.slice(0, 3)) {
      if (m.muted) out.push({ id: `mic-${m.uuid}`, icon: <Mic />, label: p.mic, level: "warn", text: fmt(p.micMuted, { name: m.name }) });
      else if ((heard[m.uuid] ?? -100) > -60) out.push({ id: `mic-${m.uuid}`, icon: <Mic />, label: p.mic, level: "ok", text: fmt(p.micOk, { name: m.name }) });
      else out.push({ id: `mic-${m.uuid}`, icon: <Mic />, label: p.mic, level: listening ? "info" : "warn", text: listening ? p.checking : fmt(p.micSilent, { name: m.name }) });
    }
    const program = state.scenes.find((s) => s.uuid === state.programSceneUuid);
    if (program) {
      out.push({ id: "scene", icon: <Clapperboard />, label: p.scene, level: "info", text: fmt(p.sceneStart, { name: program.name }) });
      const items: SceneItem[] = flattenItems(program.items).filter((i) => i.visible);
      const kindOf = (u: string) => state.sources.find((s) => s.uuid === u);
      const cams = items.map((i) => kindOf(i.sourceUuid)).filter((s) => s && CAM_KINDS.includes(s.kind));
      for (const c of cams.slice(0, 2))
        out.push(c!.width > 0 ? { id: `cam-${c!.uuid}`, icon: <Camera />, label: p.camera, level: "ok", text: fmt(p.cameraOk, { name: c!.name }) } : { id: `cam-${c!.uuid}`, icon: <Camera />, label: p.camera, level: "warn", text: fmt(p.cameraBlack, { name: c!.name }) });
      const game = items.map((i) => kindOf(i.sourceUuid)).find((s) => s?.kind === "game_capture");
      if (game && game.width === 0) out.push({ id: "game", icon: <Gamepad2 />, label: p.game, level: "info", text: p.gameWaiting });
    }
    if (stats) {
      const fps = Math.round(stats.fps);
      const target = Math.round(stats.targetFps);
      const cpu = Math.round(stats.cpu);
      if (target && fps < target * 0.9) out.push({ id: "perf", icon: <Cpu />, label: p.performance, level: "warn", text: fmt(p.perfLow, { fps, target }) });
      else if (cpu > 90) out.push({ id: "perf", icon: <Cpu />, label: p.performance, level: "warn", text: fmt(p.perfCpu, { cpu }) });
      else out.push({ id: "perf", icon: <Cpu />, label: p.performance, level: "ok", text: fmt(p.perfOk, { fps, cpu }) });
      if (stats.diskFreeGb != null && stats.diskFreeGb < 5) out.push({ id: "disk", icon: <HardDrive />, label: p.disk, level: "warn", text: fmt(p.diskLow, { gb: stats.diskFreeGb.toFixed(1) }) });
    }
    return out;
    // close is stable enough for this list; it only changes with `resolve`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, stats, info, heard, listening, linked, p]);

  const hasError = checks.some((c) => c.level === "error");
  const hasWarn = checks.some((c) => c.level === "warn");
  const canRehearse = !!state?.destinations.some((d) => d.enabled && `${d.service} ${d.server} ${d.name}`.toLowerCase().includes("twitch"));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close(null)}>
      <DialogContent className="sm:max-w-lg" data-testid="preflight-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {hasError ? <XCircle className="size-5 text-destructive" /> : hasWarn ? <AlertTriangle className="size-5 text-amber-500" /> : <CheckCircle2 className="size-5 text-emerald-500" />}
            {p.title}
          </DialogTitle>
          <DialogDescription>{p.desc}</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col divide-y rounded-lg border">
          {checks.map((c) => (
            <li key={c.id} className={cn("flex items-start gap-3 px-3 py-2.5", c.level === "error" && "bg-destructive/5", c.level === "warn" && "bg-amber-500/5")}>
              <span className="mt-0.5 shrink-0">{c.level === "info" && c.text === p.checking ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : <LevelIcon level={c.level} />}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground [&_svg]:size-3.5">
                  {c.icon}
                  {c.label}
                </div>
                <div className="text-sm break-words">{c.text}</div>
              </div>
              {c.action && (
                <Button size="sm" variant="outline" className="h-7 shrink-0" onClick={c.action.run}>
                  {c.action.label}
                </Button>
              )}
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2">
          <Checkbox id="preflight-skip" checked={skipNext} onCheckedChange={(v) => setSkipNext(!!v)} />
          <Label htmlFor="preflight-skip" className="text-xs font-normal text-muted-foreground">
            {p.dontAsk}
          </Label>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {canRehearse ? (
            <Button variant="outline" onClick={() => close("rehearsal")} title={p.rehearseHint} data-testid="preflight-rehearse">
              {p.rehearse}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => close(null)}>
              {t.common.cancel}
            </Button>
            <Button variant={hasWarn ? "outline" : "default"} disabled={hasError} onClick={() => close("go")} data-testid="preflight-go">
              <Radio /> {hasWarn ? p.goAnyway : p.go}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
