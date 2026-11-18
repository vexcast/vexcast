import { Switch } from "@/components/ui/switch";
import { CountersPanel } from "./counters-panel";
import type { LabelData, LabelEvent } from "@vexcast/protocol";
import { toast } from "sonner";
import { confirmDialog } from "@/lib/dialogs";
import { formatMoney } from "@/lib/format";
import { Editor } from "@/components/alerts/alert-designer";
import { createGoalDesign } from "@/components/alerts/designs";
import { ColorField, FontField, Segmented, SliderField } from "./widget-controls";
import { AudioReactiveSection } from "@/components/alerts/audio-reactive";
import { AudioLines, ChevronDown, ChevronUp } from "lucide-react";
import type { AlertType, WidgetSettings } from "@vexcast/protocol";
import { BellRing, Captions, BarChart3, Clapperboard, Copy, Gift, Hash, Music, Palette, Pencil, Star, Tag, Goal, ListOrdered, MessageSquareText, Play, Plus, RotateCw, SkipForward, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { TabsContent } from "@/components/ui/tabs";
import { useT } from "@/i18n";
import { KofiIcon } from "@/lib/platforms";
import { act, editingSceneUuid, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { AlertDesigner } from "@/components/alerts/alert-designer";
import { ALERT_META, ALERT_TYPES, EventList } from "./chat";
import { CopyField, Field, fromSelect, num, PanelNav, SaveBar, SecretInput, Section, Steps, SwitchRow, toSelect, TRANSLATE_LANGS, useDraft } from "./shared";

type WidgetName = "alerts" | "chat" | "goal" | "events" | "captions" | "highlight" | "labels" | "poll" | "giveaway" | "songs" | "credits";
type Tab = "activity" | "designer" | "alertBox" | "chatBox" | "highlight" | "labels" | "poll" | "giveaway" | "counters" | "songs" | "credits" | "goal" | "captions" | "events" | "kofi" | "audio";

const ACCENTS = ["#8B5CF6", "#22D3EE", "#F43F5E", "#F59E0B", "#10B981", "#EC4899"];
const CURRENCIES = ["EUR", "USD", "MXN", "ARS", "COP", "CLP", "GBP", "BRL"];

// ------------------------------------------------------------------ widget preview / shell

const DRAFT_KEY: Partial<Record<WidgetName, keyof WidgetSettings>> = { chat: "chatBox", goal: "goal", captions: "captions", events: "events", highlight: "highlight", labels: "labels", poll: "poll", giveaway: "giveaway", songs: "songs", credits: "credits" };

function withQuery(url: string, q: string) {
  return q ? `${url}${url.includes("?") ? "&" : "?"}${q}` : url;
}

function WidgetPreview({ name, w, h, reloadKey, draft, demo, query = "", draftKey }: { name: WidgetName; w: number; h: number; reloadKey: number; draft?: unknown; demo?: boolean; query?: string; draftKey?: string }) {
  const client = useStore((s) => s.client);
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  // Live preview: send the unsaved draft to the widget.
  const send = useCallback(() => {
    const key = draftKey ?? DRAFT_KEY[name];
    if (!key || !draft) return;
    let settings = draft as Record<string, unknown>;
    // Goal at 0: keep the sample progress so the bar look is visible.
    if (demo && key.startsWith("goal") && !Number(settings.current)) {
      const { current: _c, ...rest } = settings;
      settings = rest;
    }
    frame.current?.contentWindow?.postMessage({ type: "vexcast:preview", widget: key, settings }, "*");
  }, [name, draft, demo, draftKey]);
  useEffect(send, [send]);
  const [scale, setScale] = useState(0.3);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setScale(Math.min(el.clientWidth / w, el.clientHeight / h));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [w, h]);
  return (
    <div ref={ref} className="checkerboard relative w-full overflow-hidden rounded-md border" style={{ aspectRatio: String(Math.min(5, Math.max(0.8, w / h))) }}>
      {client && (
        <iframe
          ref={frame}
          key={reloadKey}
          title={name}
          onLoad={() => setTimeout(send, 300)}
          src={withQuery(client.widgetUrl(name), [query, demo ? "demo=1" : ""].filter(Boolean).join("&"))}
          className="pointer-events-none absolute top-1/2 left-1/2 origin-center border-0 bg-transparent"
          style={{ colorScheme: "normal", width: w, height: h, transform: `translate(-50%, -50%) scale(${scale})` }}
        />
      )}
    </div>
  );
}

function WidgetShell({
  name,
  title,
  icon,
  previewSize,
  children,
  extra,
  reloadKey,
  onReload,
  draft,
  demo,
  side,
  noAdd,
  query = "",
  draftKey,
}: {
  name: WidgetName;
  title: string;
  icon: ReactNode;
  previewSize: [number, number];
  children?: ReactNode;
  extra?: ReactNode;
  reloadKey: number;
  onReload: () => void;
  /** Unsaved settings shown live in the preview. */
  draft?: unknown;
  /** Preview with sample data (chat messages, numbers) instead of the live core. */
  demo?: boolean;
  /** Extra sections under the preview. */
  side?: ReactNode;
  /** No generic "add to scene" (the widget adds its own sources). */
  noAdd?: boolean;
  /** Extra URL parameters (goal.html?type=followers). */
  query?: string;
  /** Draft key the widget reads in previews (default: the widget's). */
  draftKey?: string;
}) {
  const t = useT();
  const client = useStore((s) => s.client);
  const sceneUuid = useStore((s) => (s.state ? editingSceneUuid(s.state) : null));
  const url = client ? withQuery(client.widgetUrl(name), query) : "";
  const addToScene = () => {
    if (!sceneUuid) return;
    act(
      (c) => c.createSource({ name: title, kind: "browser_source", settings: { url: withQuery(c.widgetUrl(name), query), width: 1920, height: 1080 }, sceneUuid }),
      t.alerts.addedToScene,
    );
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title={title} icon={icon} description={t.alerts.widgetsDesc}>
        <Field label={t.alerts.widgetUrl}>
          <CopyField value={url} />
        </Field>
        {children}
      </Section>
      <Section
        title={t.alerts.preview}
        className="self-start"
        action={
          <div className="flex items-center gap-1">
            {extra}
            <Button size="icon-sm" variant="ghost" onClick={onReload} aria-label={t.alerts.reload} title={t.alerts.reload}>
              <RotateCw />
            </Button>
          </div>
        }
      >
        <WidgetPreview name={name} w={previewSize[0]} h={previewSize[1]} reloadKey={reloadKey} draft={draft} demo={demo} query={query} draftKey={draftKey} />
        {demo && <p className="text-[11px] text-muted-foreground">{t.look.livePreview}</p>}
        <div className={cn("flex flex-wrap items-center gap-2", noAdd && "hidden")}>
          <Button size="sm" variant="outline" disabled={!sceneUuid} onClick={addToScene} data-testid={`widget-add-${name}`}>
            <Plus /> {t.alerts.addToScene}
          </Button>
          {!sceneUuid && <span className="text-xs text-muted-foreground">{t.alerts.noScene}</span>}
        </div>
      </Section>
      {side}
    </div>
  );
}

/** Draft of one widget section + save (reloads the preview afterwards). */
function useWidgetDraft<K extends keyof WidgetSettings>(key: K, onSaved: () => void) {
  const t = useT();
  const value = useStore((s) => s.state!.widgets[key]);
  const d = useDraft(value);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    // The alert designer saves "designs" on its own: never send a stale copy from this draft.
    const body = key === "alertBox" ? (({ designs: _designs, ...rest }) => rest)(d.draft as WidgetSettings["alertBox"]) : d.draft;
    await act((c) => c.setWidgets({ [key]: body } as Partial<WidgetSettings>), t.common.saved);
    setSaving(false);
    setTimeout(onSaved, 400);
  };
  return { ...d, save, saving };
}

function Opt({ value, label }: { value: string; label: string }) {
  return <SelectItem value={value}>{label}</SelectItem>;
}

// ------------------------------------------------------------------ widgets

