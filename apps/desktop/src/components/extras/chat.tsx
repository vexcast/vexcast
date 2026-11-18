import { create } from "zustand";
import { EMPTY } from "@/lib/store";
import type { AlertEvent, AlertType, ChatMessage, ChatPlatform } from "@vexcast/protocol";
import { ArrowDown, Bot, Check, Languages, Loader2, Crown, Diamond, Gem, Gift, Heart, Send, Settings2, ShieldAlert, ShieldCheck, SkipForward, Sparkles, Star, Swords, Trash2, UserPlus, Users, Zap } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { toast } from "sonner";
import { EmptyHint, Dock, ToolButton } from "@/components/docks/dock";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLang, useT } from "@/i18n";
import { goTo } from "@/lib/prefs";
import { fmt, formatMoney, formatTime, timeAgo } from "@/lib/format";
import { chatPlatformMeta, KofiIcon } from "@/lib/platforms";
import { act, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

// ------------------------------------------------------------------ chat

/** Fallback badges (no picture from the platform): icon + the platform's usual color. */
const BADGE_ICON: Record<string, ReactNode> = {
  broadcaster: <Crown />,
  moderator: <ShieldCheck />,
  vip: <Diamond />,
  subscriber: <Star />,
  founder: <Star />,
  member: <Star />,
  og: <Gem />,
  verified: <ShieldCheck />,
  partner: <ShieldCheck />,
  staff: <Zap />,
  sub_gifter: <Gift />,
  bot: <Bot />,
};
const BADGE_COLOR: Record<string, string> = {
  broadcaster: "#E91916",
  moderator: "#00AD03",
  vip: "#E005B9",
  subscriber: "#8205B4",
  founder: "#8205B4",
  member: "#2BA640",
  og: "#1D7A4A",
  verified: "#1F69FF",
  partner: "#9146FF",
  staff: "#000000",
  sub_gifter: "#F0A100",
  bot: "#0891B2",
};

function PlatformIcon({ platform, size = 14, className }: { platform: ChatPlatform | "kofi"; size?: number; className?: string }) {
  const m = chatPlatformMeta(platform);
  const Icon = m.icon;
  return (
    <span className={cn("inline-flex shrink-0", className)} style={{ color: m.color }} title={m.name}>
      <Icon size={size} />
    </span>
  );
}

/** Questions marked as answered (this session). */
export const useAnswered = create<{ ids: Set<string>; mark: (id: string) => void }>((set) => ({
  ids: new Set(),
  mark: (id) => set((s) => ({ ids: new Set(s.ids).add(id) })),
}));

/** "Nuevo" / "Vuelve" chip from what Vexcast knows about the author. */
function ViewerChip({ msg }: { msg: ChatMessage }) {
  const t = useT();
  const a = t.chatAssist;
  const v = msg.viewer;
  if (!v || msg.isBot) return null;
  if (v.firstTime)
    return (
      <span title={a.newTitle} className="mr-1 inline-flex h-4 translate-y-[-1px] items-center rounded-[3px] bg-emerald-500/15 px-1 align-middle text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
        {a.new}
      </span>
    );
  if (v.returning)
    return (
      <span
        title={v.daysAway ? fmt(a.backTitle, { days: v.daysAway, n: v.messages }) : fmt(a.backTitleToday, { n: v.messages })}
        className="mr-1 inline-flex h-4 translate-y-[-1px] items-center rounded-[3px] bg-sky-500/15 px-1 align-middle text-[10px] font-semibold text-sky-600 dark:text-sky-400"
      >
        {a.back}
      </span>
    );
  return null;
}

export const ChatRow = memo(function ChatRow({ msg, compact, canDelete, onAnswered }: { msg: ChatMessage; compact?: boolean; canDelete?: boolean; onAnswered?: () => void }) {
  const t = useT();
  const a = t.chatAssist;
  const [translating, setTranslating] = useState(false);
  const canTranslate = !msg.isBot && !msg.translated && msg.platform !== "vexcast";
  const highlighted = useStore((s) => s.highlight?.message.id === msg.id);
  const canHighlight = !msg.isBot && !compact;
  const toggleHighlight = () => act((c) => (highlighted ? c.clearChatHighlight() : c.highlightChatMessage(msg.id)));
  const translate = async () => {
    setTranslating(true);
    const r = await act((c) => c.translateChat(msg.id));
    setTranslating(false);
    if (r && !r.text) toast.info(a.sameLanguage);
  };
  return (
    <div
      className={cn(
        "group relative flex gap-2 rounded-md px-2",
        compact ? "py-1" : "py-1.5",
        msg.flagged ? "bg-destructive/10" : msg.isBot ? "bg-muted/60" : msg.question ? "bg-amber-500/5 hover:bg-amber-500/10" : "hover:bg-muted/50",
        msg.question && !msg.flagged && "shadow-[inset_2px_0_0_var(--color-amber-500)]",
        highlighted && "bg-amber-500/10 ring-1 ring-amber-500/40",
      )}
      data-testid="chat-row"
    >
      <PlatformIcon platform={msg.platform} size={compact ? 12 : 14} className="mt-[3px]" />
      <div className={cn("selectable min-w-0 flex-1 leading-relaxed break-words", compact ? "text-xs" : "text-sm", canDelete && "pr-6")}>
        {!compact && <span className="mr-1.5 font-mono text-[11px] text-muted-foreground tabular-nums">{formatTime(msg.ts, t.locale)}</span>}
        {msg.user.badges.map((b, i) =>
          b.image ? (
            <img key={`${b.id}-${i}`} src={b.image} alt={b.label} title={b.label} loading="lazy" className="mr-1 inline-block size-[18px] translate-y-[-1px] align-middle" />
          ) : (
            <span
              key={`${b.id}-${i}`}
              title={b.label}
              className="mr-1 inline-grid size-[18px] translate-y-[-1px] place-items-center rounded-[3px] align-middle text-white [&_svg]:size-3"
              style={{ background: BADGE_COLOR[b.id] ?? "var(--muted-foreground)" }}
            >
              {BADGE_ICON[b.id] ?? <Sparkles />}
            </span>
          ),
        )}
        <ViewerChip msg={msg} />
        <span className={cn("font-semibold", !msg.user.color && "text-foreground")} style={msg.user.color ? { color: msg.user.color } : undefined}>
          {msg.user.name}
        </span>
        <span className="text-muted-foreground">: </span>
        <span className={cn(msg.flagged ? "text-muted-foreground line-through" : "text-foreground")}>{msg.text}</span>
        {msg.flagged && (
          <Badge variant="destructive" className="ml-1.5 h-4 translate-y-[-1px] px-1 text-[10px]">
            <ShieldAlert /> {t.chat.flagged}
          </Badge>
        )}
        {msg.translated && (
          <span className="mt-0.5 flex items-start gap-1 text-muted-foreground italic">
            <Languages className="mt-[3px] size-3 shrink-0" />
            <span>{msg.translated}</span>
          </span>
        )}
      </div>
      {(canTranslate || onAnswered || canHighlight) && (
        <div className={cn("absolute top-0.5 flex gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100", canDelete ? "right-7" : "right-0.5")}>
          {onAnswered && (
            <Button variant="ghost" size="icon-sm" className="size-6 bg-background text-muted-foreground hover:text-emerald-600" onClick={onAnswered} title={a.answered} aria-label={a.answered}>
              <Check className="size-3.5" />
            </Button>
          )}
          {canHighlight && (
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn("size-6 bg-background hover:text-amber-500", highlighted ? "text-amber-500" : "text-muted-foreground")}
              onClick={toggleHighlight}
              title={highlighted ? t.chat.unhighlight : t.chat.highlight}
              aria-label={highlighted ? t.chat.unhighlight : t.chat.highlight}
              aria-pressed={highlighted}
            >
              <Star className={cn("size-3.5", highlighted && "fill-current")} />
            </Button>
          )}
          {canTranslate && (
            <Button variant="ghost" size="icon-sm" className="size-6 bg-background text-muted-foreground hover:text-foreground" onClick={translate} disabled={translating} title={a.translate} aria-label={a.translate}>
              {translating ? <Loader2 className="size-3.5 animate-spin" /> : <Languages className="size-3.5" />}
            </Button>
          )}
        </div>
      )}
      {canDelete && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute top-0.5 right-0.5 size-6 bg-background text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100"
          onClick={() => act((c) => c.deleteChatMessage(msg.id))}
          title={t.chat.deleteMsg}
          aria-label={t.chat.deleteMsg}
        >
          <Trash2 className="size-3.5" />
        </Button>
      )}
    </div>
  );
});

