import type { AlertType, Macro, MacroStep, MacroStepKind } from "@vexcast/protocol";
import { ArrowDown, ArrowUp, Pencil, Play, Plus, Trash2, Zap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/i18n";
import { confirmDialog } from "@/lib/dialogs";
import { fmt } from "@/lib/format";
import { act, flattenItems, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Dock, ToolButton } from "./dock";

const EMPTY_COUNTERS: import("@vexcast/protocol").Counter[] = [];
const KINDS: MacroStepKind[] = ["scene", "title", "chat", "stream", "record", "replay", "tts", "mute", "visibility", "alert", "counter", "countdown", "wait"];
const COLORS = ["", "#ef4444", "#f59e0b", "#22c55e", "#06b6d4", "#3b82f6", "#a855f7", "#ec4899"];
const ALERTS: AlertType[] = ["follow", "subscription", "gift_sub", "raid", "bits", "superchat", "donation", "member", "host"];
const EMPTY_MACROS: Macro[] = [];

const newId = () => Math.random().toString(36).slice(2, 14);
const defaultValue = (k: MacroStepKind): Record<string, unknown> => (k === "stream" || k === "record" ? { action: "start" } : k === "wait" ? { ms: 2000 } : k === "alert" ? { type: "follow" } : k === "counter" ? { delta: 1 } : k === "countdown" ? { action: "start", seconds: 300 } : {});

/** Fields of one step. */
function StepFields({ step, onChange }: { step: MacroStep; onChange: (v: Record<string, unknown>) => void }) {
  const t = useT();
  const m = t.macros;
  const scenes = useStore((s) => s.state?.scenes ?? []);
  const sources = useStore((s) => s.state?.sources ?? []);
  const counters = useStore((st) => st.state?.counters ?? EMPTY_COUNTERS);
  const v = step.value as Record<string, string | number | boolean | undefined>;
  const set = (patch: Record<string, unknown>) => onChange({ ...step.value, ...patch });
  const sel = (value: string, placeholder: string, options: { value: string; label: string }[], key: string) => (
    <Select value={value || undefined} onValueChange={(x) => set({ [key]: x })}>
      <SelectTrigger size="sm" className="min-w-0 flex-1">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  const tri = (key: string, labels: [string, string, string]) => (
    <Select value={v[key] === undefined ? "toggle" : String(v[key])} onValueChange={(x) => set({ [key]: x === "toggle" ? undefined : x === "true" })}>
      <SelectTrigger size="sm" className="w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="toggle">{labels[0]}</SelectItem>
        <SelectItem value="true">{labels[1]}</SelectItem>
        <SelectItem value="false">{labels[2]}</SelectItem>
      </SelectContent>
    </Select>
  );
  switch (step.kind) {
    case "scene":
      return sel(String(v.scene ?? ""), m.scenePh, scenes.map((s) => ({ value: s.uuid, label: s.name })), "scene");
    case "stream":
    case "record":
      return sel(String(v.action ?? "start"), "", [{ value: "start", label: m.start }, { value: "stop", label: m.stop }], "action");
    case "chat":
    case "tts":
      return <Input value={String(v.text ?? "")} onChange={(e) => set({ text: e.target.value })} placeholder={m.textPh} className="h-8 min-w-0 flex-1" />;
    case "title":
      return (
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Input value={String(v.title ?? "")} onChange={(e) => set({ title: e.target.value })} placeholder={m.titlePh} className="h-8" />
          <Input value={String(v.category ?? "")} onChange={(e) => set({ category: e.target.value })} placeholder={m.categoryPh} className="h-8" />
        </div>
      );
    case "mute":
      return (
        <div className="flex min-w-0 flex-1 gap-1.5">
          {sel(String(v.source ?? ""), m.sourcePh, sources.filter((s) => s.audio).map((s) => ({ value: s.uuid, label: s.name })), "source")}
          {tri("muted", [m.toggle, m.off, m.on])}
        </div>
      );
    case "visibility": {
      const scene = scenes.find((s) => s.uuid === v.scene);
      return (
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {sel(String(v.scene ?? ""), m.scenePh, scenes.map((s) => ({ value: s.uuid, label: s.name })), "scene")}
          <div className="flex gap-1.5">
            <Select value={v.item === undefined ? undefined : String(v.item)} onValueChange={(x) => set({ item: Number(x) })}>
              <SelectTrigger size="sm" className="min-w-0 flex-1">
                <SelectValue placeholder={m.itemPh} />
              </SelectTrigger>
              <SelectContent>
                {flattenItems(scene?.items ?? []).map((i) => (
                  <SelectItem key={i.id} value={String(i.id)}>
                    {i.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {tri("visible", [m.toggle, m.show, m.hide])}
          </div>
        </div>
      );
    }
    case "alert":
      return sel(String(v.type ?? "follow"), "", ALERTS.map((a) => ({ value: a, label: t.alerts.types[a as keyof typeof t.alerts.types] ?? a })), "type");
    case "counter":
      return (
        <div className="flex min-w-0 flex-1 gap-1.5">
          {sel(String(v.counter ?? ""), m.counterPh, counters.map((c) => ({ value: c.id, label: c.name })), "counter")}
          <Input type="number" value={Number(v.delta ?? 1)} onChange={(e) => set({ delta: Math.round(Number(e.target.value) || 0) })} className="h-8 w-20" title={m.delta} />
          <Select value={v.set ? "set" : "add"} onValueChange={(x) => set({ set: x === "set" })}>
            <SelectTrigger size="sm" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="add">{m.counterAdd}</SelectItem>
              <SelectItem value="set">{m.counterSet}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      );
    case "countdown":
      return (
        <div className="flex min-w-0 flex-1 gap-1.5">
          {sel(String(v.action ?? "start"), "", (["start", "add", "pause", "resume", "stop"] as const).map((a) => ({ value: a, label: m.cd[a] })), "action")}
          {(v.action ?? "start") === "start" || v.action === "add" ? (
            <div className="flex items-center gap-1">
              <Input type="number" value={Math.round(Number(v.seconds ?? 300) / 60)} onChange={(e) => set({ seconds: Math.round((Number(e.target.value) || 0) * 60) })} className="h-8 w-20" />
              <span className="text-xs text-muted-foreground">min</span>
            </div>
          ) : null}
        </div>
      );
    case "wait":
      return (
        <div className="flex items-center gap-2">
          <Input type="number" min={0.1} max={60} step={0.5} value={Number(v.ms ?? 1000) / 1000} onChange={(e) => set({ ms: Math.round(Math.min(60, Math.max(0.1, Number(e.target.value) || 1)) * 1000) })} className="h-8 w-24" />
          <span className="text-xs text-muted-foreground">{m.seconds}</span>
        </div>
      );
    default:
      return null;
  }
}

function MacroEditor({ macro, onClose }: { macro: Macro | null; onClose: () => void }) {
  const t = useT();
  const m = t.macros;
  const macros = useStore((s) => s.state?.macros ?? EMPTY_MACROS);
  const [d, setD] = useState<Macro | null>(macro);
  if (!d) return null;
  const isNew = !macros.some((x) => x.id === d.id);
  const setStep = (i: number, s: MacroStep) => setD({ ...d, steps: d.steps.map((x, j) => (j === i ? s : x)) });
  const move = (i: number, dir: -1 | 1) => {
    const steps = [...d.steps];
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    [steps[i], steps[j]] = [steps[j], steps[i]];
    setD({ ...d, steps });
  };
  const save = async () => {
    const next = isNew ? [...macros, d] : macros.map((x) => (x.id === d.id ? d : x));
    if (await act((c) => c.setMacros(next), t.common.saved)) onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[min(720px,calc(100dvh-2rem))] flex-col overflow-hidden sm:max-w-xl" data-testid="macro-editor">
        <DialogHeader>
          <DialogTitle>{isNew ? m.new : m.edit}</DialogTitle>
          <DialogDescription>{fmt(m.hotkeyHint, { name: d.name || m.namePh })}</DialogDescription>
        </DialogHeader>
        <div className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6">
          <div className="flex flex-col gap-4 pb-1">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="macro-name" className="text-xs">
                  {m.name}
                </Label>
                <Input id="macro-name" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder={m.namePh} autoFocus />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">{m.color}</Label>
                <div className="flex h-9 items-center gap-1">
                  {COLORS.map((c) => (
                    <button
                      key={c || "none"}
                      type="button"
                      aria-label={c || "—"}
                      onClick={() => setD({ ...d, color: c })}
                      className={cn("size-5 rounded-full border", d.color === c && "ring-2 ring-primary ring-offset-1 ring-offset-background", !c && "bg-muted")}
                      style={c ? { background: c } : undefined}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="grid gap-2">
              <Label className="text-xs">{m.steps}</Label>
              {d.steps.length === 0 && <p className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">{m.noSteps}</p>}
              {d.steps.map((s, i) => (
                <div key={i} className="flex items-start gap-2 rounded-md border p-2">
                  <span className="mt-1.5 grid size-5 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-medium">{i + 1}</span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className="text-xs font-medium">{m.kinds[s.kind]}</span>
                    <div className="flex min-w-0 gap-1.5">
                      <StepFields step={s} onChange={(value) => setStep(i, { ...s, value })} />
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col">
                    <ToolButton icon={ArrowUp} label={m.moveUp} disabled={i === 0} onClick={() => move(i, -1)} />
                    <ToolButton icon={ArrowDown} label={m.moveDown} disabled={i === d.steps.length - 1} onClick={() => move(i, 1)} />
                    <ToolButton icon={Trash2} label={m.removeStep} onClick={() => setD({ ...d, steps: d.steps.filter((_, j) => j !== i) })} />
                  </div>
                </div>
              ))}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="self-start" data-testid="macro-add-step">
                    <Plus /> {m.addStep}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-60">
                  {KINDS.map((k) => (
                    <DropdownMenuItem key={k} onSelect={() => setD({ ...d, steps: [...d.steps, { kind: k, value: defaultValue(k) }] })}>
                      {m.kinds[k]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {!isNew ? (
            <Button
              variant="ghost"
              className="text-destructive"
              onClick={async () => {
                if (await confirmDialog({ title: fmt(m.deleteConfirm, { name: d.name }), destructive: true, confirmLabel: t.common.delete })) {
                  if (await act((c) => c.setMacros(macros.filter((x) => x.id !== d.id)))) onClose();
                }
              }}
            >
              <Trash2 /> {m.delete}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              {t.common.cancel}
            </Button>
            <Button onClick={save} disabled={!d.name.trim() || d.steps.length === 0} data-testid="macro-save">
              {m.save}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Buttons that run macros, and their editor. */
export function MacrosDock() {
  const t = useT();
  const m = t.macros;
  const macros = useStore((s) => s.state?.macros ?? EMPTY_MACROS);
  const [editing, setEditing] = useState<Macro | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const run = async (x: Macro) => {
    setRunning(x.id);
    const r = await act((c) => c.runMacro(x.id));
    setRunning(null);
    if (r !== undefined) toast.success(fmt(m.ran, { name: x.name }));
  };
  return (
    <Dock
      title={m.dock}
      testId="dock-macros"
      toolbar={
        <>
          <ToolButton icon={Plus} label={m.new} onClick={() => setEditing({ id: newId(), name: "", color: "", steps: [] })} testId="macro-new" />
        </>
      }
    >
      <ScrollArea className="h-full">
        {macros.length === 0 ? (
          <div className="flex flex-col items-center gap-3 p-4 text-center">
            <Zap className="size-6 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">{m.empty}</p>
            <Button size="sm" variant="outline" onClick={() => setEditing({ id: newId(), name: "", color: "", steps: [] })}>
              <Plus /> {m.new}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-1.5 p-2">
            {macros.map((x) => (
              <div key={x.id} className="group relative">
                <Button
                  variant="outline"
                  className="h-auto min-h-12 w-full flex-col items-start gap-0.5 px-2.5 py-2 text-left whitespace-normal"
                  style={x.color ? { borderColor: x.color, background: `${x.color}1a` } : undefined}
                  onClick={() => run(x)}
                  disabled={running === x.id}
                  data-testid={`macro-${x.id}`}
                >
                  <span className="flex w-full items-center gap-1.5 text-sm font-medium">
                    <Play className="size-3 shrink-0" style={x.color ? { color: x.color } : undefined} />
                    <span className="min-w-0 truncate">{x.name}</span>
                  </span>
                  <span className="text-[10px] text-muted-foreground">{fmt("{n} ", { n: x.steps.length })}{m.steps.toLowerCase()}</span>
                </Button>
                <button
                  type="button"
                  aria-label={m.edit}
                  title={m.edit}
                  onClick={() => setEditing(x)}
                  className="absolute top-1 right-1 grid size-6 place-items-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100"
                >
                  <Pencil className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
      {editing && <MacroEditor macro={editing} onClose={() => setEditing(null)} />}
    </Dock>
  );
}