function AlertBoxWidget() {
  const t = useT();
  const { draft: d, set, dirty, save, reset, saving } = useWidgetDraft("alertBox", () => {});
  const [tplType, setTplType] = useState<AlertType>("follow");
  return (
    <>
      <Section title={t.designer.generalTab} icon={<BellRing />} description={t.designer.generalDesc} className="max-w-3xl"
        action={
          <Button size="sm" variant="ghost" onClick={() => act((c) => c.skipAlert())}>
            <SkipForward /> {t.alerts.skip}
          </Button>
        }
      >
        <SwitchRow label={t.common.enabled} checked={d.enabled} onCheckedChange={(enabled) => set({ enabled })} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t.alerts.duration}>
            <Input type="number" step={500} min={1000} value={d.durationMs} onChange={(e) => set({ durationMs: num(e.target.value, d.durationMs) })} />
          </Field>
          <Field label={t.alerts.animation}>
            <Select value={d.animation} onValueChange={(v) => set({ animation: v as typeof d.animation })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["pop", "slide", "fade", "bounce"] as const).map((a) => (
                  <Opt key={a} value={a} label={t.alerts.animations[a]} />
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field label={t.alerts.templates} hint={t.alerts.templatesHint}>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select value={tplType} onValueChange={(v) => setTplType(v as AlertType)}>
              <SelectTrigger className="w-full sm:w-40 sm:shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALERT_TYPES.map((a) => (
                  <Opt key={a} value={a} label={t.alerts.types[a]} />
                ))}
              </SelectContent>
            </Select>
            <Input value={d.templates[tplType] ?? ""} onChange={(e) => set({ templates: { ...d.templates, [tplType]: e.target.value } })} placeholder="{user}…" />
          </div>
        </Field>
        <Field label={t.alerts.accent}>
          <div className="flex flex-wrap items-center gap-2">
            {ACCENTS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => set({ accentColor: c })}
                className={cn(
                  "size-6 rounded-full border ring-offset-2 ring-offset-background outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  d.accentColor.toLowerCase() === c.toLowerCase() && "ring-2 ring-foreground",
                )}
                style={{ background: c }}
              />
            ))}
            <label className="relative size-6 cursor-pointer overflow-hidden rounded-full border" style={{ background: d.accentColor }} title={t.alerts.accent}>
              <input type="color" value={d.accentColor.slice(0, 7)} onChange={(e) => set({ accentColor: e.target.value })} className="absolute inset-0 cursor-pointer opacity-0" />
            </label>
            <Input value={d.accentColor} onChange={(e) => set({ accentColor: e.target.value })} className="h-8 w-28 font-mono text-xs" spellCheck={false} />
          </div>
        </Field>
        <Field label={t.alerts.sound} hint={t.alerts.soundHint}>
          <Input value={d.soundUrl ?? ""} onChange={(e) => set({ soundUrl: e.target.value || null })} className="font-mono text-xs" placeholder="https://…/alert.mp3" />
        </Field>
        <Field label={`${t.alerts.volume} · ${Math.round(d.soundVolume * 100)}%`}>
          <Slider min={0} max={1} step={0.01} value={[d.soundVolume]} onValueChange={([soundVolume]) => set({ soundVolume })} />
        </Field>
        <SwitchRow label={t.alerts.tts} checked={d.ttsEnabled} onCheckedChange={(ttsEnabled) => set({ ttsEnabled })} />
        {d.ttsEnabled && (
          <Field label={t.alerts.ttsMin}>
            <Input type="number" min={0} value={d.ttsMinAmount} onChange={(e) => set({ ttsMinAmount: num(e.target.value, d.ttsMinAmount) })} className="sm:w-40" />
          </Field>
        )}
      </Section>
      <Section title={t.look.queue} description={t.look.queueDesc} className="max-w-3xl">
        <div className="grid gap-3 sm:grid-cols-2">
          <SliderField label={t.look.gap} value={(d.gapMs ?? 400) / 1000} min={0} max={10} step={0.1} unit=" s" onChange={(v) => set({ gapMs: Math.round(v * 1000) })} />
          <SliderField label={(d.maxQueue ?? 0) ? t.look.maxQueue : `${t.look.maxQueue} (${t.look.noLimit})`} value={d.maxQueue ?? 0} min={0} max={50} step={1} onChange={(maxQueue) => set({ maxQueue })} />
          <SliderField label={(d.repeatFollowMinutes ?? 60) ? t.look.repeatFollow : `${t.look.repeatFollow} (${t.look.off})`} value={d.repeatFollowMinutes ?? 60} min={0} max={240} step={5} unit=" min" onChange={(repeatFollowMinutes) => set({ repeatFollowMinutes })} />
        </div>
        <p className="text-[11px] text-muted-foreground">{t.look.queueHint}</p>
      </Section>
      <Section title={t.look.messages} description={t.look.messagesDesc} className="max-w-3xl">
        <Field label={t.look.blockedWords} hint={t.look.blockedWordsHint}>
          <BlockedWords value={d.blockedWords ?? []} onChange={(blockedWords) => set({ blockedWords })} />
        </Field>
        <SwitchRow label={t.look.stripLinks} checked={d.stripLinks ?? true} onCheckedChange={(stripLinks) => set({ stripLinks })} />
        <SliderField label={(d.maxMessageLength ?? 250) ? t.look.maxLength : `${t.look.maxLength} (${t.look.noLimit})`} value={d.maxMessageLength ?? 250} min={0} max={500} step={10} unit="" onChange={(maxMessageLength) => set({ maxMessageLength })} />
      </Section>
      <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={reset} />
    </>
  );
}

/** Comma separated list edited as text, saved on blur. */
function BlockedWords({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(value.join(", "));
  useEffect(() => setText(value.join(", ")), [value]);
  return <Input value={text} onChange={(e) => setText(e.target.value)} onBlur={() => onChange(text.split(",").map((x) => x.trim()).filter(Boolean))} />;
}

function ChatBoxWidget() {
  const t = useT();
  const l = t.look;
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);
  const { draft: d, set, dirty, save, reset, saving } = useWidgetDraft("chatBox", reload);
  const [hiddenText, setHiddenText] = useState((d.hiddenUsers ?? []).join(", "));
  useEffect(() => setHiddenText((d.hiddenUsers ?? []).join(", ")), [d.hiddenUsers]);
  return (
    <>
      <WidgetShell
        name="chat"
        title={t.alerts.chatBox}
        icon={<MessageSquareText />}
        previewSize={[600, 800]}
        reloadKey={reloadKey}
        onReload={reload}
        draft={d}
        demo
        side={
          <Section title={l.filters} description={l.filtersDesc} className="self-start">
            <SwitchRow label={l.hideCommands} checked={d.hideCommands} onCheckedChange={(hideCommands) => set({ hideCommands })} />
            <SwitchRow label={l.hideBots} checked={d.hideBots} onCheckedChange={(hideBots) => set({ hideBots })} />
            <Field label={l.hiddenUsers} hint={l.hiddenUsersHint}>
              <Input
                value={hiddenText}
                onChange={(e) => setHiddenText(e.target.value)}
                onBlur={() => set({ hiddenUsers: hiddenText.split(",").map((x) => x.trim()).filter(Boolean) })}
                placeholder="Nightbot, StreamElements"
              />
            </Field>
          </Section>
        }
      >
        <Field label={t.alerts.theme}>
          <div className="grid grid-cols-5 gap-1.5">
            {(["glass", "solid", "minimal", "bubble", "neon"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => set({ theme: v })}
                aria-pressed={d.theme === v}
                className={cn("rounded-md border px-2 py-2 text-xs transition-colors hover:bg-accent/50", d.theme === v && "border-primary bg-primary/5 font-medium ring-1 ring-primary/40")}
              >
                {l.chatThemes[v]}
              </button>
            ))}
          </div>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <FontField label={l.font} value={d.fontFamily ?? ""} onChange={(fontFamily) => set({ fontFamily })} />
          <SliderField label={t.alerts.fontSize} value={d.fontSize} min={12} max={48} step={1} unit="px" onChange={(fontSize) => set({ fontSize })} />
          <ColorField label={l.textColor} value={d.textColor ?? "#ffffff"} onChange={(textColor) => set({ textColor })} />
          <Segmented label={l.nameColor} value={d.nameColorMode ?? "user"} options={[{ value: "user", label: l.nameUser }, { value: "custom", label: l.nameCustom }]} onChange={(nameColorMode) => set({ nameColorMode })} />
          {d.nameColorMode === "custom" && <ColorField label={l.nameColorPick} value={d.nameColor ?? "#9b87ff"} onChange={(nameColor) => set({ nameColor })} />}
          {d.theme !== "minimal" && (
            <>
              <ColorField label={l.bgColor} value={d.bgColor ?? "#16161f"} onChange={(bgColor) => set({ bgColor })} />
              <SliderField label={l.bgOpacity} value={(d.bgOpacity ?? 0.72) * 100} min={0} max={100} step={1} unit="%" onChange={(v) => set({ bgOpacity: v / 100 })} />
              <SliderField label={l.radius} value={d.radius ?? 0.8} min={0} max={2} step={0.05} unit="em" onChange={(radius) => set({ radius })} />
            </>
          )}
          <SliderField label={l.spacing} value={d.spacing ?? 0.42} min={0} max={1.5} step={0.02} unit="em" onChange={(spacing) => set({ spacing })} />
        </div>
        <Segmented label={l.animation} value={d.animation ?? "slide"} options={(["slide", "fade", "pop", "none"] as const).map((v) => ({ value: v, label: l.anims[v] }))} onChange={(animation) => set({ animation })} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Segmented label={l.direction} value={d.direction ?? "up"} options={[{ value: "up", label: l.dirUp }, { value: "down", label: l.dirDown }]} onChange={(direction) => set({ direction })} />
          <Segmented label={l.align} value={d.align ?? "left"} options={[{ value: "left", label: l.left }, { value: "right", label: l.right }]} onChange={(align) => set({ align })} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t.alerts.maxMessages}>
            <Input type="number" min={1} max={50} value={d.maxMessages} onChange={(e) => set({ maxMessages: num(e.target.value, d.maxMessages) })} />
          </Field>
          <Field label={t.alerts.fadeAfter}>
            <Input type="number" min={0} value={d.fadeAfterSec} onChange={(e) => set({ fadeAfterSec: num(e.target.value, d.fadeAfterSec) })} />
          </Field>
        </div>
        <SwitchRow label={t.alerts.showIcons} checked={d.showPlatformIcons} onCheckedChange={(showPlatformIcons) => set({ showPlatformIcons })} />
        <SwitchRow label={t.alerts.showBadges} checked={d.showBadges} onCheckedChange={(showBadges) => set({ showBadges })} />
        <SwitchRow label={l.showTime} checked={!!d.showTime} onCheckedChange={(showTime) => set({ showTime })} />
        <SwitchRow label={l.showNew} hint={l.showNewHint} checked={d.showNewBadge ?? true} onCheckedChange={(showNewBadge) => set({ showNewBadge })} />
      </WidgetShell>
      <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={reset} />
    </>
  );
}

