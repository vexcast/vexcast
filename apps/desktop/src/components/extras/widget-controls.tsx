import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useT } from "@/i18n";
import { GOOGLE_FONTS } from "@/components/alerts/designs";
import { Field } from "./shared";

/** Color swatch (native picker) + hex text. */
export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const hex = /^#[0-9a-f]{6}/i.test(value) ? value.slice(0, 7) : "#ffffff";
  return (
    <Field label={label}>
      <div className="flex items-center gap-1.5">
        <span className="relative size-9 shrink-0 cursor-pointer overflow-hidden rounded-md border" style={{ background: value || "transparent" }}>
          <input type="color" value={hex} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label={label} />
        </span>
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="min-w-0 font-mono text-xs" spellCheck={false} />
      </div>
    </Field>
  );
}

const DEFAULT_FONT = "__default";

/** Google fonts list + "default" + any name typed by hand. */
export function FontField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const t = useT();
  const fonts = !value || GOOGLE_FONTS.includes(value) ? GOOGLE_FONTS : [value, ...GOOGLE_FONTS];
  return (
    <Field label={label}>
      <div className="grid gap-1.5">
        <Select value={value || DEFAULT_FONT} onValueChange={(v) => onChange(v === DEFAULT_FONT ? "" : v)}>
          <SelectTrigger className="w-full min-w-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value={DEFAULT_FONT}>{t.look.defaultFont}</SelectItem>
            {fonts.map((f) => (
              <SelectItem key={f} value={f}>
                <span style={{ fontFamily: `'${f}', system-ui` }}>{f}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={t.look.otherFont} className="h-8 text-xs" />
      </div>
    </Field>
  );
}

/** Slider with its value in the label. */
export function SliderField({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void }) {
  const shown = Number.isInteger(step) ? Math.round(value) : value.toFixed(step < 0.1 ? 2 : 1);
  return (
    <Field label={`${label} · ${shown}${unit ?? ""}`}>
      <Slider min={min} max={max} step={step} value={[Math.min(max, Math.max(min, value))]} onValueChange={([v]) => onChange(v)} className="my-auto py-2" />
    </Field>
  );
}

/** Small segmented choice. */
export function Segmented<V extends string>({ label, value, options, onChange }: { label: string; value: V; options: { value: V; label: string }[]; onChange: (v: V) => void }) {
  return (
    <Field label={label}>
      <div className="inline-flex w-full rounded-md border p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={value === o.value}
            className={"flex-1 rounded-sm px-2 py-1 text-xs transition-colors " + (value === o.value ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {o.label}
          </button>
        ))}
      </div>
    </Field>
  );
}
