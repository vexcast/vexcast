import { ALIGN, type BoundsType, type SceneItem } from "@vexcast/protocol";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useT } from "@/i18n";
import { useDialogs } from "@/lib/dialogs";
import { fmt, throttle } from "@/lib/format";
import { act, findItem, findScene, useStore } from "@/lib/store";
import { croppedSize } from "@/lib/transform";
import { cn } from "@/lib/utils";

const ALIGN_GRID = [
  ALIGN.TOP | ALIGN.LEFT,
  ALIGN.TOP,
  ALIGN.TOP | ALIGN.RIGHT,
  ALIGN.LEFT,
  ALIGN.CENTER,
  ALIGN.RIGHT,
  ALIGN.BOTTOM | ALIGN.LEFT,
  ALIGN.BOTTOM,
  ALIGN.BOTTOM | ALIGN.RIGHT,
];
const BOUNDS: BoundsType[] = ["none", "stretch", "scale_inner", "scale_outer", "scale_to_width", "scale_to_height", "max_only"];

function Num({ value, onChange, step = 1, min, suffix, testId, disabled }: { value: number; onChange: (v: number) => void; step?: number; min?: number; suffix?: string; testId?: string; disabled?: boolean }) {
  const [draft, setDraft] = useState(String(round(value)));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(String(round(value)));
  }, [value]);
  const commit = (s: string) => {
    const v = Number(s);
    if (Number.isFinite(v)) onChange(min != null ? Math.max(min, v) : v);
  };
  return (
    <div className="relative">
      <Input
        type="number"
        step={step}
        min={min}
        value={draft}
        disabled={disabled}
        data-testid={testId}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          commit(draft);
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          commit(e.target.value);
        }}
        className={cn("h-8 tabular-nums", suffix && "pr-9")}
      />
      {suffix && <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>}
    </div>
  );
}
const round = (v: number) => Math.round(v * 1000) / 1000;

