/**
 * Generic renderer for OBS property schemas (obs_properties_t). Every change
 * calls `onChange(name, value)`; the parent sends just that key to the core
 * and re-renders from the schema it returns (modified callbacks may change
 * other properties' visibility, lists, etc.).
 */
import type { ListItem, Property } from "@vexcast/protocol";
import { ArrowDown, ArrowUp, ChevronDown, CircleAlert, Eye, EyeOff, FolderOpen, Info, Pencil, Plus, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/i18n";
import { promptDialog } from "@/lib/dialogs";
import { hexToRgb, obsToRgba, parseObsFilter, rgbaToHex, rgbaToObs } from "@/lib/obs";
import { isTauri, openExternal, pickFile, pickFiles, pickFolder, pickSaveFile } from "@/lib/tauri";
import { cn } from "@/lib/utils";

export interface PropertiesViewProps {
  properties: Property[];
  onChange: (name: string, value: unknown) => void;
  onButton?: (name: string) => void;
  disabled?: boolean;
  /** Label column width (tailwind class). */
  labelWidth?: string;
}

export function PropertiesView({ properties, onChange, onButton, disabled, labelWidth = "w-44" }: PropertiesViewProps) {
  return (
    <div className="flex flex-col gap-3" data-testid="properties-view">
      {properties
        .filter((p) => p.visible)
        .map((p) => (
          <PropertyRow key={p.name} p={p} onChange={onChange} onButton={onButton} disabled={disabled || !p.enabled} labelWidth={labelWidth} />
        ))}
    </div>
  );
}

function Row({ label, longDescription, children, labelWidth, htmlFor, top }: { label?: string; longDescription?: string | null; children: React.ReactNode; labelWidth: string; htmlFor?: string; top?: boolean }) {
  return (
    <div className={cn("flex gap-3", top ? "items-start" : "items-center")}>
      <div className={cn("flex shrink-0 items-center justify-end gap-1 text-right", labelWidth, top && "pt-2")}>
        {label && (
          <Label htmlFor={htmlFor} className="justify-end text-right leading-snug font-normal text-muted-foreground">
            {label}
          </Label>
        )}
        {longDescription && <HelpTip text={longDescription} />}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function HelpTip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="size-3.5 shrink-0 text-muted-foreground" />
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{text}</TooltipContent>
    </Tooltip>
  );
}

function PropertyRow({ p, onChange, onButton, disabled, labelWidth }: { p: Property; onChange: PropertiesViewProps["onChange"]; onButton?: PropertiesViewProps["onButton"]; disabled: boolean; labelWidth: string }) {
  const id = `prop-${p.name}`;
  const set = (v: unknown) => onChange(p.name, v);
  switch (p.type) {
    case "bool":
      return (
        <Row labelWidth={labelWidth}>
          <div className="flex items-center gap-2">
            <Checkbox id={id} checked={!!p.value} disabled={disabled} onCheckedChange={(v) => set(!!v)} />
            <Label htmlFor={id} className="font-normal">
              {p.description}
            </Label>
            {p.longDescription && <HelpTip text={p.longDescription} />}
          </div>
        </Row>
      );
    case "int":
    case "float":
      return (
        <Row label={p.description} longDescription={p.longDescription} labelWidth={labelWidth} htmlFor={id}>
          <NumberControl id={id} p={p} disabled={disabled} onCommit={set} />
        </Row>
      );
    case "text":
      if (p.textType === "info") return <Row labelWidth={labelWidth}><InfoBox p={p} /></Row>;
      return (
        <Row label={p.description} longDescription={p.longDescription} labelWidth={labelWidth} htmlFor={id} top={p.textType === "multiline"}>
          <TextControl id={id} p={p} disabled={disabled} onCommit={set} />
        </Row>
      );
    case "path":
      return (
        <Row label={p.description} longDescription={p.longDescription} labelWidth={labelWidth} htmlFor={id}>
          <PathControl id={id} p={p} disabled={disabled} onCommit={set} />
        </Row>
      );
    case "list":
      return (
        <Row label={p.description} longDescription={p.longDescription} labelWidth={labelWidth} htmlFor={id} top={p.listType === "radio"}>
          <ListControl id={id} p={p} disabled={disabled} onCommit={set} />
        </Row>
      );
    case "color":
    case "color_alpha":
      return (
        <Row label={p.description} longDescription={p.longDescription} labelWidth={labelWidth}>
          <ColorControl value={p.value} alpha={p.type === "color_alpha"} disabled={disabled} onCommit={set} />
        </Row>
      );
    case "button":
      return (
        <Row labelWidth={labelWidth}>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => (p.buttonType === "url" && p.url ? openExternal(p.url) : onButton?.(p.name))}
            data-testid={`prop-button-${p.name}`}
          >
            {p.description}
          </Button>
        </Row>
      );
    case "font":
      return (
        <Row label={p.description} longDescription={p.longDescription} labelWidth={labelWidth}>
          <FontControl value={p.value} disabled={disabled} onCommit={set} />
        </Row>
      );
    case "editable_list":
      return (
        <Row label={p.description} longDescription={p.longDescription} labelWidth={labelWidth} top>
          <EditableList p={p} disabled={disabled} onCommit={set} />
        </Row>
      );
    case "frame_rate":
      return (
        <Row label={p.description} longDescription={p.longDescription} labelWidth={labelWidth}>
          <FrameRateControl value={p.value} disabled={disabled} onCommit={set} />
        </Row>
      );
    case "group": {
      const checkable = p.groupType === "checkable";
      const on = !checkable || !!p.value;
      return (
        <fieldset className="rounded-lg border p-3 pt-2" data-testid={`group-${p.name}`}>
          <legend className="flex items-center gap-2 px-1 text-sm font-medium">
            {checkable && <Checkbox id={id} checked={!!p.value} disabled={disabled} onCheckedChange={(v) => set(!!v)} />}
            <Label htmlFor={id}>{p.description}</Label>
          </legend>
          <PropertiesView properties={p.properties ?? []} onChange={onChange} onButton={onButton} disabled={disabled || !on} labelWidth={labelWidth === "w-44" ? "w-40" : labelWidth} />
        </fieldset>
      );
    }
    default:
      return null;
  }
}

