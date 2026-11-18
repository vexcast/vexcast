/** Alert designer side panel: the selected element (or the alert's own settings), in simple sections. */
import type { AlertDesign, AlertLayer } from "@vexcast/protocol";
import { AlignCenter, AlignLeft, AlignRight, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart, ChevronDown, Copy, FolderOpen, Loader2, Trash2 } from "lucide-react";
import { forwardRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useT } from "@/i18n";
import { act, useStore } from "@/lib/store";
import { isTauri, pickFile } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { AlertPlacement } from "./alert-placement";
import { ANIMS_IN, ANIMS_OUT, GOOGLE_FONTS, LOOPS, PARTICLE_MODES, PARTICLE_TYPES, TEXT_EFFECTS } from "./designs";

const IMAGE_EXT = ["png", "gif", "webp", "apng", "jpg", "jpeg", "svg", "webm", "mp4", "mov"];
const VIDEO_EXT = ["webm", "mp4", "mov"];
const SOUND_EXT = ["mp3", "ogg", "wav", "m4a"];

// ------------------------------------------------------------------ building blocks

export function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-b last:border-b-0">
      <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-2.5 text-xs font-semibold hover:bg-accent/40">
        {title}
        <ChevronDown className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-3 px-4 pb-4">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function Row({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-[11px] leading-snug text-muted-foreground/80">{hint}</span>}
    </div>
  );
}

function Num({ value, onChange, step = 1, min, max }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number }) {
  return (
    <Input
      type="number"
      step={step}
      min={min}
      max={max}
      value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
      onChange={(e) => {
        const n = parseFloat(e.target.value);
        if (Number.isFinite(n)) onChange(n);
      }}
      className="h-8 px-2 text-xs tabular-nums"
    />
  );
}

/** Slider + number, for sizes. */
function SliderNum({ value, onChange, min, max, step = 1, unit }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number; unit?: string }) {
  return (
    <div className="flex items-center gap-2">
      <Slider min={min} max={max} step={step} value={[Math.min(max, Math.max(min, value))]} onValueChange={([v]) => onChange(v)} className="flex-1" />
      <div className="relative w-20 shrink-0">
        <Num value={value} onChange={onChange} step={step} min={min} />
        {unit && <span className="pointer-events-none absolute top-1/2 right-6 -translate-y-1/2 text-[10px] text-muted-foreground">{unit}</span>}
      </div>
    </div>
  );
}