const LABEL_IDS = [
  "latest_follower",
  "latest_subscriber",
  "latest_gift",
  "latest_bits",
  "latest_donation",
  "latest_raid",
  "top_donation",
  "top_bits",
  "top_raid",
  "session_top_donation",
  "session_top_bits",
  "session_follows",
  "session_subs",
  "session_bits",
  "session_donations",
  "session_raids",
  "total_followers",
  "total_subs",
] as const;
type LabelId = (typeof LABEL_IDS)[number];
const LABEL_DEF: Record<LabelId, [keyof LabelData, string, string]> = {
  latest_follower: ["latest", "follow", "{user}"],
  latest_subscriber: ["latest", "subscription", "{user}"],
  latest_gift: ["latest", "gift_sub", "{user} · {amount}"],
  latest_bits: ["latest", "bits", "{user} · {amount} bits"],
  latest_donation: ["latest", "donation", "{user} · {amount}"],
  latest_raid: ["latest", "raid", "{user} ({amount})"],
  top_donation: ["top", "donation", "{user} · {amount}"],
  top_bits: ["top", "bits", "{user} · {amount} bits"],
  top_raid: ["top", "raid", "{user} ({amount})"],
  session_top_donation: ["sessionTop", "donation", "{user} · {amount}"],
  session_top_bits: ["sessionTop", "bits", "{user} · {amount} bits"],
  session_follows: ["session", "follows", "{count}"],
  session_subs: ["session", "subs", "{count}"],
  session_bits: ["session", "bits", "{count}"],
  session_donations: ["session", "donations", "{amount}"],
  session_raids: ["session", "raids", "{count}"],
  total_followers: ["totals", "followers", "{count}"],
  total_subs: ["totals", "subs", "{count}"],
};

/** Same text the overlay shows (for the list). */
function labelText(id: LabelId, data: LabelData | undefined, tpl: string, empty: string, currency: string, lang: string): string {
  const [group, key] = LABEL_DEF[id];
  const g = (data?.[group] ?? {}) as Record<string, unknown>;
  const v = g[key];
  if (v === undefined || v === null) return empty;
  const cur = data?.latest?.donation?.currency || currency;
  let vars: Record<string, string>;
  if (group === "session" || group === "totals") {
    const n = v as number;
    vars = { user: "", count: String(Math.round(n * 100) / 100), amount: key === "donations" ? formatMoney(n, cur, lang) : String(n) };
  } else {
    const e = v as LabelEvent;
    const amt = e.amount == null ? "" : key === "donation" ? formatMoney(e.amount, e.currency || cur, lang) : String(e.amount);
    vars = { user: e.user, amount: amt, count: amt };
  }
  return tpl.replace(/\{(user|amount|count)\}/g, (_, k: string) => vars[k] ?? "");
}