/** Scrolling list of chat messages that sticks to the bottom unless the user scrolls up. */
export function ChatList({ compact, filter, className }: { compact?: boolean; filter?: ChatPlatform | "all" | "questions"; className?: string }) {
  const t = useT();
  const chat = useStore((s) => s.chat);
  const answered = useAnswered((s) => s.ids);
  const mark = useAnswered((s) => s.mark);
  const questions = filter === "questions";
  const list = questions ? chat.filter((m) => m.question && !m.isBot && !answered.has(m.id)) : filter && filter !== "all" ? chat.filter((m) => m.platform === filter) : chat;
  const ref = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(true);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stuck) el.scrollTop = el.scrollHeight;
  }, [list.length, stuck, filter]);

  const onScroll = () => {
    const el = ref.current;
    if (el) setStuck(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  };

  return (
    <div className={cn("relative min-h-0 flex-1", className)}>
      <div ref={ref} onScroll={onScroll} className="absolute inset-0 overflow-x-hidden overflow-y-auto px-1.5 py-1">
        {list.length === 0 ? (
          <EmptyHint title={questions ? t.chatAssist.noQuestions : t.chat.empty} hint={compact || questions ? undefined : t.chat.emptyDesc} />
        ) : (
          <div className="flex flex-col gap-px">
            {list.map((m) => (
              <ChatRow key={m.id} msg={m} compact={compact} canDelete onAnswered={questions ? () => mark(m.id) : undefined} />
            ))}
          </div>
        )}
      </div>
      {!stuck && (
        <Button size="sm" variant="secondary" onClick={() => setStuck(true)} className="absolute bottom-2 left-1/2 h-7 -translate-x-1/2 rounded-full border px-3 text-xs shadow-sm">
          <ArrowDown /> {t.chat.autoscroll}
        </Button>
      )}
    </div>
  );
}