function AlignGrid({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  const t = useT();
  return (
    <div className="grid w-fit grid-cols-3 gap-1 rounded-md border p-1">
      {ALIGN_GRID.map((a, i) => (
        <button
          key={a}
          type="button"
          disabled={disabled}
          title={t.transform.alignNames[i]}
          aria-label={t.transform.alignNames[i]}
          aria-pressed={value === a}
          onClick={() => onChange(a)}
          className={cn("grid size-6 place-items-center rounded-sm hover:bg-accent disabled:opacity-50", value === a && "bg-primary hover:bg-primary")}
        >
          <span className={cn("size-1.5 rounded-full", value === a ? "bg-primary-foreground" : "bg-muted-foreground/50")} />
        </button>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[11rem_1fr] items-center gap-3">
      <Label className="justify-end text-right font-normal text-muted-foreground">{label}</Label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function TransformDialog() {
  const t = useT();
  const target = useDialogs((d) => d.transform);
  const close = useDialogs((d) => d.close);
  const item = useStore((s) => (target ? findItem(s.state ? findScene(s.state, target.scene) : null, target.item) : null));
  const [local, setLocal] = useState<SceneItem | null>(null);
  useEffect(() => setLocal(item), [item]);
  const sendRef = useRef(
    throttle((scene: string, id: number, patch: Partial<SceneItem>) => {
      act((c) => c.updateItem(scene, id, patch));
    }, 60),
  );

  if (!target) return null;
  const it = local ?? item;
  const update = (patch: Partial<SceneItem>) => {
    if (!it) return;
    setLocal({ ...it, ...patch });
    sendRef.current(target.scene, it.id, patch);
  };
  const c = it ? croppedSize(it) : { w: 0, h: 0 };
  const bounded = !!it && it.boundsType !== "none";

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && close("transform")}>
      <DialogContent className="sm:max-w-xl" data-testid="transform-dialog">
        <DialogHeader>
          <DialogTitle>{fmt(t.transform.title, { name: it?.name ?? "" })}</DialogTitle>
          <DialogDescription className="sr-only">{t.transform.position}</DialogDescription>
        </DialogHeader>
        {it && (
          <div className="grid gap-3">
            <Field label={t.transform.position}>
              <div className="grid grid-cols-2 gap-2">
                <Num value={it.pos.x} step={1} suffix="px" onChange={(x) => update({ pos: { ...it.pos, x } })} testId="tr-pos-x" />
                <Num value={it.pos.y} step={1} suffix="px" onChange={(y) => update({ pos: { ...it.pos, y } })} testId="tr-pos-y" />
              </div>
            </Field>
            <Field label={t.transform.rotation}>
              <div className="grid grid-cols-2 gap-2">
                <Num value={it.rot} step={0.5} suffix="°" onChange={(rot) => update({ rot: ((rot % 360) + 360) % 360 })} />
              </div>
            </Field>
            <Field label={t.transform.size}>
              <div className="grid grid-cols-2 gap-2">
                <Num value={c.w * Math.abs(it.scale.x)} min={1} suffix="px" disabled={bounded} onChange={(w) => c.w > 0 && update({ scale: { ...it.scale, x: Math.sign(it.scale.x || 1) * (w / c.w) } })} />
                <Num value={c.h * Math.abs(it.scale.y)} min={1} suffix="px" disabled={bounded} onChange={(h) => c.h > 0 && update({ scale: { ...it.scale, y: Math.sign(it.scale.y || 1) * (h / c.h) } })} />
              </div>
            </Field>
            <Field label={t.transform.alignment}>
              <AlignGrid value={it.alignment} onChange={(alignment) => update({ alignment })} />
            </Field>
            <Separator />
            <Field label={t.transform.boundsType}>
              <Select
                value={it.boundsType}
                onValueChange={(v) => {
                  const bt = v as BoundsType;
                  const patch: Partial<SceneItem> = { boundsType: bt };
                  if (bt !== "none" && (it.bounds.x <= 0 || it.bounds.y <= 0)) patch.bounds = { x: c.w * Math.abs(it.scale.x), y: c.h * Math.abs(it.scale.y) };
                  update(patch);
                }}
              >
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BOUNDS.map((b) => (
                    <SelectItem key={b} value={b}>
                      {t.transform.boundsTypes[b]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t.transform.boundsAlignment}>
              <AlignGrid value={it.boundsAlignment} disabled={!bounded} onChange={(boundsAlignment) => update({ boundsAlignment })} />
            </Field>
            <Field label={t.transform.boundsSize}>
              <div className="grid grid-cols-2 gap-2">
                <Num value={it.bounds.x} min={1} suffix="px" disabled={!bounded} onChange={(x) => update({ bounds: { ...it.bounds, x } })} />
                <Num value={it.bounds.y} min={1} suffix="px" disabled={!bounded} onChange={(y) => update({ bounds: { ...it.bounds, y } })} />
              </div>
            </Field>
            <Field label="">
              <div className="flex items-center gap-2">
                <Checkbox id="crop-bounds" checked={it.cropToBounds} disabled={!bounded} onCheckedChange={(v) => update({ cropToBounds: !!v })} />
                <Label htmlFor="crop-bounds" className="font-normal">
                  {t.transform.cropToBounds}
                </Label>
              </div>
            </Field>
            <Separator />
            <Field label={t.transform.crop}>
              <div className="grid grid-cols-4 gap-2">
                {(["left", "top", "right", "bottom"] as const).map((side) => (
                  <div key={side} className="grid gap-1">
                    <span className="text-[11px] text-muted-foreground">{t.transform[side]}</span>
                    <Num value={it.crop[side]} min={0} onChange={(v) => update({ crop: { ...it.crop, [side]: Math.round(v) } })} testId={`tr-crop-${side}`} />
                  </div>
                ))}
              </div>
            </Field>
          </div>
        )}
        <DialogFooter className="sm:justify-between">
          <Button variant="outline" onClick={() => it && act((c) => c.transformItem(target.scene, it.id, "reset"))}>
            {t.transform.reset}
          </Button>
          <Button onClick={() => close("transform")}>{t.common.close}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