function LabelsWidget() {
  const t = useT();
  const l = t.look;
  const lb = l.lb;
  const data = useStore((s) => s.state?.labels);
  const currency = useStore((s) => s.state?.widgets.goal.currency ?? "EUR");
  const sceneUuid = useStore((s) => (s.state ? editingSceneUuid(s.state) : null));
  const client = useStore((s) => s.client);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);
  const { draft: d, set, dirty, save, reset, saving } = useWidgetDraft("labels", reload);
  const templates = d.templates ?? {};
  const urlFor = (id: LabelId) => {
    const base = client?.widgetUrl("labels") ?? "";
    return `${base}${base.includes("?") ? "&" : "?"}label=${id}`;
  };
  const add = (id: LabelId) => {
    if (!sceneUuid) return;
    act((c) => c.createSource({ name: `${lb.prefix}: ${lb.names[id]}`, kind: "browser_source", settings: { url: urlFor(id), width: 800, height: 120 }, sceneUuid }), t.alerts.addedToScene);
  };
  const groups: [string, LabelId[]][] = [
    [lb.groups.latest, ["latest_follower", "latest_subscriber", "latest_gift", "latest_bits", "latest_donation", "latest_raid"]],
    [lb.groups.top, ["top_donation", "top_bits", "top_raid"]],
    [lb.groups.session, ["session_top_donation", "session_top_bits", "session_follows", "session_subs", "session_bits", "session_donations", "session_raids"]],
    [lb.groups.totals, ["total_followers", "total_subs"]],
  ];
  return (
    <>
      <WidgetShell
        name="labels"
        title={lb.title}
        icon={<Tag />}
        previewSize={[800, 120]}
        reloadKey={reloadKey}
        onReload={reload}
        draft={d}
        demo
        noAdd
        side={
          <Section title={l.appearance} className="self-start">
            <div className="grid gap-3 sm:grid-cols-2">
              <FontField label={l.font} value={d.fontFamily ?? ""} onChange={(fontFamily) => set({ fontFamily })} />
              <SliderField label={t.alerts.fontSize} value={d.fontSize ?? 32} min={12} max={120} step={1} unit="px" onChange={(fontSize) => set({ fontSize })} />
              <SliderField label={lb.weight} value={d.fontWeight ?? 800} min={300} max={900} step={100} onChange={(fontWeight) => set({ fontWeight })} />
              <Segmented label={l.align} value={d.align ?? "center"} options={(["left", "center", "right"] as const).map((v) => ({ value: v, label: lb.aligns[v] }))} onChange={(align) => set({ align })} />
              <ColorField label={l.textColor} value={d.textColor ?? "#ffffff"} onChange={(textColor) => set({ textColor })} />
              <ColorField label={lb.userColor} value={d.userColor ?? ""} onChange={(userColor) => set({ userColor })} />
              <ColorField label={lb.stroke} value={d.strokeColor ?? "#000000"} onChange={(strokeColor) => set({ strokeColor })} />
              <SliderField label={lb.strokeWidth} value={d.strokeWidth ?? 0} min={0} max={8} step={0.5} unit="px" onChange={(strokeWidth) => set({ strokeWidth })} />
            </div>
            <Segmented label={lb.animation} value={d.animation ?? "slide"} options={(["none", "fade", "slide", "pop"] as const).map((v) => ({ value: v, label: l.anims[v] }))} onChange={(animation) => set({ animation })} />
            <SwitchRow label={lb.shadow} checked={d.shadow ?? true} onCheckedChange={(shadow) => set({ shadow })} />
            <SwitchRow label={l.uppercase} checked={!!d.uppercase} onCheckedChange={(uppercase) => set({ uppercase })} />
            <Field label={lb.empty} hint={lb.emptyHint}>
              <Input value={d.emptyText ?? "—"} onChange={(e) => set({ emptyText: e.target.value })} className="w-40" />
            </Field>
          </Section>
        }
      >
        <p className="text-sm text-muted-foreground">{lb.how}</p>
        {groups.map(([title, ids]) => (
          <div key={title} className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground uppercase">{title}</span>
            {ids.map((id) => {
              const tpl = templates[id] ?? LABEL_DEF[id][2];
              return (
                <div key={id} className="grid items-center gap-2 rounded-md border px-3 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{lb.names[id]}</div>
                    <div className="truncate text-xs text-muted-foreground">{labelText(id, data, tpl, d.emptyText ?? "—", currency, t.locale)}</div>
                  </div>
                  <Input
                    value={tpl}
                    onChange={(e) => set({ templates: { ...templates, [id]: e.target.value } })}
                    className="h-8 font-mono text-xs"
                    spellCheck={false}
                    aria-label={lb.template}
                  />
                  <div className="flex items-center gap-1">
                    <Button size="icon-sm" variant="ghost" title={t.alerts.widgetUrl} aria-label={t.alerts.widgetUrl} onClick={() => navigator.clipboard.writeText(urlFor(id)).then(() => toast.success(lb.copied))}>
                      <Copy />
                    </Button>
                    <Button size="sm" variant="outline" disabled={!sceneUuid} onClick={() => add(id)}>
                      <Plus /> {lb.add}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        <p className="text-[11px] text-muted-foreground">{lb.vars}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              if (await confirmDialog({ title: lb.resetSessionQ, confirmLabel: lb.resetSession })) act((c) => c.resetLabels("session"), lb.done);
            }}
          >
            <RotateCw /> {lb.resetSession}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            onClick={async () => {
              if (await confirmDialog({ title: lb.resetAllQ, confirmLabel: lb.resetAll, destructive: true })) act((c) => c.resetLabels("all"), lb.done);
            }}
          >
            {lb.resetAll}
          </Button>
        </div>
      </WidgetShell>
      <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={reset} />
    </>
  );
}

const CREDIT_SECTIONS = ["donations", "subs", "gifts", "bits", "follows", "raids", "chatters"] as const;

function CreditsWidget() {
  const t = useT();
  const l = t.look;
  const c = l.cr;
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);
  const { draft: d, set, dirty, save, reset, saving } = useWidgetDraft("credits", reload);
  const sections = d.sections ?? [...CREDIT_SECTIONS];
  const toggle = (s: string) => set({ sections: sections.includes(s) ? sections.filter((x) => x !== s) : [...sections, s] });
  const move = (s: string, dir: -1 | 1) => {
    const i = sections.indexOf(s);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= sections.length) return;
    const next = [...sections];
    [next[i], next[j]] = [next[j], next[i]];
    set({ sections: next });
  };
  const order = [...sections, ...CREDIT_SECTIONS.filter((s) => !sections.includes(s))];
  return (
    <>
      <WidgetShell
        name="credits"
        title={c.title}
        icon={<Clapperboard />}
        previewSize={[1280, 720]}
        reloadKey={reloadKey}
        onReload={reload}
        draft={d}
        demo
        side={
          <Section title={l.appearance} className="self-start">
            <div className="grid gap-3 sm:grid-cols-2">
              <FontField label={l.font} value={d.fontFamily ?? ""} onChange={(fontFamily) => set({ fontFamily })} />
              <SliderField label={t.alerts.fontSize} value={d.fontSize ?? 34} min={16} max={80} step={1} unit="px" onChange={(fontSize) => set({ fontSize })} />
              <ColorField label={l.textColor} value={d.textColor ?? "#ffffff"} onChange={(textColor) => set({ textColor })} />
              <ColorField label={l.accentColor} value={d.accentColor ?? "#a78bfa"} onChange={(accentColor) => set({ accentColor })} />
              <ColorField label={l.bgColor} value={d.bgColor ?? "#0b0b12"} onChange={(bgColor) => set({ bgColor })} />
              <SliderField label={l.bgOpacity} value={(d.bgOpacity ?? 0) * 100} min={0} max={100} step={1} unit="%" onChange={(v) => set({ bgOpacity: v / 100 })} />
            </div>
          </Section>
        }
      >
        <p className="text-sm text-muted-foreground">{c.how}</p>
        <Field label={c.titleLabel}>
          <Input value={d.title ?? ""} onChange={(e) => set({ title: e.target.value })} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={c.subtitle}>
            <Input value={d.subtitle ?? ""} onChange={(e) => set({ subtitle: e.target.value })} />
          </Field>
          <Field label={c.outro}>
            <Input value={d.outro ?? ""} onChange={(e) => set({ outro: e.target.value })} />
          </Field>
        </div>
        <SliderField label={c.speed} value={d.speed ?? 60} min={15} max={200} step={5} unit=" px/s" onChange={(speed) => set({ speed })} />
        <Field label={c.sections} hint={c.sectionsHint}>
          <div className="flex flex-col gap-1">
            {order.map((s) => {
              const on = sections.includes(s);
              return (
                <div key={s} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm">
                  <Switch checked={on} onCheckedChange={() => toggle(s)} aria-label={c.names[s as keyof typeof c.names]} />
                  <span className={cn("flex-1", !on && "text-muted-foreground")}>{c.names[s as keyof typeof c.names]}</span>
                  {on && (
                    <>
                      <Button size="icon-sm" variant="ghost" className="size-7" onClick={() => move(s, -1)} aria-label="↑">
                        <ChevronUp />
                      </Button>
                      <Button size="icon-sm" variant="ghost" className="size-7" onClick={() => move(s, 1)} aria-label="↓">
                        <ChevronDown />
                      </Button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </Field>
        <SwitchRow label={c.showAmounts} checked={d.showAmounts ?? true} onCheckedChange={(showAmounts) => set({ showAmounts })} />
        <SwitchRow label={c.repeat} checked={d.repeat ?? true} onCheckedChange={(repeat) => set({ repeat })} />
      </WidgetShell>
      <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={reset} />
    </>
  );
}

function SongsWidget() {
  const t = useT();
  const l = t.look;
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);
  const { draft: d, set, dirty, save, reset, saving } = useWidgetDraft("songs", reload);
  return (
    <>
      <WidgetShell
        name="songs"
        title={l.sg.title}
        icon={<Music />}
        previewSize={[900, 300]}
        reloadKey={reloadKey}
        onReload={reload}
        draft={d}
        demo
        noAdd
        side={
          <Section title={l.appearance} className="self-start">
            <Field label={l.style}>
              <div className="grid grid-cols-4 gap-1.5">
                {(["glass", "solid", "neon", "minimal"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => set({ theme: v })}
                    aria-pressed={(d.theme ?? "glass") === v}
                    className={cn("rounded-md border px-2 py-2 text-xs transition-colors hover:bg-accent/50", (d.theme ?? "glass") === v && "border-primary bg-primary/5 font-medium ring-1 ring-primary/40")}
                  >
                    {l.chatThemes[v]}
                  </button>
                ))}
              </div>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <FontField label={l.font} value={d.fontFamily ?? ""} onChange={(fontFamily) => set({ fontFamily })} />
              <SliderField label={t.alerts.fontSize} value={d.fontSize ?? 24} min={12} max={56} step={1} unit="px" onChange={(fontSize) => set({ fontSize })} />
              <ColorField label={l.textColor} value={d.textColor ?? "#ffffff"} onChange={(textColor) => set({ textColor })} />
              <ColorField label={l.accentColor} value={d.accentColor ?? "#22d3ee"} onChange={(accentColor) => set({ accentColor })} />
              {(d.theme ?? "glass") !== "minimal" && <ColorField label={l.bgColor} value={d.bgColor ?? "#14121f"} onChange={(bgColor) => set({ bgColor })} />}
              {(d.theme ?? "glass") !== "minimal" && <SliderField label={l.bgOpacity} value={(d.bgOpacity ?? 0.85) * 100} min={0} max={100} step={1} unit="%" onChange={(v) => set({ bgOpacity: v / 100 })} />}
            </div>
          </Section>
        }
      >
        <p className="text-sm text-muted-foreground">{l.sg.how}</p>
        <SwitchRow label={l.sg.showCard} checked={d.showCard ?? true} onCheckedChange={(showCard) => set({ showCard })} />
        <SwitchRow label={l.sg.showVideo} hint={l.sg.showVideoHint} checked={!!d.showVideo} onCheckedChange={(showVideo) => set({ showVideo })} />
      </WidgetShell>
      <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={reset} />
    </>
  );
}

function GiveawayWidget() {
  const t = useT();
  const l = t.look;
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);
  const { draft: d, set, dirty, save, reset, saving } = useWidgetDraft("giveaway", reload);
  return (
    <>
      <WidgetShell
        name="giveaway"
        title={l.gw.title}
        icon={<Gift />}
        previewSize={[900, 480]}
        reloadKey={reloadKey}
        onReload={reload}
        draft={d}
        demo
        side={
          <Section title={l.appearance} className="self-start">
            <Field label={l.style}>
              <div className="grid grid-cols-4 gap-1.5">
                {(["glass", "solid", "neon", "minimal"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => set({ theme: v })}
                    aria-pressed={(d.theme ?? "glass") === v}
                    className={cn("rounded-md border px-2 py-2 text-xs transition-colors hover:bg-accent/50", (d.theme ?? "glass") === v && "border-primary bg-primary/5 font-medium ring-1 ring-primary/40")}
                  >
                    {l.chatThemes[v]}
                  </button>
                ))}
              </div>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <FontField label={l.font} value={d.fontFamily ?? ""} onChange={(fontFamily) => set({ fontFamily })} />
              <SliderField label={t.alerts.fontSize} value={d.fontSize ?? 28} min={14} max={64} step={1} unit="px" onChange={(fontSize) => set({ fontSize })} />
              <ColorField label={l.textColor} value={d.textColor ?? "#ffffff"} onChange={(textColor) => set({ textColor })} />
              <ColorField label={l.accentColor} value={d.accentColor ?? "#f59e0b"} onChange={(accentColor) => set({ accentColor })} />
              {(d.theme ?? "glass") !== "minimal" && <ColorField label={l.bgColor} value={d.bgColor ?? "#14121f"} onChange={(bgColor) => set({ bgColor })} />}
              {(d.theme ?? "glass") !== "minimal" && <SliderField label={l.bgOpacity} value={(d.bgOpacity ?? 0.88) * 100} min={0} max={100} step={1} unit="%" onChange={(v) => set({ bgOpacity: v / 100 })} />}
            </div>
            <SwitchRow label={l.gw.confetti} checked={d.confetti ?? true} onCheckedChange={(confetti) => set({ confetti })} />
          </Section>
        }
      >
        <p className="text-sm text-muted-foreground">{l.gw.how}</p>
      </WidgetShell>
      <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={reset} />
    </>
  );
}

function PollWidget() {
  const t = useT();
  const l = t.look;
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);
  const { draft: d, set, dirty, save, reset, saving } = useWidgetDraft("poll", reload);
  return (
    <>
      <WidgetShell
        name="poll"
        title={l.pl.title}
        icon={<BarChart3 />}
        previewSize={[900, 520]}
        reloadKey={reloadKey}
        onReload={reload}
        draft={d}
        demo
        side={
          <Section title={l.appearance} className="self-start">
            <Field label={l.style}>
              <div className="grid grid-cols-4 gap-1.5">
                {(["glass", "solid", "neon", "minimal"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => set({ theme: v })}
                    aria-pressed={(d.theme ?? "glass") === v}
                    className={cn("rounded-md border px-2 py-2 text-xs transition-colors hover:bg-accent/50", (d.theme ?? "glass") === v && "border-primary bg-primary/5 font-medium ring-1 ring-primary/40")}
                  >
                    {l.chatThemes[v]}
                  </button>
                ))}
              </div>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <FontField label={l.font} value={d.fontFamily ?? ""} onChange={(fontFamily) => set({ fontFamily })} />
              <SliderField label={t.alerts.fontSize} value={d.fontSize ?? 26} min={14} max={60} step={1} unit="px" onChange={(fontSize) => set({ fontSize })} />
              <ColorField label={l.textColor} value={d.textColor ?? "#ffffff"} onChange={(textColor) => set({ textColor })} />
              <ColorField label={l.barColor} value={d.color ?? "#7c5cff"} onChange={(color) => set({ color })} />
              <ColorField label={l.barColor2} value={d.color2 ?? "#22d3ee"} onChange={(color2) => set({ color2 })} />
              {(d.theme ?? "glass") !== "minimal" && <ColorField label={l.bgColor} value={d.bgColor ?? "#14121f"} onChange={(bgColor) => set({ bgColor })} />}
              {(d.theme ?? "glass") !== "minimal" && <SliderField label={l.bgOpacity} value={(d.bgOpacity ?? 0.85) * 100} min={0} max={100} step={1} unit="%" onChange={(v) => set({ bgOpacity: v / 100 })} />}
            </div>
            <SwitchRow label={l.showPercent} checked={d.showPercent ?? true} onCheckedChange={(showPercent) => set({ showPercent })} />
            <SwitchRow label={l.pl.showVotes} checked={d.showVotes ?? true} onCheckedChange={(showVotes) => set({ showVotes })} />
            <SwitchRow label={l.pl.showHint} checked={d.showHint ?? true} onCheckedChange={(showHint) => set({ showHint })} />
          </Section>
        }
      >
        <p className="text-sm text-muted-foreground">{l.pl.how}</p>
        <SliderField label={(d.hideAfterSec ?? 20) ? l.pl.hideAfter : `${l.pl.hideAfter} (${l.hl.untilRemoved})`} value={d.hideAfterSec ?? 20} min={0} max={120} step={5} unit=" s" onChange={(hideAfterSec) => set({ hideAfterSec })} />
      </WidgetShell>
      <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={reset} />
    </>
  );
}

function HighlightWidget() {
  const t = useT();
  const l = t.look;
  const h = l.hl;
  const current = useStore((s) => s.highlight);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);
  const { draft: d, set, dirty, save, reset, saving } = useWidgetDraft("highlight", reload);
  return (
    <>
      <WidgetShell
        name="highlight"
        title={h.title}
        icon={<Star />}
        previewSize={[1280, 360]}
        reloadKey={reloadKey}
        onReload={reload}
        draft={d}
        demo
        side={
          <Section title={l.appearance} className="self-start">
            <Field label={l.style}>
              <div className="grid grid-cols-4 gap-1.5">
                {(["glass", "solid", "neon", "minimal"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => set({ theme: v })}
                    aria-pressed={(d.theme ?? "glass") === v}
                    className={cn("rounded-md border px-2 py-2 text-xs transition-colors hover:bg-accent/50", (d.theme ?? "glass") === v && "border-primary bg-primary/5 font-medium ring-1 ring-primary/40")}
                  >
                    {l.chatThemes[v]}
                  </button>
                ))}
              </div>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <FontField label={l.font} value={d.fontFamily ?? ""} onChange={(fontFamily) => set({ fontFamily })} />
              <SliderField label={t.alerts.fontSize} value={d.fontSize ?? 34} min={16} max={72} step={1} unit="px" onChange={(fontSize) => set({ fontSize })} />
              <ColorField label={l.textColor} value={d.textColor ?? "#ffffff"} onChange={(textColor) => set({ textColor })} />
              <ColorField label={l.accentColor} value={d.accentColor ?? "#7c5cff"} onChange={(accentColor) => set({ accentColor })} />
              {(d.theme ?? "glass") !== "minimal" && <ColorField label={l.bgColor} value={d.bgColor ?? "#14121f"} onChange={(bgColor) => set({ bgColor })} />}
              {(d.theme ?? "glass") !== "minimal" && <SliderField label={l.bgOpacity} value={(d.bgOpacity ?? 0.85) * 100} min={0} max={100} step={1} unit="%" onChange={(v) => set({ bgOpacity: v / 100 })} />}
            </div>
            <Segmented label={l.animation} value={d.animation ?? "slide"} options={(["slide", "pop", "fade"] as const).map((v) => ({ value: v, label: l.anims[v] }))} onChange={(animation) => set({ animation })} />
            <SwitchRow label={t.alerts.showIcons} checked={d.showPlatform ?? true} onCheckedChange={(showPlatform) => set({ showPlatform })} />
            <SwitchRow label={t.alerts.showBadges} checked={d.showBadges ?? true} onCheckedChange={(showBadges) => set({ showBadges })} />
          </Section>
        }
      >
        <p className="text-sm text-muted-foreground">{h.how}</p>
        <SliderField label={(d.durationSec ?? 15) ? h.duration : `${h.duration} (${h.untilRemoved})`} value={d.durationSec ?? 15} min={0} max={120} step={1} unit=" s" onChange={(durationSec) => set({ durationSec })} />
        <div className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm">
          <Star className={cn("size-4", current ? "fill-amber-500 text-amber-500" : "text-muted-foreground")} />
          <span className="min-w-0 flex-1 truncate">{current ? `${current.message.user.name}: ${current.message.text}` : h.none}</span>
          {current && (
            <Button size="sm" variant="outline" onClick={() => act((c) => c.clearChatHighlight())}>
              {h.remove}
            </Button>
          )}
        </div>
      </WidgetShell>
      <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={reset} />
    </>
  );
}

