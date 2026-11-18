import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export function Section({ title, description, children, actions }: { title: string; description?: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="grid gap-4">
      <div className="flex items-end gap-2 border-b pb-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        <div className="ml-auto">{actions}</div>
      </div>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

export function FormRow({ label, htmlFor, children, hint, top }: { label?: string; htmlFor?: string; children: React.ReactNode; hint?: string; top?: boolean }) {
  return (
    <div className={cn("grid grid-cols-[14rem_1fr] gap-4", top ? "items-start" : "items-center")}>
      <Label htmlFor={htmlFor} className={cn("justify-end text-right leading-snug font-normal text-muted-foreground", top && "pt-2")}>
        {label}
      </Label>
      <div className="min-w-0">
        {children}
        {hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

export function SwitchRow({ id, label, checked, onChange, hint, disabled }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string; disabled?: boolean }) {
  return (
    <FormRow hint={hint}>
      <div className="flex items-center gap-2.5">
        <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
        <Label htmlFor={id} className="font-normal">
          {label}
        </Label>
      </div>
    </FormRow>
  );
}

export function NumberField({
  id,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  className,
  disabled,
}: {
  id?: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [d, setD] = useState(String(value));
  useEffect(() => setD(String(value)), [value]);
  const commit = (s: string) => {
    let v = Number(s);
    if (!Number.isFinite(v) || s.trim() === "") return;
    if (min != null) v = Math.max(min, v);
    if (max != null) v = Math.min(max, v);
    if (v !== value) onChange(v);
  };
  return (
    <div className={cn("relative w-40", className)}>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        value={d}
        disabled={disabled}
        onChange={(e) => {
          setD(e.target.value);
          commit(e.target.value);
        }}
        onBlur={() => setD(String(value))}
        className={cn("h-8 tabular-nums", suffix && "pr-12")}
      />
      {suffix && <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>}
    </div>
  );
}

export interface Option {
  value: string;
  label: string;
  group?: string;
  disabled?: boolean;
}

export function SelectField({ id, value, onChange, options, className, disabled, placeholder }: { id?: string; value: string; onChange: (v: string) => void; options: Option[]; className?: string; disabled?: boolean; placeholder?: string }) {
  const groups = [...new Set(options.map((o) => o.group ?? ""))];
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} size="sm" className={cn("w-full max-w-sm", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {groups.map((g) =>
          g ? (
            <SelectGroup key={g}>
              <SelectLabel>{g}</SelectLabel>
              {options
                .filter((o) => o.group === g)
                .map((o) => (
                  <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
                    {o.label}
                  </SelectItem>
                ))}
            </SelectGroup>
          ) : (
            options
              .filter((o) => !o.group)
              .map((o) => (
                <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
                  {o.label}
                </SelectItem>
              ))
          ),
        )}
      </SelectContent>
    </Select>
  );
}
