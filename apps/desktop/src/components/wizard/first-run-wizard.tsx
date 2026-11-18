import type { EncoderType, GeneralSettings } from "@vexcast/protocol";
import { Check, Cpu, Gauge, Loader2, Monitor, Moon, Sun } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ACCOUNT_PLATFORMS, accountMeta, ConnectAccountButton } from "@/components/accounts/connect-button";
import { AccountAvatar } from "@/components/accounts/accounts-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/i18n";
import { useDialogs } from "@/lib/dialogs";
import { fmt } from "@/lib/format";
import { usePrefs } from "@/lib/prefs";
import { act, editingSceneUuid, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

type Usage = "streaming" | "recording" | "both";
type StepId = "language" | "usage" | "hardware" | "accounts" | "sources" | "summary";
type SourceKey = "screen" | "mic" | "camera" | "desktop";

const SOURCE_KINDS: Record<SourceKey, string> = {
  screen: "monitor_capture",
  mic: "wasapi_input_capture",
  camera: "dshow_input",
  desktop: "wasapi_output_capture",
};
const SOURCE_KEYS: SourceKey[] = ["screen", "mic", "camera", "desktop"];

const RESOLUTIONS: [number, number][] = [
  [1280, 720],
  [1600, 900],
  [1920, 1080],
  [2560, 1440],
  [3840, 2160],
];
const BASE_CANDIDATES: [number, number][] = [
  [1920, 1080],
  [2560, 1440],
  [3840, 2160],
];
const FPS = [24, 30, 48, 60];
const res = (w: number, h: number) => `${w}x${h}`;
const parseRes = (v: string): [number, number] => v.split("x").map(Number) as [number, number];

/** Physical screen size rounded down to a common 16:9 canvas (1080p minimum). */
function suggestedBase(): [number, number] {
  const w = Math.round((window.screen?.width ?? 1920) * (window.devicePixelRatio || 1));
  let best = BASE_CANDIDATES[0];
  // 2% slack: 2552-wide screens (scaling rounding) still count as 1440p.
  for (const c of BASE_CANDIDATES) if (w >= c[0] * 0.98) best = c;
  return best;
}

const HW_ORDER = ["nvenc", "amf", "qsv"];
/** Hardware H.264 first (NVENC > AMF > QuickSync), then any hardware, then x264. */
function pickEncoder(list: EncoderType[]): string {
  const rank = (e: EncoderType) => {
    const i = HW_ORDER.findIndex((k) => e.id.toLowerCase().includes(k));
    return (e.hardware ? 0 : 100) + (i < 0 ? 9 : i) + (e.codec === "h264" ? 0 : 10);
  };
  const sorted = [...list].sort((a, b) => rank(a) - rank(b));
  const hw = sorted.find((e) => e.hardware);
  return hw?.id ?? list.find((e) => e.id === "obs_x264")?.id ?? list[0]?.id ?? "obs_x264";
}

/** Big selectable card for RadioGroup steps. */
function ChoiceCard({ value, icon, title, desc, current }: { value: string; icon?: ReactNode; title: string; desc?: string; current: string }) {
  const id = `wizard-choice-${value}`;
  return (
    <Label
      htmlFor={id}
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border p-4 font-normal transition-colors hover:bg-accent/50",
        current === value && "border-primary bg-accent/40",
      )}
    >
      <RadioGroupItem id={id} value={value} className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-2 text-sm font-medium">
          {icon}
          {title}
        </span>
        {desc && <span className="text-xs leading-snug text-muted-foreground">{desc}</span>}
      </div>
    </Label>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid items-center gap-x-6 gap-y-1.5 sm:grid-cols-[minmax(0,1fr)_14rem]">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/**
 * First-run setup: language/theme, usage, encoder + resolution, accounts,
 * first sources and a summary. Opens once on a fresh install
 * (`prefs.wizardDone === false`) and whenever `useDialogs().wizard` is set.
 */
export function FirstRunWizard() {
  const t = useT();
  const w = t.wizard;
  const open = useDialogs((d) => d.wizard);
  const hasState = useStore((s) => !!s.state);
  const general = useStore((s) => s.state?.general);
  const accounts = useStore((s) => s.state?.accounts);

  // Auto-open once on a fresh install.
  const autoChecked = useRef(false);
  useEffect(() => {
    if (!hasState || autoChecked.current) return;
    autoChecked.current = true;
    if (usePrefs.getState().wizardDone === false) useDialogs.getState().open("wizard", true);
  }, [hasState]);

  const [step, setStep] = useState(0);
  const [usage, setUsage] = useState<Usage>("streaming");
  const [encoders, setEncoders] = useState<EncoderType[] | null>(null);
  const [kinds, setKinds] = useState<Set<string> | null>(null);
  const [encoder, setEncoder] = useState("");
  const [base, setBase] = useState(() => res(...suggestedBase()));
  const [output, setOutput] = useState("1920x1080");
  const [fps, setFps] = useState(60);
  const [picked, setPicked] = useState<Record<SourceKey, boolean>>({ screen: true, mic: true, camera: false, desktop: true });
  const [busy, setBusy] = useState(false);
  const client = useStore((s) => s.client);
  const engineReady = useStore((s) => !!s.state?.status.ready);
  const engineError = useStore((s) => s.state?.status.error ?? null);
  /** The encoders couldn't be read (the engine didn't start): continue with the current settings. */
  const [detectFailed, setDetectFailed] = useState(false);

  // Fresh start every time it opens.
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setBase(res(...suggestedBase()));
  }, [open]);

  // The catalog needs the engine: on a fresh install the wizard opens while it's still
  // starting, so wait for it and retry instead of asking once and spinning forever.
  useEffect(() => {
    if (!open || !client || encoders) return;
    let alive = true;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setDetectFailed(false);
    const load = () => {
      if (!alive) return;
      if (!useStore.getState().state?.status.ready) {
        // Not started yet: wait (up to ~1 min), then give up and let the user continue.
        if (++tries > 40) return setDetectFailed(true);
        timer = setTimeout(load, 1500);
        return;
      }
      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 10_000));
      Promise.race([Promise.all([client.encoders(), client.sourceTypes()]), timeout])
        .then(([enc, types]) => {
          if (!alive) return;
          const video = enc.filter((e) => e.type === "video" && !e.deprecated);
          setEncoders(video);
          setKinds(new Set(types.filter((s) => s.kind === "input").map((s) => s.id)));
          if (video.length) applyEncoder(pickEncoder(video), video);
          else setDetectFailed(true);
        })
        .catch(() => {
          if (!alive) return;
          if (++tries > 40) return setDetectFailed(true);
          timer = setTimeout(load, 1500);
        });
    };
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, client, engineReady]);

  const sources = useStore((s) => s.state?.sources);
  const hasMic = !!sources?.some((s) => s.globalSlot?.startsWith("mic"));
  const hasDesktop = !!sources?.some((s) => s.globalSlot?.startsWith("desktop"));
  const exists: Record<SourceKey, boolean> = { screen: false, camera: false, mic: hasMic, desktop: hasDesktop };
  const offered = SOURCE_KEYS.filter((k) => !kinds || kinds.has(SOURCE_KINDS[k]));
  const chosen = offered.filter((k) => picked[k] && !exists[k]);

  const steps: StepId[] = useMemo(
    () => (usage === "recording" ? ["language", "usage", "hardware", "sources", "summary"] : ["language", "usage", "hardware", "accounts", "sources", "summary"]),
    [usage],
  );
  const current = steps[Math.min(step, steps.length - 1)];
  const last = step >= steps.length - 1;

  function applyEncoder(id: string, list = encoders ?? []) {
    setEncoder(id);
    const hw = list.find((e) => e.id === id)?.hardware ?? false;
    setOutput(hw ? "1920x1080" : "1280x720");
    setFps(hw ? 60 : 30);
  }
  const encoderInfo = encoders?.find((e) => e.id === encoder);

  const setGeneral = (patch: Partial<GeneralSettings>) => void act((c) => c.setGeneral(patch));
  const markDone = () => usePrefs.getState().set({ wizardDone: true });
  const skip = () => {
    markDone();
    useDialogs.getState().close("wizard");
  };

  const finish = async () => {
    setBusy(true);
    const [bw, bh] = parseRes(base);
    let [ow, oh] = parseRes(output);
    if (ow > bw) [ow, oh] = [bw, bh];
    await act((c) => c.setVideo({ baseWidth: bw, baseHeight: bh, outputWidth: ow, outputHeight: oh, fpsNum: fps, fpsDen: 1 }));
    if (encoder) await act((c) => c.setOutput({ streamEncoder: encoder }));
    const st = useStore.getState().state;
    const sceneUuid = st ? editingSceneUuid(st) : null;
    const taken = new Set(st?.sources.map((s) => s.name) ?? []);
    for (const k of chosen) {
      let name = w.sourceNames[k];
      for (let i = 2; taken.has(name); i++) name = `${w.sourceNames[k]} ${i}`;
      taken.add(name);
      await act((c) => c.createSource({ name, kind: SOURCE_KINDS[k], ...(sceneUuid ? { sceneUuid } : {}) }));
    }
    setBusy(false);
    markDone();
    useDialogs.getState().close("wizard");
    toast.success(w.done);
  };

  const lang = general?.language ?? "es";
  const theme = general?.theme ?? "dark";
  const usageLabel = { streaming: w.usage.streaming, recording: w.usage.recording, both: w.usage.both }[usage];
  const connected = (accounts ?? []).filter((a) => a.connected);
  const hwList = encoders?.filter((e) => e.hardware) ?? [];
  const swList = encoders?.filter((e) => !e.hardware) ?? [];

  let body: ReactNode;
  switch (current) {
    case "language":
      body = (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2.5">
            <span className="text-sm font-medium">{w.language.language}</span>
            <RadioGroup value={lang} onValueChange={(v) => setGeneral({ language: v as GeneralSettings["language"] })} className="grid-cols-2">
              <ChoiceCard value="es" title="Español" current={lang} />
              <ChoiceCard value="en" title="English" current={lang} />
            </RadioGroup>
          </div>
          <div className="flex flex-col gap-2.5">
            <span className="text-sm font-medium">{w.language.theme}</span>
            <RadioGroup value={theme} onValueChange={(v) => setGeneral({ theme: v as GeneralSettings["theme"] })} className="grid-cols-3">
              <ChoiceCard value="dark" icon={<Moon className="size-4" />} title={w.language.themes.dark} current={theme} />
              <ChoiceCard value="light" icon={<Sun className="size-4" />} title={w.language.themes.light} current={theme} />
              <ChoiceCard value="system" icon={<Monitor className="size-4" />} title={w.language.themes.system} current={theme} />
            </RadioGroup>
          </div>
        </div>
      );
      break;
    case "usage":
      body = (
        <RadioGroup value={usage} onValueChange={(v) => setUsage(v as Usage)}>
          <ChoiceCard value="streaming" title={w.usage.streaming} desc={w.usage.streamingDesc} current={usage} />
          <ChoiceCard value="recording" title={w.usage.recording} desc={w.usage.recordingDesc} current={usage} />
          <ChoiceCard value="both" title={w.usage.both} desc={w.usage.bothDesc} current={usage} />
        </RadioGroup>
      );
      break;
    case "hardware":
      body = detectFailed && !encoders?.length ? (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <span className="font-medium">{w.hardware.failedTitle}</span>
          <span className="text-muted-foreground">{w.hardware.failedHint}</span>
          {engineError && <code className="rounded bg-muted px-2 py-1 text-xs break-words">{engineError}</code>}
        </div>
      ) : !encoders ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> {engineReady ? w.hardware.detecting : w.hardware.waitingEngine}
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-md border bg-background text-muted-foreground">
              {encoderInfo?.hardware ? <Gauge className="size-4" /> : <Cpu className="size-4" />}
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">{encoderInfo?.name ?? encoder}</span>
              <span className="text-xs text-muted-foreground">{w.hardware.encoderHint}</span>
            </div>
            <Badge variant={encoderInfo?.hardware ? "secondary" : "outline"}>{encoderInfo?.hardware ? w.hardware.hardware : w.hardware.software}</Badge>
          </div>
          <Row label={w.hardware.encoder}>
            <Select value={encoder} onValueChange={(v) => applyEncoder(v)}>
              <SelectTrigger className="w-full" data-testid="wizard-encoder">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {hwList.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>{w.hardware.hardware}</SelectLabel>
                    {hwList.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {swList.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>{w.hardware.software}</SelectLabel>
                    {swList.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
          </Row>
          <Row label={w.hardware.base} hint={w.hardware.baseHint}>
            <ResSelect
              value={base}
              onChange={(v) => {
                setBase(v);
                // Output can't be larger than the canvas.
                if (parseRes(output)[0] > parseRes(v)[0]) setOutput(v);
              }}
            />
          </Row>
          <Row label={w.hardware.output} hint={w.hardware.outputHint}>
            <ResSelect value={output} onChange={setOutput} max={parseRes(base)[0]} />
          </Row>
          <Row label={w.hardware.fps}>
            <Select value={String(fps)} onValueChange={(v) => setFps(Number(v))}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FPS.map((f) => (
                  <SelectItem key={f} value={String(f)}>
                    {f} FPS
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
        </div>
      );
      break;
    case "accounts":
      body = (
        <div className="flex flex-col divide-y rounded-lg border">
          {ACCOUNT_PLATFORMS.map((p) => {
            const acc = accounts?.find((a) => a.platform === p);
            const meta = accountMeta(p);
            const Icon = meta.icon;
            return (
              <div key={p} className="flex items-center gap-3 px-4 py-3">
                {acc?.connected ? (
                  <AccountAvatar account={acc} className="size-8" />
                ) : (
                  <span className="grid size-8 shrink-0 place-items-center rounded-md border bg-muted" style={{ color: acc?.available ? meta.color : undefined }}>
                    <Icon size={15} />
                  </span>
                )}
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-medium">{meta.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {acc?.connected ? fmt(t.accounts.connectedAs, { name: acc.displayName || acc.login || "" }) : acc?.available === false ? t.accounts.unavailable : t.accounts.notConnected}
                  </span>
                </div>
                {acc?.connected ? <Check className="size-4 text-emerald-500" /> : <ConnectAccountButton platform={p} size="sm" />}
              </div>
            );
          })}
        </div>
      );
      break;
    case "sources":
      body = (
        <div className="flex flex-col gap-2">
          {offered.map((k) => {
            const id = `wizard-src-${k}`;
            const disabled = exists[k];
            return (
              <Label
                key={k}
                htmlFor={id}
                className={cn(
                  "flex items-center gap-3 rounded-lg border p-3.5 font-normal transition-colors",
                  disabled ? "cursor-default opacity-60" : "cursor-pointer hover:bg-accent/50",
                  picked[k] && !disabled && "border-primary bg-accent/40",
                )}
              >
                <Checkbox id={id} checked={disabled ? false : picked[k]} disabled={disabled} onCheckedChange={(v) => setPicked((p) => ({ ...p, [k]: v === true }))} />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm font-medium">{w.sources[k]}</span>
                  <span className="text-xs text-muted-foreground">{w.sources[`${k}Desc` as const]}</span>
                </div>
                {disabled && <Badge variant="outline">{w.sources.exists}</Badge>}
              </Label>
            );
          })}
        </div>
      );
      break;
    case "summary": {
      const [bw, bh] = parseRes(base);
      const [ow, oh] = parseRes(output);
      const rows: [string, ReactNode][] = [
        [w.summary.language, `${lang === "es" ? "Español" : "English"} · ${w.language.themes[theme]}`],
        [w.summary.usage, usageLabel],
        [w.summary.encoder, encoderInfo?.name ?? encoder],
        [w.summary.video, `${bw}×${bh} → ${ow}×${oh} · ${fps} FPS`],
        ...(usage === "recording" ? [] : ([[w.summary.accounts, connected.length ? connected.map((a) => `${accountMeta(a.platform).name} (${a.displayName || a.login})`).join(", ") : w.summary.none]] as [string, ReactNode][])),
        [w.summary.sources, chosen.length ? chosen.map((k) => w.sources[k]).join(", ") : w.summary.none],
      ];
      body = (
        <dl className="divide-y rounded-lg border text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[10rem_minmax(0,1fr)] gap-4 px-4 py-2.5">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="font-medium break-words">{v}</dd>
            </div>
          ))}
        </dl>
      );
      break;
    }
  }

  const heading: Record<StepId, { title: string; desc: string }> = {
    language: { title: w.language.heading, desc: w.language.desc },
    usage: { title: w.usage.heading, desc: w.usage.desc },
    hardware: { title: w.hardware.heading, desc: w.hardware.desc },
    accounts: { title: w.accounts.heading, desc: w.accounts.desc },
    sources: { title: w.sources.heading, desc: w.sources.desc },
    summary: { title: w.summary.heading, desc: w.summary.desc },
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !busy && skip()}>
      <DialogContent className="flex h-[min(44rem,calc(100dvh-2rem))] flex-col gap-0 p-0 sm:max-w-2xl" data-testid="first-run-wizard" onInteractOutside={(e) => e.preventDefault()}>
        <div className="flex flex-col gap-4 border-b px-6 pt-6 pb-4">
          <div className="flex items-center justify-between gap-4 pr-6">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{w.title}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{fmt(w.stepOf, { n: step + 1, total: steps.length })}</span>
          </div>
          <ol className="flex items-center gap-2" aria-label={w.title}>
            {steps.map((s, i) => (
              <li key={s} className="flex min-w-0 flex-1 flex-col gap-1.5" aria-current={i === step ? "step" : undefined}>
                <span className={cn("h-1 rounded-full", i <= step ? "bg-primary" : "bg-muted")} />
                <span className={cn("truncate text-[11px]", i === step ? "font-medium text-foreground" : "text-muted-foreground")}>{w.steps[s]}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <DialogHeader className="mb-5">
            <DialogTitle>{heading[current].title}</DialogTitle>
            <DialogDescription>{heading[current].desc}</DialogDescription>
          </DialogHeader>
          <div data-testid={`wizard-step-${current}`}>
            {body}
          </div>
        </div>
        <DialogFooter className="items-center border-t px-6 py-4 sm:justify-between">
          <Button variant="ghost" className="text-muted-foreground" onClick={skip} disabled={busy} data-testid="wizard-skip">
            {w.skip}
          </Button>
          <div className="flex gap-2">
            {step > 0 && (
              <Button variant="outline" onClick={() => setStep((s) => s - 1)} disabled={busy}>
                {w.back}
              </Button>
            )}
            {last ? (
              <Button onClick={finish} disabled={busy} data-testid="wizard-finish">
                {busy && <Loader2 className="animate-spin" />}
                {busy ? w.finishing : w.finish}
              </Button>
            ) : (
              <Button onClick={() => setStep((s) => s + 1)} disabled={current === "hardware" && !encoders && !detectFailed} data-testid="wizard-next">
                {w.next}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResSelect({ value, onChange, max }: { value: string; onChange: (v: string) => void; max?: number }) {
  const list = RESOLUTIONS.filter(([rw]) => !max || rw <= max);
  const all = list.some(([rw, rh]) => res(rw, rh) === value) ? list : [...list, parseRes(value)];
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {all.map(([rw, rh]) => (
          <SelectItem key={res(rw, rh)} value={res(rw, rh)}>
            {rw}×{rh}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