// ------------------------------------------------------------------ controls

/** Local draft for free-typing controls; commits after a pause, on blur or Enter. */
function useDraft<T>(value: T, onCommit: (v: T) => void, delay = 400) {
  const [draft, setDraft] = useState<T>(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = useRef(value);
  useEffect(() => {
    if (timer.current) return; // don't clobber while typing
    setDraft(value);
    last.current = value;
  }, [value]);
  const commit = (v: T) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (v !== last.current) {
      last.current = v;
      onCommit(v);
    }
  };
  const change = (v: T) => {
    setDraft(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(v), delay);
  };
  return { draft, change, commit: () => commit(draft) };
}

function NumberControl({ id, p, disabled, onCommit }: { id: string; p: Property; disabled: boolean; onCommit: (v: number) => void }) {
  const isInt = p.type === "int";
  const min = p.min ?? (isInt ? -2147483648 : -1e9);
  const max = p.max ?? (isInt ? 2147483647 : 1e9);
  const step = p.step ?? (isInt ? 1 : 0.01);
  const num = Number(p.value ?? 0);
  const norm = (v: number) => {
    let x = Math.min(max, Math.max(min, v));
    if (isInt) x = Math.round(x);
    else x = Math.round(x / step) * step;
    return Number(x.toFixed(6));
  };
  const { draft, change, commit } = useDraft(String(num), (s) => {
    const v = Number(s);
    if (Number.isFinite(v)) onCommit(norm(v));
  });
  const input = (
    <div className="relative w-full max-w-40">
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={disabled}
        onChange={(e) => change(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        className={cn("h-8 tabular-nums", p.suffix && "pr-12")}
      />
      {p.suffix && <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">{p.suffix.trim()}</span>}
    </div>
  );
  if (!p.slider) return input;
  return (
    <div className="flex items-center gap-3">
      <Slider className="flex-1" min={min} max={max} step={step} value={[Math.min(max, Math.max(min, num))]} disabled={disabled} onValueChange={([v]) => change(String(norm(v)))} onValueCommit={([v]) => onCommit(norm(v))} />
      {input}
    </div>
  );
}

function TextControl({ id, p, disabled, onCommit }: { id: string; p: Property; disabled: boolean; onCommit: (v: string) => void }) {
  const t = useT();
  const { draft, change, commit } = useDraft(String(p.value ?? ""), onCommit, 500);
  const [show, setShow] = useState(false);
  if (p.textType === "multiline")
    return (
      <Textarea
        id={id}
        value={draft}
        disabled={disabled}
        onChange={(e) => change(e.target.value)}
        onBlur={commit}
        rows={p.monospace ? 6 : 4}
        className={cn("min-h-20 resize-y", p.monospace && "font-mono text-xs")}
      />
    );
  if (p.textType === "password")
    return (
      <div className="flex gap-1.5">
        <Input id={id} type={show ? "text" : "password"} value={draft} disabled={disabled} onChange={(e) => change(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} className="h-8" />
        <Button variant="outline" size="icon-sm" className="size-8" onClick={() => setShow(!show)} aria-label={show ? t.common.hide : t.common.show}>
          {show ? <EyeOff /> : <Eye />}
        </Button>
      </div>
    );
  return <Input id={id} value={draft} disabled={disabled} onChange={(e) => change(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} className={cn("h-8", p.monospace && "font-mono text-xs")} />;
}

function InfoBox({ p }: { p: Property }) {
  const Icon = p.infoType === "error" ? CircleAlert : p.infoType === "warning" ? TriangleAlert : Info;
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
        p.infoType === "error" && "border-destructive/40 bg-destructive/5 text-destructive",
        p.infoType === "warning" && "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400",
        (!p.infoType || p.infoType === "normal") && "bg-muted/40 text-muted-foreground",
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span className="selectable whitespace-pre-wrap">{String(p.value || p.description)}</span>
    </div>
  );
}

function PathControl({ id, p, disabled, onCommit }: { id: string; p: Property; disabled: boolean; onCommit: (v: string) => void }) {
  const t = useT();
  const { draft, change, commit } = useDraft(String(p.value ?? ""), onCommit, 600);
  const browse = async () => {
    if (!isTauri()) {
      toast(t.props.browserOnly);
      return;
    }
    const filters = parseObsFilter(p.filter);
    const def = String(p.value || p.defaultPath || "") || undefined;
    const res = p.pathType === "directory" ? await pickFolder(def) : p.pathType === "file_save" ? await pickSaveFile(filters, def) : await pickFile(filters, def);
    if (res) {
      change(res);
      onCommit(res);
    }
  };
  return (
    <div className="flex gap-1.5">
      <Input id={id} value={draft} disabled={disabled} onChange={(e) => change(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} className="h-8 font-mono text-xs" />
      <Button variant="outline" size="sm" className="h-8 shrink-0" disabled={disabled} onClick={browse}>
        <FolderOpen /> {t.props.browse}
      </Button>
    </div>
  );
}

const sameValue = (a: unknown, b: unknown) => a === b || (a != null && b != null && String(a) === String(b));

function ListControl({ id, p, disabled, onCommit }: { id: string; p: Property; disabled: boolean; onCommit: (v: ListItem["value"]) => void }) {
  const items = p.items ?? [];
  const idx = items.findIndex((it) => sameValue(it.value, p.value));
  if (p.listType === "radio")
    return (
      <RadioGroup value={idx >= 0 ? String(idx) : undefined} onValueChange={(v) => onCommit(items[Number(v)].value)} disabled={disabled} className="gap-2 pt-1.5">
        {items.map((it, i) => (
          <div key={i} className="flex items-center gap-2">
            <RadioGroupItem value={String(i)} id={`${id}-${i}`} disabled={it.disabled} />
            <Label htmlFor={`${id}-${i}`} className="font-normal">
              {it.name}
            </Label>
          </div>
        ))}
      </RadioGroup>
    );
  if (p.listType === "editable") return <EditableCombo id={id} p={p} disabled={disabled} onCommit={(v) => onCommit(v)} />;
  return (
    <Select value={idx >= 0 ? String(idx) : undefined} onValueChange={(v) => onCommit(items[Number(v)].value)} disabled={disabled}>
      <SelectTrigger id={id} size="sm" className="w-full">
        <SelectValue placeholder={p.value == null || p.value === "" ? "—" : String(p.value)} />
      </SelectTrigger>
      <SelectContent>
        {items.map((it, i) => (
          <SelectItem key={i} value={String(i)} disabled={it.disabled}>
            {it.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Editable list = combobox: free text plus a dropdown of suggestions. */
function EditableCombo({ id, p, disabled, onCommit }: { id: string; p: Property; disabled: boolean; onCommit: (v: string | number) => void }) {
  const toVal = (s: string) => (p.format === "int" ? parseInt(s, 10) || 0 : p.format === "float" ? Number(s) || 0 : s);
  const { draft, change, commit } = useDraft(String(p.value ?? ""), (s) => onCommit(toVal(s)), 600);
  return (
    <div className="flex">
      <Input id={id} value={draft} disabled={disabled} onChange={(e) => change(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} className="h-8 rounded-r-none" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon-sm" className="size-8 rounded-l-none border-l-0" disabled={disabled}>
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
          {(p.items ?? []).map((it, i) => (
            <DropdownMenuItem
              key={i}
              disabled={it.disabled}
              onSelect={() => {
                change(String(it.value ?? ""));
                onCommit(it.value as string | number);
              }}
            >
              {it.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function ColorControl({ value, alpha, disabled, onCommit }: { value: unknown; alpha: boolean; disabled: boolean; onCommit: (v: number) => void }) {
  const t = useT();
  const rgba = obsToRgba(value);
  const hex = rgbaToHex(rgba);
  const [hexDraft, setHexDraft] = useState(hex);
  useEffect(() => setHexDraft(hex), [hex]);
  const label = alpha ? `${hex.toUpperCase()} · ${Math.round((rgba.a / 255) * 100)}%` : hex.toUpperCase();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 justify-start gap-2 font-mono text-xs" disabled={disabled}>
          <span className="checkerboard relative size-4 overflow-hidden rounded-sm border">
            <span className="absolute inset-0" style={{ background: hex, opacity: alpha ? rgba.a / 255 : 1 }} />
          </span>
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64" align="start">
        <div className="grid gap-3">
          <Label>{t.props.pickColor}</Label>
          <input
            type="color"
            value={hex}
            onChange={(e) => {
              const c = hexToRgb(e.target.value);
              if (c) onCommit(rgbaToObs({ ...rgba, ...c }));
            }}
            className="h-24 w-full cursor-pointer rounded-md border bg-transparent p-0"
          />
          <Input
            value={hexDraft}
            onChange={(e) => setHexDraft(e.target.value)}
            onBlur={() => {
              const c = hexToRgb(hexDraft);
              if (c) onCommit(rgbaToObs({ ...rgba, ...c }));
              else setHexDraft(hex);
            }}
            className="h-8 font-mono text-xs"
          />
          {alpha && (
            <div className="grid gap-2">
              <Label className="text-xs text-muted-foreground">
                {t.props.alpha}: {Math.round((rgba.a / 255) * 100)}%
              </Label>
              <Slider min={0} max={255} step={1} value={[rgba.a]} onValueChange={([a]) => onCommit(rgbaToObs({ ...rgba, a }))} />
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface FontValue {
  face: string;
  style: string;
  size: number;
  flags: number;
}
const FONT_FACES = ["Arial", "Calibri", "Cascadia Code", "Comic Sans MS", "Consolas", "Courier New", "Georgia", "Impact", "Inter", "Roboto", "Segoe UI", "Tahoma", "Times New Roman", "Trebuchet MS", "Verdana"];
const FONT_STYLES = ["Regular", "Bold", "Italic", "Bold Italic"];

function FontControl({ value, disabled, onCommit }: { value: unknown; disabled: boolean; onCommit: (v: FontValue) => void }) {
  const t = useT();
  const v = { face: "Arial", style: "Regular", size: 72, flags: 0, ...(value as Partial<FontValue> | null) };
  const [draft, setDraft] = useState(v);
  const styleFlags = (style: string) => (style.includes("Bold") ? 1 : 0) | (style.includes("Italic") ? 2 : 0);
  return (
    <Popover onOpenChange={(o) => o && setDraft(v)}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 max-w-full justify-start" disabled={disabled} data-testid="font-button">
          <span className="truncate" style={{ fontFamily: v.face, fontWeight: v.flags & 1 ? 700 : 400, fontStyle: v.flags & 2 ? "italic" : "normal" }}>
            {v.face} {v.style} {v.size}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <div className="grid gap-3">
          <Label>{t.props.selectFont}</Label>
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">{t.props.fontFace}</Label>
            <Input list="vexcast-font-faces" value={draft.face} onChange={(e) => setDraft({ ...draft, face: e.target.value })} className="h-8" />
            <datalist id="vexcast-font-faces">
              {FONT_FACES.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </div>
          <div className="grid grid-cols-[1fr_6rem] gap-2">
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">{t.props.fontStyle}</Label>
              <Select value={FONT_STYLES.includes(draft.style) ? draft.style : "Regular"} onValueChange={(s) => setDraft({ ...draft, style: s, flags: (draft.flags & ~3) | styleFlags(s) })}>
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FONT_STYLES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">{t.props.fontSize}</Label>
              <Input type="number" min={1} max={1024} value={draft.size} onChange={(e) => setDraft({ ...draft, size: Math.max(1, Number(e.target.value) || 1) })} className="h-8" />
            </div>
          </div>
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-center text-lg" style={{ fontFamily: draft.face, fontWeight: draft.flags & 1 ? 700 : 400, fontStyle: draft.flags & 2 ? "italic" : "normal" }}>
            AaBbCc 123
          </div>
          <Button size="sm" onClick={() => onCommit(draft)}>
            {t.ok}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface ListEntry {
  value: string;
  selected: boolean;
  hidden: boolean;
}

function EditableList({ p, disabled, onCommit }: { p: Property; disabled: boolean; onCommit: (v: ListEntry[]) => void }) {
  const t = useT();
  const entries: ListEntry[] = useMemo(
    () => (Array.isArray(p.value) ? (p.value as unknown[]).map((e) => (typeof e === "string" ? { value: e, selected: false, hidden: false } : { value: String((e as ListEntry).value ?? ""), selected: !!(e as ListEntry).selected, hidden: !!(e as ListEntry).hidden })) : []),
    [p.value],
  );
  const [sel, setSel] = useState<number | null>(null);
  const filters = parseObsFilter(p.filter);
  const commit = (next: ListEntry[]) => onCommit(next);
  const addValues = (vals: string[]) => vals.length && commit([...entries, ...vals.map((value) => ({ value, selected: false, hidden: false }))]);
  const addText = async () => {
    const v = await promptDialog({ title: p.editableListType === "strings" ? t.props.add : t.props.addPath, label: t.props.entryValue, defaultValue: "" });
    if (v?.trim()) addValues([v.trim()]);
  };
  const move = (d: -1 | 1) => {
    if (sel == null) return;
    const j = sel + d;
    if (j < 0 || j >= entries.length) return;
    const next = entries.slice();
    [next[sel], next[j]] = [next[j], next[sel]];
    setSel(j);
    commit(next);
  };
  return (
    <div className="flex gap-2">
      <ul className="h-32 min-w-0 flex-1 overflow-y-auto rounded-md border p-1 text-sm">
        {entries.map((e, i) => (
          <li
            key={i}
            onClick={() => setSel(i)}
            onDoubleClick={async () => {
              const v = await promptDialog({ title: t.props.edit, label: t.props.entryValue, defaultValue: e.value });
              if (v?.trim()) commit(entries.map((x, k) => (k === i ? { ...x, value: v.trim() } : x)));
            }}
            className={cn("cursor-default truncate rounded-sm px-2 py-1 font-mono text-xs hover:bg-accent/60", sel === i && "bg-accent")}
          >
            {e.value}
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-1">
        {p.editableListType === "strings" ? (
          <Button variant="outline" size="icon-sm" onClick={addText} disabled={disabled} aria-label={t.props.add}>
            <Plus />
          </Button>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon-sm" disabled={disabled} aria-label={t.props.add}>
                <Plus />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={async () => {
                  if (!isTauri()) return toast(t.props.browserOnly);
                  addValues(await pickFiles(filters));
                }}
              >
                {t.props.addFiles}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={async () => {
                  if (!isTauri()) return toast(t.props.browserOnly);
                  const d = await pickFolder();
                  if (d) addValues([d]);
                }}
              >
                {t.props.addDirectory}
              </DropdownMenuItem>
              {p.editableListType === "files_and_urls" && <DropdownMenuItem onSelect={addText}>{t.props.addPath}</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button
          variant="outline"
          size="icon-sm"
          disabled={disabled || sel == null}
          aria-label={t.props.edit}
          onClick={async () => {
            if (sel == null) return;
            const v = await promptDialog({ title: t.props.edit, label: t.props.entryValue, defaultValue: entries[sel].value });
            if (v?.trim()) commit(entries.map((x, k) => (k === sel ? { ...x, value: v.trim() } : x)));
          }}
        >
          <Pencil />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          disabled={disabled || sel == null}
          aria-label={t.props.remove}
          onClick={() => {
            if (sel == null) return;
            commit(entries.filter((_, k) => k !== sel));
            setSel(null);
          }}
        >
          <Trash2 />
        </Button>
        <Button variant="outline" size="icon-sm" disabled={disabled || sel == null || sel === 0} aria-label={t.props.moveUp} onClick={() => move(-1)}>
          <ArrowUp />
        </Button>
        <Button variant="outline" size="icon-sm" disabled={disabled || sel == null || sel === entries.length - 1} aria-label={t.props.moveDown} onClick={() => move(1)}>
          <ArrowDown />
        </Button>
      </div>
    </div>
  );
}

const COMMON_FPS: [string, number, number][] = [
  ["10", 10, 1],
  ["15", 15, 1],
  ["20", 20, 1],
  ["24 NTSC (23.976)", 24000, 1001],
  ["24", 24, 1],
  ["25", 25, 1],
  ["29.97", 30000, 1001],
  ["30", 30, 1],
  ["48", 48, 1],
  ["50", 50, 1],
  ["59.94", 60000, 1001],
  ["60", 60, 1],
  ["120", 120, 1],
  ["144", 144, 1],
];

function FrameRateControl({ value, disabled, onCommit }: { value: unknown; disabled: boolean; onCommit: (v: { numerator: number; denominator: number }) => void }) {
  const v = { numerator: 30, denominator: 1, ...(value as object | null) } as { numerator: number; denominator: number };
  const idx = COMMON_FPS.findIndex(([, n, d]) => n * v.denominator === d * v.numerator);
  return (
    <div className="flex items-center gap-2">
      <Select value={idx >= 0 ? String(idx) : "custom"} onValueChange={(s) => s !== "custom" && onCommit({ numerator: COMMON_FPS[Number(s)][1], denominator: COMMON_FPS[Number(s)][2] })} disabled={disabled}>
        <SelectTrigger size="sm" className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {COMMON_FPS.map(([l], i) => (
            <SelectItem key={l} value={String(i)}>
              {l}
            </SelectItem>
          ))}
          <SelectItem value="custom">{`${v.numerator}/${v.denominator}`}</SelectItem>
        </SelectContent>
      </Select>
      <Input type="number" min={1} value={v.numerator} disabled={disabled} onChange={(e) => onCommit({ ...v, numerator: Math.max(1, Number(e.target.value) || 1) })} className="h-8 w-24" />
      <span className="text-muted-foreground">/</span>
      <Input type="number" min={1} value={v.denominator} disabled={disabled} onChange={(e) => onCommit({ ...v, denominator: Math.max(1, Number(e.target.value) || 1) })} className="h-8 w-20" />
    </div>
  );
}
