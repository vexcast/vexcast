/** Small building blocks shared by the Vexcast tool panels (chat, alerts, bot, AI, remote). */
import { Check, Copy, Eye, EyeOff, Lightbulb } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/i18n";
import { copyText } from "@/lib/tauri";
import { cn } from "@/lib/utils";

/** Languages offered for captions / transcription ("" = auto / none). */
export const TRANSLATE_LANGS = ["", "es", "en", "fr", "de", "pt", "it", "ja"] as const;
/** Radix Select can't use "" as an item value. */
export const NONE = "__none";
export const toSelect = (v: string | null | undefined) => (v ? v : NONE);
export const fromSelect = (v: string) => (v === NONE ? "" : v);

/** A masked secret coming from the core ("••••…"). Sending it back keeps the stored value. */
export const isMasked = (v: string | null | undefined) => !!v && v.startsWith("••••");

/** Local draft of a settings object, saved explicitly. Resets when the stored value changes. */
export function useDraft<T>(value: T) {
  const [draft, setDraft] = useState(value);
  const key = JSON.stringify(value);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setDraft(value), [key]);
  const dirty = JSON.stringify(draft) !== key;
  const set = (p: Partial<T>) => setDraft((d) => ({ ...d, ...p }));
  return { draft, set, setDraft, dirty, reset: () => setDraft(value) };
}