type GoalKind = "donations" | "followers" | "subs" | "bits";
const GOAL_KINDS: GoalKind[] = ["donations", "followers", "subs", "bits"];
const EMPTY_GOALS: NonNullable<WidgetSettings["goals"]> = {};
const GOAL_DEFAULTS: Record<Exclude<GoalKind, "donations">, Partial<WidgetSettings["goal"]>> = {
  followers: { title: "Meta de seguidores", target: 50, color: "#22c55e", color2: "#a3e635" },
  subs: { title: "Meta de suscriptores", target: 10, color: "#8b5cf6", color2: "#ec4899" },
  bits: { title: "Meta de bits", target: 1000, color: "#a855f7", color2: "#22d3ee" },
};

/** Draft of one goal (donations = `goal`, the rest live in `goals`). */
function useGoalDraft(kind: GoalKind, onSaved: () => void) {
  const t = useT();
  const donation = useStore((s) => s.state!.widgets.goal);
  const goals = useStore((s) => s.state!.widgets.goals ?? EMPTY_GOALS);
  const value = useMemo(
    () => (kind === "donations" ? donation : ({ ...donation, current: 0, currency: "", design: null, designEnabled: false, autoTrack: true, ...GOAL_DEFAULTS[kind], ...(goals[kind] ?? {}) } as WidgetSettings["goal"])),
    [kind, donation, goals],
  );
  const d = useDraft(value);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    const body = kind === "donations" ? { goal: d.draft } : { goals: { ...goals, [kind]: d.draft } };
    await act((c) => c.setWidgets(body as Partial<WidgetSettings>), t.common.saved);
    setSaving(false);
    setTimeout(onSaved, 400);
  };
  return { ...d, save, saving };
}