/** Message input with a target selector (all connected platforms or one). */
export function ChatComposer({ compact, className }: { compact?: boolean; className?: string }) {
  const t = useT();
  const connections = useStore((s) => s.state?.chat ?? EMPTY);
  const connected = connections.filter((c) => c.state === "connected").map((c) => c.platform);
  const connectedKey = connected.join(",");
  const [text, setText] = useState("");
  const [target, setTarget] = useState<ChatPlatform | "all">("all");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (target !== "all" && !connected.includes(target)) setTarget("all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedKey, target]);

  const send = async () => {
    const v = text.trim();
    if (!v || sending) return;
    setSending(true);
    const ok = await act((c) => c.sendChat(v, target === "all" ? undefined : [target]).then(() => true));
    if (ok) setText("");
    setSending(false);
  };

  return (
    <div className={cn("flex shrink-0 items-center gap-1.5 border-t", compact ? "p-1.5" : "p-3", className)}>
      <Select value={target} onValueChange={(v) => setTarget(v as ChatPlatform | "all")}>
        <SelectTrigger size="sm" aria-label={t.chat.sendTo} title={t.chat.sendTo} className={cn("shrink-0", compact ? "w-auto gap-1 px-2 [&_[data-label]]:hidden" : "w-36")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">
            <Users className="size-3.5" />
            <span data-label>{t.chat.allPlatforms}</span>
          </SelectItem>
          {connected.map((p) => {
            const m = chatPlatformMeta(p);
            const Icon = m.icon;
            return (
              <SelectItem key={p} value={p}>
                <span style={{ color: m.color }} className="inline-flex">
                  <Icon size={14} />
                </span>
                <span data-label>{m.name}</span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        placeholder={t.chat.placeholder}
        className="h-8 min-w-0 flex-1 text-sm"
        data-testid="chat-input"
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon-sm" onClick={send} disabled={!text.trim() || sending} aria-label={t.chat.send}>
            <Send />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t.chat.send}</TooltipContent>
      </Tooltip>
    </div>
  );
}

// ------------------------------------------------------------------ events

export const ALERT_META: Record<AlertType, { icon: ComponentType<{ className?: string }> }> = {
  follow: { icon: UserPlus },
  subscription: { icon: Star },
  gift_sub: { icon: Gift },
  raid: { icon: Swords },
  bits: { icon: Gem },
  superchat: { icon: Zap },
  donation: { icon: Heart },
  kofi: { icon: KofiIcon },
  member: { icon: Crown },
  host: { icon: Users },
};

export const ALERT_TYPES = Object.keys(ALERT_META) as AlertType[];

function eventAmount(ev: AlertEvent, t: ReturnType<typeof useT>): string | null {
  if (ev.amount == null) return null;
  if (ev.currency) return formatMoney(ev.amount, ev.currency, t.locale);
  if (ev.type === "bits") return `${ev.amount.toLocaleString(t.locale)} ${t.alerts.units.bits}`;
  if (ev.type === "raid" || ev.type === "host") return `${ev.amount.toLocaleString(t.locale)} ${t.alerts.units.viewers}`;
  if (ev.type === "subscription" || ev.type === "member") return `${ev.amount} ${t.alerts.units.months}`;
  if (ev.type === "gift_sub") return `×${ev.amount}`;
  return String(ev.amount);
}

export function EventRow({ ev, compact }: { ev: AlertEvent; compact?: boolean }) {
  const t = useT();
  const lang = useLang();
  const Icon = ALERT_META[ev.type]?.icon ?? Sparkles;
  const amount = eventAmount(ev, t);
  return (
    <div className={cn("flex items-start gap-2.5 rounded-md px-2", compact ? "py-1.5" : "py-2")} data-testid="event-row">
      <span className={cn("grid shrink-0 place-items-center rounded-md border bg-muted text-muted-foreground", compact ? "size-7" : "size-8")}>
        <Icon className={compact ? "size-3.5" : "size-4"} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={cn("truncate font-medium", compact ? "text-xs" : "text-sm")}>{ev.user}</span>
          <PlatformIcon platform={ev.platform} size={11} />
          {ev.test && (
            <Badge variant="outline" className="h-4 px-1 text-[9px] uppercase">
              {t.alerts.test}
            </Badge>
          )}
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground tabular-nums">{timeAgo(ev.ts, lang)}</span>
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">{t.alerts.types[ev.type]}</span>
          {amount && <span className="shrink-0 font-medium text-foreground">{amount}</span>}
        </div>
        {ev.message && <div className={cn("selectable mt-1 rounded-md bg-muted/60 px-2 py-1 leading-relaxed break-words", compact ? "line-clamp-3 text-xs" : "text-sm")}>{ev.message}</div>}
      </div>
    </div>
  );
}

/** Scrollable events feed. */
export function EventList({ compact, className }: { compact?: boolean; className?: string }) {
  const t = useT();
  const events = useStore((s) => s.events);
  if (events.length === 0) return <EmptyHint title={t.alerts.feedEmpty} hint={compact ? undefined : t.alerts.feedEmptyDesc} />;
  return (
    <div className={cn("flex flex-col gap-px", className)}>
      {events.map((ev) => (
        <EventRow key={ev.id} ev={ev} compact={compact} />
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ docks

export function ChatDock() {
  const t = useT();
  return (
    <Dock title={t.docks.chat} testId="dock-chat" actions={<ToolButton icon={Settings2} label={t.menu.chat} onClick={() => goTo("chat")} />}>
      <div className="absolute inset-0 flex flex-col">
        <ChatList compact />
        <ChatComposer compact />
      </div>
    </Dock>
  );
}

export function EventsDock() {
  const t = useT();
  return (
    <Dock
      title={t.docks.events}
      testId="dock-events"
      actions={
        <>
          <ToolButton icon={SkipForward} label={t.alerts.skip} onClick={() => act((c) => c.skipAlert())} />
          <ToolButton icon={Settings2} label={t.menu.alerts} onClick={() => goTo("alerts")} />
        </>
      }
    >
      <div className="absolute inset-0 overflow-x-hidden overflow-y-auto p-1">
        <EventList compact />
      </div>
    </Dock>
  );
}