function Color({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const hex = /^#[0-9a-f]{6}/i.test(value) ? value.slice(0, 7) : "#ffffff";
  return (
    <div className="flex items-center gap-1.5">
      <span className="relative size-8 shrink-0 cursor-pointer overflow-hidden rounded-md border" style={{ background: value || "transparent" }}>
        <input type="color" value={hex} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
      </span>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-8 min-w-0 px-2 font-mono text-[11px]" spellCheck={false} />
    </div>
  );
}

function Choice<V extends string>({ value, options, onChange }: { value: V; options: { value: V; label: string }[]; onChange: (v: V) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as V)}>
      <SelectTrigger className="h-8 w-full text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="text-xs">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const FX_ICON: Record<(typeof PARTICLE_TYPES)[number], string> = { confetti: "🎊", sparkles: "✨", hearts: "💖", stars: "⭐", snow: "❄️", bubbles: "🫧", emoji: "😀" };
const FX_PALETTES = [
  ["#ff5e7e", "#ffd166", "#06d6a0", "#4cc9f0", "#9b5de5"],
  ["#ffe066", "#ffb020", "#fff6c2", "#ffffff"],
  ["#7c5cff", "#22d3ee", "#c7b8ff", "#ffffff"],
  ["#ff4d6d", "#ff8fab", "#ffccd5", "#ffffff"],
  ["#00f5d4", "#00bbf9", "#f15bb5", "#fee440"],
];

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

/** Local file → copied into Vexcast's media folder; or a URL. */
export function FilePick({ value, onChange, exts, label }: { value: string; onChange: (v: string) => void; exts: string[]; label: string }) {
  const [busy, setBusy] = useState(false);
  const t = useT();
  const pick = async () => {
    const p = await pickFile([{ name: label, extensions: exts }]);
    if (!p) return;
    setBusy(true);
    const r = await act((c) => c.importMedia(p));
    setBusy(false);
    if (r) onChange(r.path.replace(/\\/g, "/"));
  };
  return (
    <div className="flex flex-col gap-1.5">
      <Button variant="outline" className="h-9 w-full justify-start gap-2" disabled={!isTauri() || busy} onClick={pick}>
        {busy ? <Loader2 className="animate-spin" /> : <FolderOpen />}
        <span className="truncate">{value ? value.split(/[\\/]/).pop() : t.designer.pick}</span>
      </Button>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://…" className="h-7 px-2 font-mono text-[10px] text-muted-foreground" spellCheck={false} />
    </div>
  );
}

function MediaPreview({ path, video }: { path: string; video: boolean }) {
  const client = useStore((s) => s.client);
  if (!path || !client) return null;
  const src = /^(https?|data):/i.test(path) ? path : client.fileUrl(path);
  return (
    <div className="flex h-24 items-center justify-center overflow-hidden rounded-md border bg-black/40">
      {video ? <video src={src} className="max-h-full max-w-full" autoPlay loop muted playsInline /> : <img src={src} alt="" className="max-h-full max-w-full object-contain" />}
    </div>
  );
}

// ------------------------------------------------------------------ element

export const LayerPanel = forwardRef<HTMLTextAreaElement, { layer: AlertLayer; design: AlertDesign; set: (p: Partial<AlertLayer>) => void; onDelete: () => void; onDuplicate: () => void; goal?: boolean }>(function LayerPanel(
  { layer, design, set, onDelete, onDuplicate, goal },
  textRef,
) {
  const t = useT();
  const d = t.designer;
  const a = (k: string) => (d.anim as Record<string, string>)[k] ?? k;
  const [localRef, setLocalRef] = useState<HTMLTextAreaElement | null>(null);
  const insert = (v: string) => {
    const el = localRef;
    const s = layer.text;
    const at = el ? el.selectionStart : s.length;
    set({ text: s.slice(0, at) + v + s.slice(el ? el.selectionEnd : at) });
  };
  const fonts = GOOGLE_FONTS.includes(layer.fontFamily) || !layer.fontFamily ? GOOGLE_FONTS : [layer.fontFamily, ...GOOGLE_FONTS];

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1.5 border-b px-4 py-2.5">
        <Input value={layer.name} onChange={(e) => set({ name: e.target.value })} placeholder={d.kinds[layer.kind]} className="h-8 flex-1 text-sm font-medium" />
        <Button size="icon-sm" variant="ghost" onClick={onDuplicate} title={d.duplicateLayer} aria-label={d.duplicateLayer}>
          <Copy />
        </Button>
        <Button size="icon-sm" variant="ghost" className="text-destructive" onClick={onDelete} title={d.deleteLayer} aria-label={d.deleteLayer}>
          <Trash2 />
        </Button>
      </div>

      {layer.kind === "text" && (
        <>
          <Section title={d.sections.content}>
            <Textarea
              ref={(el) => {
                setLocalRef(el);
                if (typeof textRef === "function") textRef(el);
                else if (textRef) textRef.current = el;
              }}
              value={layer.text}
              onChange={(e) => set({ text: e.target.value })}
              className="min-h-20 text-sm"
              data-testid="designer-text"
            />
            <div className="flex flex-wrap gap-1">
              {(goal ? (["title", "current", "target", "percent", "remaining"] as const) : (["user", "amount", "message", "months"] as const)).map((k) => (
                <Button key={k} size="sm" variant="secondary" className="h-6 px-2 text-[11px]" onClick={() => insert(`{${k}}`)}>
                  + {d.vars[k]}
                </Button>
              ))}
            </div>
            <span className="text-[11px] text-muted-foreground">{d.varsHint}</span>
          </Section>
          <Section title={d.sections.style}>
            <Row label={d.font} hint={d.fontHint}>
              <Choice value={layer.fontFamily || "Inter"} options={fonts.map((f) => ({ value: f, label: f }))} onChange={(fontFamily) => set({ fontFamily })} />
              <Input value={layer.fontFamily} onChange={(e) => set({ fontFamily: e.target.value })} placeholder={d.fontOther} className="h-7 px-2 text-[11px]" />
            </Row>
            <Row label={d.size}>
              <SliderNum value={layer.fontSize} min={10} max={220} onChange={(fontSize) => set({ fontSize })} unit="px" />
            </Row>
            <div className="grid grid-cols-2 gap-2">
              <Row label={d.color}>
                <Color value={layer.color} onChange={(color) => set({ color })} />
              </Row>
              <Row label={d.highlightShort}>
                <Color value={layer.highlight} onChange={(highlight) => set({ highlight })} placeholder="—" />
              </Row>
            </div>
            <Row label={d.align}>
              <div className="flex gap-2">
                <ToggleGroup type="single" variant="outline" size="sm" value={layer.align} onValueChange={(v) => v && set({ align: v as AlertLayer["align"] })}>
                  <ToggleGroupItem value="left" aria-label="left">
                    <AlignLeft />
                  </ToggleGroupItem>
                  <ToggleGroupItem value="center" aria-label="center">
                    <AlignCenter />
                  </ToggleGroupItem>
                  <ToggleGroupItem value="right" aria-label="right">
                    <AlignRight />
                  </ToggleGroupItem>
                </ToggleGroup>
                <ToggleGroup type="single" variant="outline" size="sm" value={layer.valign} onValueChange={(v) => v && set({ valign: v as AlertLayer["valign"] })}>
                  <ToggleGroupItem value="top" aria-label="top">
                    <AlignVerticalJustifyStart />
                  </ToggleGroupItem>
                  <ToggleGroupItem value="middle" aria-label="middle">
                    <AlignVerticalJustifyCenter />
                  </ToggleGroupItem>
                  <ToggleGroupItem value="bottom" aria-label="bottom">
                    <AlignVerticalJustifyEnd />
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
            </Row>
          </Section>
          <Section title={d.sections.moreStyle} defaultOpen={false}>
            <div className="grid grid-cols-2 gap-2">
              <Row label={d.weight_}>
                <Choice value={String(layer.fontWeight)} options={["300", "400", "500", "600", "700", "800", "900"].map((w) => ({ value: w, label: w }))} onChange={(w) => set({ fontWeight: Number(w) })} />
              </Row>
              <div className="flex flex-col justify-end gap-2">
                <Toggle label={d.italic} checked={layer.italic} onChange={(italic) => set({ italic })} />
                <Toggle label={d.uppercase} checked={layer.uppercase} onChange={(uppercase) => set({ uppercase })} />
              </div>
            </div>
            <div className="grid grid-cols-[1fr_72px] gap-2">
              <Row label={d.stroke}>
                <Color value={layer.strokeColor} onChange={(strokeColor) => set({ strokeColor })} placeholder="—" />
              </Row>
              <Row label="px">
                <Num value={layer.strokeWidth} min={0} step={0.5} onChange={(strokeWidth) => set({ strokeWidth })} />
              </Row>
            </div>
            <div className="grid grid-cols-[1fr_72px] gap-2">
              <Row label={d.shadow}>
                <Color value={layer.shadowColor} onChange={(shadowColor) => set({ shadowColor })} placeholder="—" />
              </Row>
              <Row label={d.blur}>
                <Num value={layer.shadowBlur} min={0} onChange={(shadowBlur) => set({ shadowBlur })} />
              </Row>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Row label={d.lineHeight}>
                <Num value={layer.lineHeight} step={0.05} min={0.5} onChange={(lineHeight) => set({ lineHeight })} />
              </Row>
              <Row label={d.letterSpacing}>
                <Num value={layer.letterSpacing} step={0.5} onChange={(letterSpacing) => set({ letterSpacing })} />
              </Row>
            </div>
          </Section>
        </>
      )}

      {(layer.kind === "image" || layer.kind === "video") && (
        <Section title={d.sections.content}>
          <MediaPreview path={layer.src} video={layer.kind === "video"} />
          <FilePick label={d.kinds[layer.kind]} value={layer.src} onChange={(src) => set({ src, kind: /\.(webm|mp4|mov)$/i.test(src) ? "video" : layer.kind === "video" && !/\.(webm|mp4|mov)$/i.test(src) && src ? "image" : layer.kind })} exts={layer.kind === "video" ? VIDEO_EXT : IMAGE_EXT} />
          <Row label={d.fit}>
            <Choice value={layer.fit} options={(["contain", "cover", "fill"] as const).map((f) => ({ value: f, label: d.fits[f] }))} onChange={(fit) => set({ fit })} />
          </Row>
          {layer.kind === "video" && (
            <>
              <Toggle label={d.withSound} checked={!layer.muted} onChange={(v) => set({ muted: !v })} />
              <Toggle label={d.loop} checked={layer.loopMedia} onChange={(loopMedia) => set({ loopMedia })} />
            </>
          )}
        </Section>
      )}

      {layer.kind === "shape" && (
        <Section title={d.sections.style}>
          <Row label={d.fill}>
            <Color value={layer.fill} onChange={(fill) => set({ fill })} />
          </Row>
          <Row label={d.radius}>
            <SliderNum value={layer.radius} min={0} max={300} onChange={(radius) => set({ radius })} unit="px" />
          </Row>
          <div className="grid grid-cols-[1fr_72px] gap-2">
            <Row label={d.border}>
              <Color value={layer.borderColor} onChange={(borderColor) => set({ borderColor })} placeholder="—" />
            </Row>
            <Row label="px">
              <Num value={layer.borderWidth} min={0} onChange={(borderWidth) => set({ borderWidth })} />
            </Row>
          </div>
        </Section>
      )}

      {layer.kind === "progress" && (
        <Section title={d.bar.title}>
          <div className="grid grid-cols-2 gap-2">
            <Row label={d.bar.color}>
              <Color value={layer.fill} onChange={(fill) => set({ fill })} />
            </Row>
            <Row label={d.bar.color2}>
              <Color value={layer.barColor2} onChange={(barColor2) => set({ barColor2 })} />
            </Row>
          </div>
          <Row label={d.bar.track}>
            <Color value={layer.trackColor} onChange={(trackColor) => set({ trackColor })} placeholder="rgba(255,255,255,0.12)" />
          </Row>
          <Row label={d.radius}>
            <SliderNum value={layer.radius} min={0} max={200} onChange={(radius) => set({ radius })} unit="px" />
          </Row>
          <div className="grid grid-cols-[1fr_72px] gap-2">
            <Row label={d.border}>
              <Color value={layer.borderColor} onChange={(borderColor) => set({ borderColor })} placeholder="—" />
            </Row>
            <Row label="px">
              <Num value={layer.borderWidth} min={0} onChange={(borderWidth) => set({ borderWidth })} />
            </Row>
          </div>
          <Toggle label={d.bar.stripes} checked={layer.barStripes} onChange={(barStripes) => set({ barStripes })} />
          <Toggle label={d.bar.glow} checked={layer.barGlow} onChange={(barGlow) => set({ barGlow })} />
          <Toggle label={d.bar.vertical} checked={layer.barVertical} onChange={(barVertical) => set({ barVertical })} />
        </Section>
      )}

      {layer.kind === "particles" && (
        <Section title={d.fx.title}>
          <div className="grid grid-cols-4 gap-1">
            {PARTICLE_TYPES.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => set(k === "emoji" && layer.particleSize < 36 ? { particleType: k, particleSize: 56 } : { particleType: k })}
                aria-pressed={layer.particleType === k}
                className={cn("flex flex-col items-center gap-0.5 rounded-md border px-1 py-1.5 text-[10px] transition-colors hover:bg-accent/50", layer.particleType === k && "border-primary bg-primary/10 font-medium")}
              >
                <span className="text-base leading-none">{FX_ICON[k]}</span>
                {d.fx.types[k]}
              </button>
            ))}
          </div>
          {layer.particleType === "emoji" && (
            <Row label={d.fx.emoji} hint={d.fx.emojiHint}>
              <Input value={layer.particleEmoji} onChange={(e) => set({ particleEmoji: e.target.value })} className="h-8 text-base" />
            </Row>
          )}
          <Row label={d.fx.mode} hint={d.fx.modeHints[layer.particleMode] ?? ""}>
            <Choice value={layer.particleMode} options={PARTICLE_MODES.map((k) => ({ value: k, label: d.fx.modes[k] }))} onChange={(particleMode) => set({ particleMode })} />
          </Row>
          <Row label={d.fx.count}>
            <SliderNum value={layer.particleCount} min={5} max={600} step={5} onChange={(particleCount) => set({ particleCount })} />
          </Row>
          <Row label={d.fx.size}>
            <SliderNum value={layer.particleSize} min={4} max={160} onChange={(particleSize) => set({ particleSize })} unit="px" />
          </Row>
          <Row label={d.fx.speed}>
            <SliderNum value={layer.particleSpeed} min={0.2} max={3} step={0.1} onChange={(particleSpeed) => set({ particleSpeed })} unit="×" />
          </Row>
          {layer.particleType !== "emoji" && (
            <Row label={d.fx.colors} hint={d.fx.colorsHint}>
              <div className="flex flex-wrap items-center gap-1.5">
                {FX_PALETTES.map((p) => (
                  <button
                    key={p.join()}
                    type="button"
                    onClick={() => set({ particleColors: p.join(",") })}
                    className={cn("flex h-6 overflow-hidden rounded-md border", layer.particleColors === p.join(",") && "ring-2 ring-primary")}
                    aria-label={p.join(", ")}
                  >
                    {p.map((c) => (
                      <span key={c} className="w-2.5" style={{ background: c }} />
                    ))}
                  </button>
                ))}
                <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => set({ particleColors: "" })}>
                  {d.fx.auto}
                </Button>
              </div>
              <Input value={layer.particleColors} onChange={(e) => set({ particleColors: e.target.value })} placeholder="#ff5e7e, #ffd166, #4cc9f0" className="h-8 font-mono text-[11px]" spellCheck={false} />
            </Row>
          )}
          {layer.particleMode !== "burst" && (
            <Row label={d.fx.duration} hint={d.fx.durationHint}>
              <Num value={layer.particleDurationMs} min={0} step={250} onChange={(particleDurationMs) => set({ particleDurationMs })} />
            </Row>
          )}
        </Section>
      )}

      <Section title={d.sections.animation}>
        <Row label={d.animIn}>
          <Choice value={layer.animIn} options={ANIMS_IN.filter((k) => layer.kind === "text" || !/^(typewriter|letter)/.test(k)).map((k) => ({ value: k, label: a(k) }))} onChange={(animIn) => set({ animIn })} />
        </Row>
        {layer.kind === "text" && (
          <Row label={d.fx.textEffect} hint={d.fx.textEffectHint}>
            <Choice value={layer.textEffect ?? "none"} options={TEXT_EFFECTS.map((k) => ({ value: k, label: d.fx.effects[k] }))} onChange={(textEffect) => set({ textEffect })} />
          </Row>
        )}
        <Row label={d.animLoop}>
          <Choice value={layer.animLoop} options={LOOPS.map((k) => ({ value: k, label: a(k) }))} onChange={(animLoop) => set({ animLoop })} />
        </Row>
        <Row label={d.animOut}>
          <Choice value={layer.animOut} options={ANIMS_OUT.map((k) => ({ value: k, label: a(k) }))} onChange={(animOut) => set({ animOut })} />
        </Row>
        <Collapsible>
          <CollapsibleTrigger className="text-[11px] text-primary hover:underline">{d.timing}</CollapsibleTrigger>
          <CollapsibleContent className="mt-2 grid grid-cols-3 gap-2">
            <Row label={d.inMs}>
              <Num value={layer.animInMs} min={0} step={50} onChange={(animInMs) => set({ animInMs })} />
            </Row>
            <Row label={d.delay}>
              <Num value={layer.animInDelay} min={0} step={50} onChange={(animInDelay) => set({ animInDelay })} />
            </Row>
            <Row label={d.outMs}>
              <Num value={layer.animOutMs} min={0} step={50} onChange={(animOutMs) => set({ animOutMs })} />
            </Row>
          </CollapsibleContent>
        </Collapsible>
      </Section>

      <Section title={d.sections.position} defaultOpen={false}>
        <div className="grid grid-cols-4 gap-1.5">
          {(["x", "y", "w", "h"] as const).map((k) => (
            <Row key={k} label={k.toUpperCase()}>
              <Num value={layer[k]} onChange={(v) => set({ [k]: k === "w" || k === "h" ? Math.max(1, v) : v })} />
            </Row>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => set({ x: Math.round((design.width - layer.w) / 2) })}>
            {d.centerH}
          </Button>
          <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => set({ y: Math.round((design.height - layer.h) / 2) })}>
            {d.centerV}
          </Button>
          <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => set({ x: 0, y: 0, w: design.width, h: design.height })}>
            {d.fillCanvas}
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Row label={d.rotation}>
            <Num value={layer.rotation} onChange={(rotation) => set({ rotation })} />
          </Row>
          <Row label={d.opacity}>
            <Num value={Math.round(layer.opacity * 100)} min={0} max={100} onChange={(o) => set({ opacity: Math.max(0, Math.min(1, o / 100)) })} />
          </Row>
        </div>
        <Row label={d.showWhen}>
          <Choice value={layer.showWhen} options={(goal ? (["always", "reached", "notReached"] as const) : (["always", "message", "amount"] as const)).map((m) => ({ value: m, label: d.showWhenModes[m] }))} onChange={(showWhen) => set({ showWhen })} />
        </Row>
      </Section>
    </div>
  );
});