function GoalWidget() {
  const [kind, setKind] = useState<GoalKind>("donations");
  return <GoalEditor key={kind} kind={kind} setKind={setKind} />;
}

function GoalEditor({ kind, setKind }: { kind: GoalKind; setKind: (k: GoalKind) => void }) {
  const t = useT();
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);
  const { draft: d, set, dirty, save, reset, saving } = useGoalDraft(kind, reload);
  const money = kind === "donations";
  const pct = d.target > 0 ? Math.min(100, (d.current / d.target) * 100) : 0;
  const [editing, setEditing] = useState(false);
  const latest = useRef(d.design);
  latest.current = d.design;
  const useEditor = (on: boolean) => {
    if (on && !d.design) set({ designEnabled: true, design: createGoalDesign(t.alerts.goal, d.reachedText || t.look.reachedPh) });
    else set({ designEnabled: on });
  };
  if (editing && d.design) {
    return (
      <>
        <div className="h-[calc(100vh-14rem)] min-h-140">
          <Editor
            design={d.design}
            update={(fn) => {
              const next = fn([latest.current!])[0];
              latest.current = next;
              set({ design: next });
            }}
            onBack={() => setEditing(false)}
            flush={async () => {}}
            status=""
            goal={{ title: d.title, currency: money ? d.currency : "", backLabel: t.look.backToGoal }}
          />
        </div>
        <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={reset} />
      </>
    );
  }
  const designer = (
    <Section title={t.look.goalLook} className="self-start">
      <div className="grid grid-cols-2 gap-1.5">
        {([false, true] as const).map((on) => (
          <button
            key={String(on)}
            type="button"
            onClick={() => useEditor(on)}
            aria-pressed={!!d.designEnabled === on}
            className={cn("flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left text-xs transition-colors hover:bg-accent/50", !!d.designEnabled === on && "border-primary bg-primary/5 ring-1 ring-primary/40")}
          >
            <span className="font-medium">{on ? t.look.lookEditor : t.look.lookClassic}</span>
            <span className="text-muted-foreground">{on ? t.look.lookEditorHint : t.look.lookClassicHint}</span>
          </button>
        ))}
      </div>
      {d.designEnabled && (
        <Button onClick={() => setEditing(true)} className="self-start">
          <Pencil /> {t.look.openEditor}
        </Button>
      )}
    </Section>
  );
  return (
    <>
      <WidgetShell
        name="goal"
        title={money ? t.alerts.goal : t.look.goalKinds[kind]}
        icon={<Goal />}
        previewSize={[1000, 220]}
        reloadKey={reloadKey}
        onReload={reload}
        draft={d}
        demo
        query={money ? "" : `type=${kind}`}
        draftKey={money ? "goal" : `goals.${kind}`}
        side={
          d.designEnabled ? designer : (
          <>
          {designer}
          <Section title={t.look.appearance} className="self-start">
            <Field label={t.look.style}>
              <div className="grid grid-cols-4 gap-1.5">
                {(["glass", "solid", "minimal", "neon"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => set({ style: v })}
                    aria-pressed={d.style === v}
                    className={cn("rounded-md border px-2 py-2 text-xs transition-colors hover:bg-accent/50", d.style === v && "border-primary bg-primary/5 font-medium ring-1 ring-primary/40")}
                  >
                    {t.look.goalStyles[v]}
                  </button>
                ))}
              </div>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <ColorField label={t.look.barColor} value={d.color ?? "#7c5cff"} onChange={(color) => set({ color })} />
              <ColorField label={t.look.barColor2} value={d.color2 ?? "#22d3ee"} onChange={(color2) => set({ color2 })} />
              <ColorField label={t.look.textColor} value={d.textColor ?? "#ffffff"} onChange={(textColor) => set({ textColor })} />
              <FontField label={t.look.font} value={d.fontFamily ?? ""} onChange={(fontFamily) => set({ fontFamily })} />
              <SliderField label={t.look.barHeight} value={d.barHeight ?? 2.1} min={0.4} max={5} step={0.1} unit="em" onChange={(barHeight) => set({ barHeight })} />
              {d.style !== "minimal" && <SliderField label={t.look.bgOpacity} value={(d.bgOpacity ?? 0.75) * 100} min={0} max={100} step={1} unit="%" onChange={(v) => set({ bgOpacity: v / 100 })} />}
            </div>
            <SwitchRow label={t.look.rounded} checked={d.rounded ?? true} onCheckedChange={(rounded) => set({ rounded })} />
            <SwitchRow label={t.look.stripes} checked={d.stripes ?? true} onCheckedChange={(stripes) => set({ stripes })} />
            <SwitchRow label={t.look.showIcon} checked={d.showIcon ?? true} onCheckedChange={(showIcon) => set({ showIcon })} />
            <SwitchRow label={t.look.showAmounts} checked={d.showAmounts ?? true} onCheckedChange={(showAmounts) => set({ showAmounts })} />
            <SwitchRow label={t.look.showPercent} checked={d.showPercent ?? true} onCheckedChange={(showPercent) => set({ showPercent })} />
            <SwitchRow label={t.look.celebrate} checked={d.celebrate ?? true} onCheckedChange={(celebrate) => set({ celebrate })} />
            {(d.celebrate ?? true) && (
              <Field label={t.look.reachedText}>
                <Input value={d.reachedText ?? ""} onChange={(e) => set({ reachedText: e.target.value })} placeholder={t.look.reachedPh} />
              </Field>
            )}
          </Section>
          </>
          )
        }
      >
        <Field label={t.look.goalKind}>
          <div className="grid grid-cols-4 gap-1.5">
            {GOAL_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                aria-pressed={kind === k}
                className={cn("rounded-md border px-2 py-2 text-xs transition-colors hover:bg-accent/50", kind === k && "border-primary bg-primary/5 font-medium ring-1 ring-primary/40")}
              >
                {t.look.goalKindShort[k]}
              </button>
            ))}
          </div>
          {dirty && <p className="text-[11px] text-amber-500">{t.look.goalSaveFirst}</p>}
        </Field>
        <Field label={t.alerts.goalTitle}>
          <Input value={d.title} onChange={(e) => set({ title: e.target.value })} />
        </Field>
        <div className={cn("grid gap-3", money ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
          <Field label={t.alerts.goalCurrent}>
            <Input type="number" value={d.current} onChange={(e) => set({ current: num(e.target.value, d.current) })} />
          </Field>
          <Field label={t.alerts.goalTarget}>
            <Input type="number" value={d.target} onChange={(e) => set({ target: num(e.target.value, d.target) })} />
          </Field>
          {money && <Field label={t.alerts.currency}>
            <Select value={d.currency} onValueChange={(currency) => set({ currency })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from(new Set([d.currency, ...CURRENCIES]))
                  .filter(Boolean)
                  .map((c) => (
                    <Opt key={c} value={c} label={c} />
                  ))}
              </SelectContent>
            </Select>
          </Field>}
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{Math.round(pct)}%</span>
            <span className="font-mono tabular-nums">
              {d.current} / {d.target} {money ? d.currency : ""}
            </span>
          </div>
          <Progress value={pct} />
        </div>
        <SwitchRow label={money ? t.alerts.autoTrack : t.look.goalAuto[kind]} checked={d.autoTrack} onCheckedChange={(autoTrack) => set({ autoTrack })} />
      </WidgetShell>
      <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={reset} />
    </>
  );
}