/** Panel body: tab bar (with optional right-side controls) + scrolling content. */
export function PanelTabs<V extends string>({
  value,
  onValueChange,
  tabs,
  aside,
  children,
}: {
  value: V;
  onValueChange: (v: V) => void;
  tabs: { value: V; label: string; icon?: ReactNode }[];
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Tabs value={value} onValueChange={(v) => onValueChange(v as V)} className="flex h-full min-h-0 flex-col gap-0">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b px-6 py-2.5">
        <TabsList className="h-auto max-w-full flex-wrap justify-start">
          {tabs.map((tb) => (
            <TabsTrigger key={tb.value} value={tb.value} className="flex-none">
              {tb.icon}
              {tb.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {aside && <div className="ml-auto flex items-center gap-3">{aside}</div>}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-6">{children}</div>
      </ScrollArea>
    </Tabs>
  );
}

/** Like PanelTabs, with many sections: a grouped side menu (a select on narrow windows). */
export function PanelNav<V extends string>({
  value,
  onValueChange,
  groups,
  children,
}: {
  value: V;
  onValueChange: (v: V) => void;
  groups: { label: string; items: { value: V; label: string; icon?: ReactNode }[] }[];
  children: ReactNode;
}) {
  const all = groups.flatMap((g) => g.items);
  return (
    <Tabs value={value} onValueChange={(v) => onValueChange(v as V)} orientation="vertical" className="flex h-full min-h-0 flex-row gap-0">
      <nav className="hidden w-52 shrink-0 flex-col gap-4 overflow-y-auto border-r px-2.5 py-4 md:flex" aria-label="Secciones">
        {groups.map((g) => (
          <div key={g.label} className="flex flex-col gap-1">
            <span className="px-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{g.label}</span>
            <TabsList className="flex h-auto w-full flex-col items-stretch gap-0.5 bg-transparent p-0">
              {g.items.map((it) => (
                <TabsTrigger
                  key={it.value}
                  value={it.value}
                  className="h-8 w-full flex-none justify-start gap-2 rounded-md px-2 text-[13px] font-normal text-muted-foreground hover:bg-accent/60 hover:text-foreground data-[state=active]:bg-accent data-[state=active]:font-medium data-[state=active]:text-foreground data-[state=active]:shadow-none dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-accent [&_svg]:size-4"
                >
                  {it.icon}
                  <span className="truncate">{it.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        ))}
      </nav>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="shrink-0 border-b px-4 py-2 md:hidden">
          <Select value={value} onValueChange={(v) => onValueChange(v as V)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {all.map((it) => (
                <SelectItem key={it.value} value={it.value}>
                  {it.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-6">{children}</div>
        </ScrollArea>
      </div>
    </Tabs>
  );
}

/** Settings card with title, description and optional header action. */
export function Section({ title, description, action, icon, children, className }: { title: string; description?: string; action?: ReactNode; icon?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <Card className={cn("gap-4 py-5", className)}>
      <CardHeader className="px-5">
        <CardTitle className="flex items-center gap-2 text-sm [&_svg]:size-4 [&_svg]:text-muted-foreground">
          {icon}
          {title}
        </CardTitle>
        {description && <CardDescription className="text-xs">{description}</CardDescription>}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      {children && <CardContent className="flex flex-col gap-4 px-5">{children}</CardContent>}
    </Card>
  );
}

/** Label + control + hint (stacked). */
export function Field({ label, hint, children, className, htmlFor }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <Label htmlFor={htmlFor} className="text-xs">
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Label (+ hint) on the left, switch on the right. */
export function SwitchRow({ label, hint, checked, onCheckedChange, disabled }: { label: string; hint?: string; checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <Label htmlFor={id} className="text-sm font-normal">
          {label}
        </Label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  );
}

/** Password-style input with a show/hide toggle. */
export function SecretInput({ value, onChange, placeholder, className, id }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; id?: string }) {
  const t = useT();
  const [show, setShow] = useState(false);
  return (
    <div className={cn("relative min-w-0", className)}>
      <Input
        id={id}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className="pr-9 font-mono text-xs"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute top-1/2 right-0.5 size-7 -translate-y-1/2 text-muted-foreground"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? t.common.hide : t.common.show}
      >
        {show ? <EyeOff /> : <Eye />}
      </Button>
    </div>
  );
}

/** Read-only value with a copy button (optionally masked). */
export function CopyField({ value, secret, className }: { value: string; secret?: boolean; className?: string }) {
  const t = useT();
  const [show, setShow] = useState(!secret);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (await copyText(value)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } else toast.error(t.common.copyFailed);
  };
  return (
    <div className={cn("flex min-w-0 items-center gap-1.5", className)}>
      <Input readOnly value={show ? value : "•".repeat(Math.min(24, value.length || 8))} className="min-w-0 flex-1 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
      {secret && (
        <Button type="button" variant="outline" size="icon" onClick={() => setShow((s) => !s)} aria-label={show ? t.common.hide : t.common.show}>
          {show ? <EyeOff /> : <Eye />}
        </Button>
      )}
      <Button type="button" variant="outline" size="icon" onClick={copy} aria-label={t.common.copy} title={copied ? t.common.copied : t.common.copy}>
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}

/** Sticky footer shown while a draft has unsaved changes. */
export function SaveBar({ dirty, onSave, onReset, saving }: { dirty: boolean; onSave: () => void; onReset: () => void; saving?: boolean }) {
  const t = useT();
  if (!dirty) return null;
  return (
    <div className="sticky bottom-0 z-10 -mx-6 -mb-6 mt-4 flex items-center gap-2 border-t bg-background px-6 py-3">
      <span className="mr-auto text-xs text-muted-foreground">{t.common.unsavedChanges}</span>
      <Button size="sm" variant="ghost" onClick={onReset} disabled={saving}>
        {t.common.reset}
      </Button>
      <Button size="sm" onClick={onSave} disabled={saving}>
        {t.common.save}
      </Button>
    </div>
  );
}

/** Muted help box with an optional copyable command. */
export function Hint({ children, cmd }: { children: ReactNode; cmd?: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-md border bg-muted/40 p-3">
      <Lightbulb className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
        {children}
        {cmd && <CopyField value={cmd} className="mt-2" />}
      </div>
    </div>
  );
}

/** Numbered list of steps. */
export function Steps({ steps }: { steps: string[] }) {
  return (
    <ol className="flex flex-col gap-2.5">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-3 text-sm leading-relaxed text-muted-foreground">
          <span className="grid size-5 shrink-0 place-items-center rounded-full border bg-muted text-[11px] font-medium text-foreground">{i + 1}</span>
          <span className="min-w-0">{s}</span>
        </li>
      ))}
    </ol>
  );
}

/** Parse a number input, keeping the previous value when empty/invalid. */
export const num = (v: string, prev: number) => {
  const n = Number(v);
  return v.trim() === "" || Number.isNaN(n) ? prev : n;
};