// ------------------------------------------------------------------ alert settings

export function DesignPanel({ design, set, goal }: { design: AlertDesign; set: (p: Partial<AlertDesign>) => void; goal?: boolean }) {
  const t = useT();
  const d = t.designer;
  return (
    <div className="flex flex-col">
      <Section title={d.sections.general}>
        <Row label={d.name}>
          <Input value={design.name} onChange={(e) => set({ name: e.target.value })} className="h-8 text-sm" />
        </Row>
        {!goal && (
          <>
            <Toggle label={d.enabled} checked={design.enabled} onChange={(enabled) => set({ enabled })} />
            <Row label={`${d.duration}: ${(design.durationMs / 1000).toFixed(1)} s`}>
              <Slider min={2000} max={30000} step={500} value={[design.durationMs]} onValueChange={([durationMs]) => set({ durationMs })} />
            </Row>
          </>
        )}
      </Section>
      {!goal && (
        <>
      <Section title={d.sections.where}>
        <AlertPlacement design={design} />
      </Section>
      <Section title={d.sections.when}>
        <div className="grid grid-cols-2 gap-2">
          <Row label={d.minAmount}>
            <Num value={design.minAmount} min={0} onChange={(minAmount) => set({ minAmount })} />
          </Row>
          <Row label={d.maxAmount}>
            <Num value={design.maxAmount} min={0} onChange={(maxAmount) => set({ maxAmount })} />
          </Row>
        </div>
        <span className="text-[11px] text-muted-foreground">{d.whenHint}</span>
        <Collapsible>
          <CollapsibleTrigger className="text-[11px] text-primary hover:underline">{d.advanced}</CollapsibleTrigger>
          <CollapsibleContent className="mt-2 flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
              <Row label={d.priority}>
                <Num value={design.priority} onChange={(priority) => set({ priority: Math.round(priority) })} />
              </Row>
              <Row label={d.weight}>
                <Num value={design.weight} min={0} step={0.5} onChange={(weight) => set({ weight })} />
              </Row>
            </div>
            <span className="text-[11px] text-muted-foreground">{d.conditionsHint}</span>
          </CollapsibleContent>
        </Collapsible>
      </Section>
      <Section title={d.sections.sound}>
        <FilePick label={d.sound} value={design.sound} onChange={(sound) => set({ sound })} exts={SOUND_EXT} />
        <span className="text-[11px] text-muted-foreground">{d.soundHint}</span>
        <Row label={`${d.volume}: ${Math.round(design.soundVolume * 100)}%`}>
          <Slider min={0} max={1} step={0.01} value={[design.soundVolume]} onValueChange={([soundVolume]) => set({ soundVolume })} />
        </Row>
        {!goal && (
          <Row label={d.tts}>
          <Choice value={design.tts} options={(["default", "on", "off"] as const).map((m) => ({ value: m, label: d.ttsModes[m] }))} onChange={(tts) => set({ tts })} />
        </Row>
        )}
      </Section>
        </>
      )}
      <Section title={d.sections.canvas} defaultOpen={false}>
        <div className="grid grid-cols-2 gap-2">
          <Row label={d.width}>
            <Num value={design.width} min={100} onChange={(width) => set({ width: Math.round(width) })} />
          </Row>
          <Row label={d.height}>
            <Num value={design.height} min={100} onChange={(height) => set({ height: Math.round(height) })} />
          </Row>
        </div>
        <div className="flex flex-wrap gap-1">
          {(
            [
              [1920, 1080],
              [1280, 720],
              [1080, 1920],
              [800, 600],
            ] as const
          ).map(([w, h]) => (
            <Button key={`${w}x${h}`} size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => set({ width: w, height: h })}>
              {w}×{h}
            </Button>
          ))}
        </div>
        <span className="text-[11px] text-muted-foreground">{d.canvasHint}</span>
      </Section>
      <Section title={d.sections.code} defaultOpen={design.customEnabled}>
        <Toggle label={d.code} checked={design.customEnabled} onChange={(customEnabled) => set({ customEnabled })} />
        <span className="text-[11px] text-muted-foreground">{d.codeHint}</span>
        {design.customEnabled && (
          <Tabs defaultValue="html">
            <TabsList className="w-full">
              <TabsTrigger value="html">{d.html}</TabsTrigger>
              <TabsTrigger value="css">{d.css}</TabsTrigger>
              <TabsTrigger value="js">{d.js}</TabsTrigger>
            </TabsList>
            {(["html", "css", "js"] as const).map((k) => (
              <TabsContent key={k} value={k}>
                <Textarea
                  value={k === "html" ? design.customHtml : k === "css" ? design.customCss : design.customJs}
                  onChange={(e) => set(k === "html" ? { customHtml: e.target.value } : k === "css" ? { customCss: e.target.value } : { customJs: e.target.value })}
                  className="min-h-56 font-mono text-[11px] leading-relaxed"
                  spellCheck={false}
                />
              </TabsContent>
            ))}
          </Tabs>
        )}
      </Section>
    </div>
  );
}