function CaptionsWidget() {
  const t = useT();
  const l = t.look;
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);
  const { draft: d, set, dirty, save, reset, saving } = useWidgetDraft("captions", reload);
  return (
    <>
      <WidgetShell
        name="captions"
        title={t.alerts.captions}
        icon={<Captions />}
        previewSize={[1920, 400]}
        reloadKey={reloadKey}
        onReload={reload}
        draft={d}
        demo
        side={
          <Section title={l.appearance} className="self-start">
            <Field label={l.style}>
              <div className="grid grid-cols-3 gap-1.5">
                {(["box", "outline", "banner"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => set({ theme: v })}
                    aria-pressed={(d.theme ?? "box") === v}
                    className={cn("rounded-md border px-2 py-2 text-xs transition-colors hover:bg-accent/50", (d.theme ?? "box") === v && "border-primary bg-primary/5 font-medium ring-1 ring-primary/40")}
                  >
                    {l.captionThemes[v]}
                  </button>
                ))}
              </div>
            </Field>
            <Segmented label={l.position} value={d.position ?? "bottom"} options={(["top", "center", "bottom"] as const).map((v) => ({ value: v, label: l.positions[v] }))} onChange={(position) => set({ position })} />
            <div className="grid gap-3 sm:grid-cols-2">
              <FontField label={l.font} value={d.fontFamily ?? ""} onChange={(fontFamily) => set({ fontFamily })} />
              <SliderField label={t.alerts.fontSize} value={d.fontSize} min={16} max={96} step={1} unit="px" onChange={(fontSize) => set({ fontSize })} />
              <ColorField label={l.textColor} value={d.textColor ?? "#ffffff"} onChange={(textColor) => set({ textColor })} />
              <ColorField label={l.accentColor} value={d.accentColor ?? "#5ce1e6"} onChange={(accentColor) => set({ accentColor })} />
              {(d.theme ?? "box") !== "outline" && (
                <>
                  <ColorField label={l.bgColor} value={d.bgColor ?? "#08080e"} onChange={(bgColor) => set({ bgColor })} />
                  <SliderField label={l.bgOpacity} value={(d.bgOpacity ?? 0.72) * 100} min={0} max={100} step={1} unit="%" onChange={(v) => set({ bgOpacity: v / 100 })} />
                </>
              )}
            </div>
            <SwitchRow label={l.uppercase} checked={!!d.uppercase} onCheckedChange={(uppercase) => set({ uppercase })} />
          </Section>
        }
      >
        <SwitchRow label={t.common.enabled} hint={t.alerts.captionsHint} checked={d.enabled} onCheckedChange={(enabled) => set({ enabled })} />
        <Field label={t.alerts.translateTo}>
          <Select value={toSelect(d.translateTo)} onValueChange={(v) => set({ translateTo: fromSelect(v) })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TRANSLATE_LANGS.map((lang) => (
                <Opt key={lang} value={toSelect(lang)} label={lang === "" ? t.alerts.noTranslation : t.languages[lang]} />
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <SliderField label={l.maxLines} value={d.maxLines ?? 3} min={1} max={6} step={1} onChange={(maxLines) => set({ maxLines })} />
          <SliderField label={l.hideAfter} value={d.hideAfterSec ?? 4} min={1} max={20} step={0.5} unit=" s" onChange={(hideAfterSec) => set({ hideAfterSec })} />
        </div>
        <SwitchRow label={l.showPrevious} hint={l.showPreviousHint} checked={d.showPrevious ?? true} onCheckedChange={(showPrevious) => set({ showPrevious })} />
      </WidgetShell>
      <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={reset} />
    </>
  );
}

function EventsWidget() {
  const t = useT();
  const l = t.look;
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);
  const { draft: d, set, dirty, save, reset, saving } = useWidgetDraft("events", reload);
  const types = d.types ?? [];
  const toggleType = (a: string) => {
    const all = [...new Set<string>(ALERT_TYPES)];
    const cur = types.length ? types : all;
    const next = cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a];
    if (!next.length) return; // at least one type
    set({ types: all.every((x) => next.includes(x)) ? [] : next });
  };
  const ticker = d.layout === "ticker";
  return (
    <>
      <WidgetShell
        name="events"
        title={t.alerts.events}
        icon={<ListOrdered />}
        previewSize={ticker ? [1920, 160] : [480, 640]}
        reloadKey={reloadKey}
        onReload={reload}
        draft={d}
        demo
        side={
          <Section title={l.appearance} className="self-start">
            <Field label={l.style}>
              <div className="grid grid-cols-3 gap-1.5">
                {(["glass", "solid", "minimal"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => set({ theme: v })}
                    aria-pressed={(d.theme ?? "glass") === v}
                    className={cn("rounded-md border px-2 py-2 text-xs transition-colors hover:bg-accent/50", (d.theme ?? "glass") === v && "border-primary bg-primary/5 font-medium ring-1 ring-primary/40")}
                  >
                    {l.chatThemes[v]}
                  </button>
                ))}
              </div>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <FontField label={l.font} value={d.fontFamily ?? ""} onChange={(fontFamily) => set({ fontFamily })} />
              <SliderField label={t.alerts.fontSize} value={d.fontSize ?? 18} min={12} max={48} step={1} unit="px" onChange={(fontSize) => set({ fontSize })} />
              <ColorField label={l.textColor} value={d.textColor ?? "#ffffff"} onChange={(textColor) => set({ textColor })} />
              {(d.theme ?? "glass") !== "minimal" && <ColorField label={l.bgColor} value={d.bgColor ?? "#1a1828"} onChange={(bgColor) => set({ bgColor })} />}
              {(d.theme ?? "glass") !== "minimal" && <SliderField label={l.bgOpacity} value={(d.bgOpacity ?? 0.7) * 100} min={0} max={100} step={1} unit="%" onChange={(v) => set({ bgOpacity: v / 100 })} />}
              {!ticker && <SliderField label={l.radius} value={d.radius ?? 0.8} min={0} max={2} step={0.05} unit="em" onChange={(radius) => set({ radius })} />}
              <ColorField label={l.accentColor} value={d.color ?? "#7c5cff"} onChange={(color) => set({ color })} />
              {ticker && <ColorField label={l.barColor2} value={d.color2 ?? "#22d3ee"} onChange={(color2) => set({ color2 })} />}
            </div>
            <SwitchRow label={l.showIcons} checked={d.showIcons ?? true} onCheckedChange={(showIcons) => set({ showIcons })} />
            <SwitchRow label={t.alerts.showIcons} checked={d.showPlatform ?? true} onCheckedChange={(showPlatform) => set({ showPlatform })} />
            {!ticker && <SwitchRow label={l.showTime} checked={d.showTime ?? true} onCheckedChange={(showTime) => set({ showTime })} />}
            {!ticker && <SwitchRow label={l.fadeOld} checked={d.fadeOld ?? true} onCheckedChange={(fadeOld) => set({ fadeOld })} />}
          </Section>
        }
      >
        <Field label={l.layout}>
          <div className="grid grid-cols-2 gap-1.5">
            {(["list", "ticker"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => set({ layout: v })}
                aria-pressed={(d.layout ?? "list") === v}
                className={cn("flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left text-xs transition-colors hover:bg-accent/50", (d.layout ?? "list") === v && "border-primary bg-primary/5 ring-1 ring-primary/40")}
              >
                <span className="font-medium">{l.layouts[v]}</span>
                <span className="text-muted-foreground">{l.layoutHints[v]}</span>
              </button>
            ))}
          </div>
        </Field>
        <SwitchRow label={l.showTitle} checked={d.showTitle ?? true} onCheckedChange={(showTitle) => set({ showTitle })} />
        {(d.showTitle ?? true) && (
          <Field label={l.titleText}>
            <Input value={d.titleText ?? ""} onChange={(e) => set({ titleText: e.target.value })} placeholder={l.titlePh} />
          </Field>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <SliderField label={l.maxEvents} value={d.maxEvents ?? 10} min={1} max={30} step={1} onChange={(maxEvents) => set({ maxEvents })} />
          {ticker && <SliderField label={l.speed} value={d.speed ?? 90} min={20} max={300} step={5} unit=" px/s" onChange={(speed) => set({ speed })} />}
        </div>
        <Field label={l.typesShown} hint={types.length ? undefined : l.allTypes}>
          <div className="flex flex-wrap gap-1.5">
            {ALERT_TYPES.map((a) => {
              const on = types.length === 0 || types.includes(a);
              const Icon = ALERT_META[a].icon;
              return (
                <button
                  key={a}
                  type="button"
                  onClick={() => toggleType(a)}
                  aria-pressed={on}
                  className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors", on ? "border-primary/50 bg-primary/10 text-foreground" : "text-muted-foreground opacity-60 hover:opacity-100")}
                >
                  <Icon className="size-3" /> {t.alerts.types[a]}
                </button>
              );
            })}
          </div>
        </Field>
        <SwitchRow label={l.keepHistory} hint={l.keepHistoryHint} checked={d.keepHistory ?? true} onCheckedChange={(keepHistory) => set({ keepHistory })} />
      </WidgetShell>
      <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={reset} />
    </>
  );
}

