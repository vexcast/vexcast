import type { Countdown, Counter } from "@vexcast/protocol";
import { Copy, Hash, Minus, Pause, Play, Plus, RotateCcw, Square, Timer, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n";
import { fmt } from "@/lib/format";
import { act, editingSceneUuid, useStore } from "@/lib/store";
import { Field, Section, SwitchRow } from "./shared";

const EMPTY: Counter[] = [];
const DEFAULT_CD: Countdown = { endsAt: null, pausedLeftMs: null, label: "Empezamos en", endText: "¡Ya estamos!", subathon: false, addFollowSec: 10, addSubSec: 120, addPer100BitsSec: 60, addPerCurrencySec: 60 };

function clock(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = s % 60;
  const mm = `${h ? String(m).padStart(2, "0") : m}:${String(x).padStart(2, "0")}`;
  return h ? `${h}:${mm}` : mm;
}

/** Text saved on blur. */
function Blur({ value, onChange, className, placeholder, prefix }: { value: string; onChange: (v: string) => void; className?: string; placeholder?: string; prefix?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <div className="relative min-w-0">
      {prefix && <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 font-mono text-xs text-muted-foreground">{prefix}</span>}
      <Input value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onChange(v)} className={className + (prefix ? " pl-6" : "")} placeholder={placeholder} spellCheck={false} />
    </div>
  );
}

function useAddSource() {
  const t = useT();
  const client = useStore((s) => s.client);
  const sceneUuid = useStore((s) => (s.state ? editingSceneUuid(s.state) : null));
  const url = (q: string) => {
    const base = client?.widgetUrl("counter") ?? "";
    return `${base}${base.includes("?") ? "&" : "?"}${q}`;
  };
  const add = (name: string, q: string) => {
    if (!sceneUuid) return;
    act((c) => c.createSource({ name, kind: "browser_source", settings: { url: url(q), width: 800, height: 120 }, sceneUuid }), t.alerts.addedToScene);
  };
  const copy = (q: string) => navigator.clipboard.writeText(url(q)).then(() => toast.success(t.look.lb.copied));
  return { add, copy, canAdd: !!sceneUuid };
}

function Counters() {
  const t = useT();
  const c = t.look.ct;
  const counters = useStore((s) => s.state?.counters ?? EMPTY);
  const prefix = useStore((s) => s.state?.bot.prefix ?? "!");
  const { add, copy, canAdd } = useAddSource();
  const save = (list: Counter[]) => act((x) => x.setCounters(list));
  const patch = (id: string, p: Partial<Counter>) => save(counters.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const create = () => save([...counters, { id: Math.random().toString(36).slice(2, 12), name: c.newName, value: 0, command: counters.length ? "" : "muertes", template: "{name}: {value}" }]);
  return (
    <Section
      title={c.title}
      icon={<Hash />}
      description={fmt(c.desc, { p: prefix })}
      action={
        <Button size="sm" onClick={create}>
          <Plus /> {c.add}
        </Button>
      }
    >
      {counters.length === 0 && <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">{c.none}</p>}
      {counters.map((x) => (
        <div key={x.id} className="flex flex-col gap-2 rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <Blur value={x.name} onChange={(name) => name.trim() && patch(x.id, { name: name.trim() })} className="h-8 font-medium" />
            <Button size="icon-sm" variant="outline" onClick={() => act((a) => a.addCounter(x.id, -1))} aria-label="-1">
              <Minus />
            </Button>
            <span className="w-14 text-center font-mono text-xl font-semibold tabular-nums">{x.value}</span>
            <Button size="icon-sm" variant="outline" onClick={() => act((a) => a.addCounter(x.id, 1))} aria-label="+1">
              <Plus />
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={() => act((a) => a.setCounterValue(x.id, 0))} aria-label={c.reset} title={c.reset}>
              <RotateCcw />
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label={c.command} hint={x.command ? fmt(c.commandHint, { cmd: `${prefix}${x.command}` }) : c.noCommand}>
              <Blur value={x.command} onChange={(command) => patch(x.id, { command: command.replace(/\s/g, "").replace(/^!/, "") })} className="h-8 font-mono text-xs" prefix={prefix} placeholder="muertes" />
            </Field>
            <Field label={c.template} hint={c.templateHint}>
              <Blur value={x.template} onChange={(template) => patch(x.id, { template })} className="h-8 font-mono text-xs" />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="outline" disabled={!canAdd} onClick={() => add(`${c.title}: ${x.name}`, `id=${encodeURIComponent(x.id)}`)}>
              <Plus /> {t.alerts.addToScene}
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={() => copy(`id=${encodeURIComponent(x.id)}`)} aria-label={t.alerts.widgetUrl} title={t.alerts.widgetUrl}>
              <Copy />
            </Button>
            <span className="flex-1 text-[11px] text-muted-foreground">{c.hotkeyHint}</span>
            <Button size="icon-sm" variant="ghost" className="hover:text-destructive" onClick={() => save(counters.filter((y) => y.id !== x.id))} aria-label={t.common.delete} title={t.common.delete}>
              <Trash2 />
            </Button>
          </div>
        </div>
      ))}
      <p className="text-[11px] text-muted-foreground">{c.look}</p>
    </Section>
  );
}

function CountdownSection() {
  const t = useT();
  const c = t.look.ct;
  const cd: Countdown = { ...DEFAULT_CD, ...(useStore((s) => s.state?.countdown) ?? {}) };
  const { add, copy, canAdd } = useAddSource();
  const [minutes, setMinutes] = useState(10);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  const left = cd.pausedLeftMs ?? (cd.endsAt ? cd.endsAt - now : null);
  const running = cd.endsAt != null && cd.endsAt > now;
  const paused = cd.pausedLeftMs != null;
  const save = (p: Partial<Countdown>) => act((x) => x.setCountdown({ ...cd, ...p }));
  const num = (v: string, d: number) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : d);
  return (
    <Section title={c.cdTitle} icon={<Timer />} description={c.cdDesc}>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3">
        <span className="font-mono text-3xl font-semibold tabular-nums">{left == null ? "—" : clock(left)}</span>
        <span className="text-xs text-muted-foreground">{paused ? c.paused : running ? c.running : left != null ? c.finished : c.stopped}</span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Input type="number" min={1} value={minutes} onChange={(e) => setMinutes(num(e.target.value, minutes) || 1)} className="h-8 w-20" aria-label="min" />
          <span className="text-xs text-muted-foreground">min</span>
          <Button size="sm" onClick={() => act((x) => x.countdown("start", minutes * 60))}>
            <Play /> {c.start}
          </Button>
          <Button size="sm" variant="outline" disabled={!running && !paused} onClick={() => act((x) => x.countdown("add", 60))}>
            +1 min
          </Button>
          {paused ? (
            <Button size="icon-sm" variant="outline" onClick={() => act((x) => x.countdown("resume"))} aria-label={c.resume} title={c.resume}>
              <Play />
            </Button>
          ) : (
            <Button size="icon-sm" variant="outline" disabled={!running} onClick={() => act((x) => x.countdown("pause"))} aria-label={c.pause} title={c.pause}>
              <Pause />
            </Button>
          )}
          <Button size="icon-sm" variant="ghost" onClick={() => act((x) => x.countdown("stop"))} aria-label={c.stop} title={c.stop}>
            <Square />
          </Button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={c.label}>
          <Blur value={cd.label} onChange={(label) => save({ label })} className="h-9" />
        </Field>
        <Field label={c.endText}>
          <Blur value={cd.endText} onChange={(endText) => save({ endText })} className="h-9" />
        </Field>
      </div>
      <SwitchRow label={c.subathon} hint={c.subathonHint} checked={cd.subathon} onCheckedChange={(subathon) => save({ subathon })} />
      {cd.subathon && (
        <div className="grid gap-3 sm:grid-cols-4">
          {(
            [
              ["addFollowSec", c.perFollow],
              ["addSubSec", c.perSub],
              ["addPer100BitsSec", c.perBits],
              ["addPerCurrencySec", c.perMoney],
            ] as const
          ).map(([k, label]) => (
            <Field key={k} label={label}>
              <Blur value={String(cd[k])} onChange={(v) => save({ [k]: num(v, cd[k]) } as Partial<Countdown>)} className="h-9" />
            </Field>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="outline" disabled={!canAdd} onClick={() => add(c.cdTitle, "countdown=1")}>
          <Plus /> {t.alerts.addToScene}
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={() => copy("countdown=1")} aria-label={t.alerts.widgetUrl} title={t.alerts.widgetUrl}>
          <Copy />
        </Button>
      </div>
    </Section>
  );
}

/** Alerts & widgets tab: counters and the countdown / subathon timer. */
export function CountersPanel() {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Counters />
      <CountdownSection />
    </div>
  );
}