// ------------------------------------------------------------------ activity / Ko-fi

function Activity() {
  const t = useT();
  return (
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <Section
        title={t.alerts.testAlerts}
        icon={<Play />}
        className="self-start"
        action={
          <Button size="sm" variant="ghost" onClick={() => act((c) => c.skipAlert())}>
            <SkipForward /> {t.alerts.skip}
          </Button>
        }
      >
        <div className="grid grid-cols-2 gap-1.5">
          {ALERT_TYPES.map((a) => {
            const Icon = ALERT_META[a].icon;
            return (
              <Button key={a} size="sm" variant="outline" className="justify-start px-2.5" onClick={() => act((c) => c.testAlert(a), t.alerts.testSent)} data-testid={`test-alert-${a}`}>
                <Icon className="size-3.5 text-muted-foreground" />
                <span className="truncate">{t.alerts.types[a]}</span>
              </Button>
            );
          })}
        </div>
      </Section>
      <Section title={t.alerts.feed} icon={<Zap />} description={t.alerts.feedEmptyDesc}>
        <div className="-mx-2">
          <EventList />
        </div>
      </Section>
    </div>
  );
}

function KofiSection() {
  const t = useT();
  const client = useStore((s) => s.client);
  const current = useStore((s) => s.state?.general.kofiVerificationToken ?? "");
  const mutate = useStore((s) => s.mutate);
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    const r = await act((c) => c.setGeneral({ kofiVerificationToken: token.trim() }), t.common.saved);
    if (r) {
      mutate((s) => ({ ...s, general: { ...s.general, ...r } }));
      setToken("");
    }
    setSaving(false);
  };
  return (
    <Section
      title={t.alerts.kofi}
      description={t.alerts.kofiDesc}
      icon={<KofiIcon size={16} />}
      action={<Badge variant={current ? "secondary" : "outline"}>{current ? t.alerts.configured : t.alerts.notConfigured}</Badge>}
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <Steps steps={t.alerts.kofiSteps} />
        <div className="flex min-w-0 flex-col gap-4">
          <Field label={t.alerts.kofiWebhook}>
            <CopyField value={client?.url("/webhooks/kofi") ?? ""} />
          </Field>
          <Field label={t.alerts.kofiToken}>
            <div className="flex gap-2">
              <SecretInput className="flex-1" value={token} onChange={setToken} placeholder={current || "xxxxxxxx-xxxx-xxxx"} />
              <Button disabled={!token.trim() || saving} onClick={save}>
                {t.common.save}
              </Button>
            </div>
          </Field>
        </div>
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------ panel

/** Tool panel: alerts feed & tests, overlay widgets and Ko-fi. */
export function AlertsPanel() {
  const t = useT();
  const [tab, setTab] = useState<Tab>("designer");
  return (
    <PanelNav
      value={tab}
      onValueChange={setTab}
      groups={[
        {
          label: t.look.nav.alerts,
          items: [
            { value: "designer", label: t.designer.tab, icon: <Palette /> },
            { value: "alertBox", label: t.look.nav.general, icon: <BellRing /> },
            { value: "activity", label: t.alerts.feed, icon: <Zap /> },
            { value: "kofi", label: t.alerts.kofi, icon: <KofiIcon size={16} /> },
          ],
        },
        {
          label: t.look.nav.chat,
          items: [
            { value: "chatBox", label: t.alerts.chatBox, icon: <MessageSquareText /> },
            { value: "highlight", label: t.look.hl.tab, icon: <Star /> },
          ],
        },
        {
          label: t.look.nav.data,
          items: [
            { value: "labels", label: t.look.lb.tab, icon: <Tag /> },
            { value: "goal", label: t.look.goalsTab, icon: <Goal /> },
            { value: "counters", label: t.look.ct.tab, icon: <Hash /> },
            { value: "events", label: t.alerts.events, icon: <ListOrdered /> },
            { value: "credits", label: t.look.cr.tab, icon: <Clapperboard /> },
          ],
        },
        {
          label: t.look.nav.interact,
          items: [
            { value: "poll", label: t.look.pl.tab, icon: <BarChart3 /> },
            { value: "giveaway", label: t.look.gw.tab, icon: <Gift /> },
            { value: "songs", label: t.look.sg.tab, icon: <Music /> },
          ],
        },
        {
          label: t.look.nav.more,
          items: [
            { value: "captions", label: t.alerts.captions, icon: <Captions /> },
            { value: "audio", label: t.audioReactive.tab, icon: <AudioLines /> },
          ],
        },
      ]}
    >
      <TabsContent value="audio">
        <AudioReactiveSection />
      </TabsContent>
      <TabsContent value="activity">
        <Activity />
      </TabsContent>
      <TabsContent value="designer">
        <AlertDesigner />
      </TabsContent>
      <TabsContent value="alertBox">
        <AlertBoxWidget />
      </TabsContent>
      <TabsContent value="chatBox">
        <ChatBoxWidget />
      </TabsContent>
      <TabsContent value="credits">
        <CreditsWidget />
      </TabsContent>
      <TabsContent value="songs">
        <SongsWidget />
      </TabsContent>
      <TabsContent value="counters">
        <CountersPanel />
      </TabsContent>
      <TabsContent value="giveaway">
        <GiveawayWidget />
      </TabsContent>
      <TabsContent value="poll">
        <PollWidget />
      </TabsContent>
      <TabsContent value="labels">
        <LabelsWidget />
      </TabsContent>
      <TabsContent value="highlight">
        <HighlightWidget />
      </TabsContent>
      <TabsContent value="goal">
        <GoalWidget />
      </TabsContent>
      <TabsContent value="captions">
        <CaptionsWidget />
      </TabsContent>
      <TabsContent value="events">
        <EventsWidget />
      </TabsContent>
      <TabsContent value="kofi">
        <KofiSection />
      </TabsContent>
    </PanelNav>
  );
}
