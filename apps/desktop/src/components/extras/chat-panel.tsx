import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EMPTY } from "@/lib/store";
import type { AccountPlatform, ChatConnection, ChatPlatform } from "@vexcast/protocol";
import { BarChart3, Gift, Languages, Link2, Loader2, MessageCircleQuestion, Plus, RefreshCw, Sparkles, Star, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/i18n";
import { fmt } from "@/lib/format";
import { chatPlatformMeta } from "@/lib/platforms";
import { act, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { ConnectAccountButton } from "@/components/accounts/connect-button";
import { ChatComposer, ChatList, useAnswered } from "./chat";
import { Field, SecretInput } from "./shared";

const CONN_PLATFORMS: ChatPlatform[] = ["twitch", "youtube", "kick", "tiktok"];

/** "Preguntas (n)": pending questions from chat. */
function QuestionsButton({ active, onClick }: { active: boolean; onClick: () => void }) {
  const t = useT();
  const answered = useAnswered((s) => s.ids);
  const n = useStore((s) => s.chat.filter((m) => m.question && !m.isBot && !answered.has(m.id)).length);
  return (
    <Button size="sm" variant={active ? "secondary" : "ghost"} className="h-7 shrink-0 gap-1.5 px-2 text-xs" onClick={onClick} data-testid="chat-questions">
      <MessageCircleQuestion className="size-3.5" />
      <span className="hidden sm:inline">{t.chatAssist.questions}</span>
      {n > 0 && <Badge className="h-4 px-1 text-[10px] tabular-nums">{n}</Badge>}
    </Button>
  );
}

/** AI summary of the recent chat. */
function SummaryButton() {
  const t = useT();
  const a = t.chatAssist;
  const engine = useStore((s) => s.state?.ai.llm.provider ?? "none");
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const r = await act((c) => c.chatSummary());
    setBusy(false);
    if (r) setText(r.text);
  };
  return (
    <Popover onOpenChange={(o) => o && !text && !busy && engine !== "none" && run()}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 shrink-0 gap-1.5 px-2 text-xs" data-testid="chat-summary">
          <Sparkles className="size-3.5" />
          <span className="hidden sm:inline">{a.summary}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-1rem)]">
        <div className="mb-2 flex items-center gap-2">
          <Sparkles className="size-4 text-muted-foreground" />
          <span className="flex-1 text-sm font-medium">{a.summaryTitle}</span>
          {engine !== "none" && (
            <Button size="sm" variant="outline" className="h-7" onClick={run} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} {a.refresh}
            </Button>
          )}
        </div>
        {engine === "none" ? (
          <p className="text-sm text-muted-foreground">{a.needsEngine}</p>
        ) : busy && !text ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> {a.summarizing}
          </p>
        ) : (
          <p className="selectable text-sm leading-relaxed whitespace-pre-wrap">{text}</p>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Auto-translation toggle (text engine). */
function AssistSettings() {
  const t = useT();
  const a = t.chatAssist;
  const auto = useStore((s) => !!s.state?.ai.assist?.autoTranslate);
  const engine = useStore((s) => s.state?.ai.llm.provider ?? "none");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="icon-sm" variant={auto ? "secondary" : "ghost"} className="size-7 shrink-0" aria-label={a.assist} title={a.assist}>
          <Languages className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{a.autoTranslate}</div>
            <p className="mt-0.5 text-xs text-muted-foreground">{engine === "none" ? a.needsEngine : a.autoTranslateHint}</p>
          </div>
          <Switch checked={auto} disabled={engine === "none"} onCheckedChange={(v) => act((c) => c.setAi({ assist: { autoTranslate: v } }))} aria-label={a.autoTranslate} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
const isAccountPlatform = (p: ChatPlatform): p is AccountPlatform => p === "twitch" || p === "kick";

/** "Conectar con …" (OAuth) shortcut, or "Conectado como X" once the account is linked. */
function AccountShortcut({ platform }: { platform: AccountPlatform }) {
  const t = useT();
  const account = useStore((s) => s.state?.accounts?.find((a) => a.platform === platform));
  if (!account) return null;
  if (account.connected)
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid={`chat-account-${platform}`}>
        <span className="size-1.5 rounded-full bg-emerald-500" />
        {fmt(t.accounts.connectedAs, { name: account.displayName || account.login || "" })}
      </p>
    );
  return <ConnectAccountButton platform={platform} size="sm" className="w-full" />;
}

const STATE_DOT: Record<ChatConnection["state"], string> = {
  connected: "bg-emerald-500",
  connecting: "bg-amber-500",
  error: "bg-destructive",
  disconnected: "bg-muted-foreground/40",
};

export function ConnectionState({ state }: { state: ChatConnection["state"] }) {
  const t = useT();
  return (
    <Badge variant={state === "error" ? "destructive" : "outline"} className="gap-1.5">
      {state !== "error" && <span className={cn("size-1.5 rounded-full", STATE_DOT[state])} />}
      {t.chat.state[state]}
    </Badge>
  );
}

function ConnectionCard({ platform }: { platform: ChatPlatform }) {
  const t = useT();
  const conn = useStore((s) => s.state?.chat.find((c) => c.platform === platform));
  const meta = chatPlatformMeta(platform);
  const Icon = meta.icon;
  const id = useId();
  const [channel, setChannel] = useState(conn?.channel ?? "");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setChannel(conn?.channel ?? ""), [conn?.channel]);

  const state: ChatConnection["state"] = conn?.state ?? "disconnected";
  const save = async (enabled: boolean) => {
    setBusy(true);
    // An empty token keeps the stored one (the core returns it masked as "••••").
    const ok = await act((c) => c.setChatConnection({ platform, channel: channel.trim(), enabled, token: token || conn?.token || "" }).then(() => true));
    if (ok) setToken("");
    setBusy(false);
  };
  const dirty = channel.trim() !== (conn?.channel ?? "") || token !== "";

  const labels: Record<ChatPlatform, { channel: string; token: string | null; hint: string | null; ph: string }> = {
    twitch: { channel: t.chat.twitchChannel, token: t.chat.twitchToken, hint: t.chat.twitchTokenHint, ph: "mi_canal" },
    youtube: { channel: t.chat.youtubeChannel, token: t.chat.youtubeKey, hint: t.chat.youtubeKeyHint, ph: "UCxxxxxxxx / dQw4w9WgXcQ" },
    kick: { channel: t.chat.kickChannel, token: null, hint: null, ph: "mi-canal" },
    tiktok: { channel: t.chat.tiktokChannel, token: null, hint: t.chat.tiktokHint, ph: "@usuario" },
    vexcast: { channel: "", token: null, hint: null, ph: "" },
  };
  const l = labels[platform];

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3" data-testid={`chat-conn-${platform}`}>
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-md border bg-muted" style={{ color: meta.color }}>
          <Icon size={16} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-sm leading-none font-medium">{meta.name}</span>
          <div className="flex flex-wrap items-center gap-1.5">
            <ConnectionState state={state} />
            {platform === "twitch" && state === "connected" && !conn?.token && <span className="text-xs text-muted-foreground">{t.chat.readOnly}</span>}
          </div>
        </div>
        <Switch
          checked={!!conn?.enabled}
          onCheckedChange={(v) => save(v)}
          disabled={busy || (!channel.trim() && !conn?.enabled)}
          aria-label={`${meta.name} · ${t.common.enabled}`}
        />
      </div>
      {isAccountPlatform(platform) && <AccountShortcut platform={platform} />}
      {conn?.error && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs break-words text-destructive">{conn.error}</p>}
      <Field label={l.channel} htmlFor={`${id}-ch`} hint={l.token ? undefined : l.hint}>
        <Input id={`${id}-ch`} value={channel} onChange={(e) => setChannel(e.target.value)} placeholder={l.ph} spellCheck={false} />
      </Field>
      {l.token && (
        <Field label={l.token} htmlFor={`${id}-tk`} hint={l.hint}>
          <SecretInput id={`${id}-tk`} value={token} onChange={setToken} placeholder={conn?.token || "••••"} />
        </Field>
      )}
      {dirty && (
        <Button size="sm" disabled={busy || !channel.trim()} onClick={() => save(true)}>
          <Link2 /> {t.chat.connect}
        </Button>
      )}
    </div>
  );
}

/** Tool panel: unified chat + per-platform chat connections. */
/** Create a chat poll (counted on every platform) or follow the one running. */
function PollButton() {
  const t = useT();
  const p = t.chat.poll;
  const poll = useStore((s) => s.poll);
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [duration, setDuration] = useState(60);
  const [announce, setAnnounce] = useState(true);
  const [prediction, setPrediction] = useState(false);
  const loyaltyOn = useStore((s) => !!s.state?.bot.enabled && !!s.state?.bot.loyalty?.enabled);
  const unit = useStore((s) => s.state?.bot.loyalty?.name ?? "puntos");
  const [busy, setBusy] = useState(false);
  const valid = question.trim() && options.filter((o) => o.trim()).length >= 2;
  const start = async () => {
    setBusy(true);
    const r = await act((c) => c.startPoll({ question, options: options.filter((o) => o.trim()), durationSec: duration, announce, prediction: prediction && loyaltyOn }), p.started);
    setBusy(false);
    if (r) {
      setQuestion("");
      setOptions(["", ""]);
    }
  };
  const isPred = !!poll?.prediction;
  const values = poll ? (isPred ? (poll.bets ?? poll.votes) : poll.votes) : [];
  const total = values.reduce((a, b) => a + b, 0);
  const pending = isPred && !poll?.open && poll?.result == null && !poll?.refunded;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant={poll?.open ? "secondary" : "ghost"} className="h-7 gap-1.5 px-2 text-xs">
          <BarChart3 className={cn("size-3.5", (poll?.open || pending) && "text-primary")} /> {poll?.open ? `${isPred ? p.betting : p.live} · ${total}` : pending ? p.pickResult : p.title}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        {poll ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-semibold">{poll.question}</span>
              <Badge variant={poll.open ? "default" : "secondary"}>{isPred ? (poll.open ? p.betsOpen : poll.refunded ? p.refunded : poll.result != null ? p.settled : p.betsClosed) : poll.open ? p.open : p.closed}</Badge>
            </div>
            <div className="flex flex-col gap-1.5">
              {poll.options.map((o, i) => {
                const pct = total ? Math.round((values[i] * 100) / total) : 0;
                const win = !poll.open && poll.winners.includes(i);
                return (
                  <div key={i} className={cn("relative overflow-hidden rounded-md border px-2 py-1 text-xs", win && "border-primary")}>
                    <div className="absolute inset-y-0 left-0 bg-primary/15 transition-[width]" style={{ width: `${pct}%` }} />
                    <div className="relative flex justify-between gap-2">
                      <span className="truncate">
                        <b className="mr-1">{i + 1}</b>
                        {o} {win && "🏆"}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {pct}% ({isPred ? `${values[i]} ${unit}` : poll.votes[i]})
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">{isPred ? fmt(p.pool, { n: total, unit, people: poll.votes.reduce((a, b) => a + b, 0) }) : fmt(p.votes, { n: total })}</p>
            {pending && (
              <div className="flex flex-col gap-1.5 rounded-md border border-primary/40 p-2">
                <span className="text-xs font-medium">{p.whoWon}</span>
                <div className="flex flex-wrap gap-1.5">
                  {poll.options.map((o, i) => (
                    <Button key={i} size="sm" variant="outline" className="h-7" onClick={() => act((c) => c.resolvePoll(i), p.paid)}>
                      {i + 1}. {o}
                    </Button>
                  ))}
                </div>
                <span className="text-[11px] text-muted-foreground">{p.resolveHint}</span>
              </div>
            )}
            <div className="flex gap-2">
              {poll.open ? (
                <Button size="sm" className="flex-1" onClick={() => act((c) => c.endPoll())}>
                  {p.end}
                </Button>
              ) : (
                <Button size="sm" className="flex-1" onClick={() => act((c) => c.clearPoll())}>
                  {p.new}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => act((c) => c.clearPoll())}>
                {pending || (isPred && poll.open) ? p.refund : p.hide}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <h4 className="text-sm font-semibold">{p.title}</h4>
              <p className="text-[11px] text-muted-foreground">{p.desc}</p>
            </div>
            <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={p.question} maxLength={120} />
            {options.map((o, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className="w-4 text-center text-xs font-semibold text-muted-foreground">{i + 1}</span>
                <Input value={o} onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))} placeholder={fmt(p.option, { n: i + 1 })} maxLength={60} className="h-8" />
                {options.length > 2 && (
                  <Button size="icon-sm" variant="ghost" onClick={() => setOptions(options.filter((_, j) => j !== i))} aria-label={t.common.delete}>
                    <X />
                  </Button>
                )}
              </div>
            ))}
            {options.length < 6 && (
              <Button size="sm" variant="ghost" className="self-start" onClick={() => setOptions([...options, ""])}>
                <Plus /> {p.addOption}
              </Button>
            )}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">{p.duration}</span>
              <Select value={String(duration)} onValueChange={(v) => setDuration(Number(v))}>
                <SelectTrigger className="h-8 flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[30, 60, 120, 300, 600, 0].map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {d === 0 ? p.manual : d < 60 ? `${d} s` : `${d / 60} min`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className={cn("flex items-center justify-between gap-2 text-xs", !loyaltyOn && "opacity-60")} title={loyaltyOn ? undefined : p.needsPoints}>
              <span>
                {p.prediction}
                <span className="block text-[11px] text-muted-foreground">{loyaltyOn ? fmt(p.predictionHint, { unit }) : p.needsPoints}</span>
              </span>
              <Switch checked={prediction && loyaltyOn} disabled={!loyaltyOn} onCheckedChange={setPrediction} />
            </label>
            <label className="flex items-center justify-between gap-2 text-xs">
              {p.announce}
              <Switch checked={announce} onCheckedChange={setAnnounce} />
            </label>
            <Button disabled={!valid || busy} onClick={start}>
              <BarChart3 /> {p.start}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Run a giveaway (entries from every platform) and draw the winner. */
function GiveawayButton() {
  const t = useT();
  const g = t.chat.giveaway;
  const gw = useStore((s) => s.giveaway);
  const loyaltyOn = useStore((s) => !!s.state?.bot.enabled && !!s.state?.bot.loyalty?.enabled);
  const unit = useStore((s) => s.state?.bot.loyalty?.name ?? "puntos");
  const prefix = useStore((s) => s.state?.bot.prefix ?? "!");
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [keyword, setKeyword] = useState("");
  const [cost, setCost] = useState(0);
  const [subTickets, setSubTickets] = useState(1);
  const [announce, setAnnounce] = useState(true);
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    const r = await act((c) => c.startGiveaway({ title, keyword, cost: loyaltyOn ? cost : 0, subTickets, announce }), g.started);
    setBusy(false);
    if (r) setTitle("");
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant={gw ? "secondary" : "ghost"} className="h-7 gap-1.5 px-2 text-xs">
          <Gift className={cn("size-3.5", gw?.open && "text-amber-500")} /> {gw ? `${g.title} · ${gw.entries}` : g.title}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        {gw ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-semibold">{gw.title}</span>
              <Badge variant={gw.open ? "default" : "secondary"}>{gw.open ? g.open : g.closed}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {fmt(g.entries, { n: gw.entries })} · <code className="font-mono">{gw.keyword}</code>
              {gw.cost ? ` · ${gw.cost} ${unit}` : ""}
            </p>
            {gw.recent.length > 0 && <p className="truncate text-[11px] text-muted-foreground">{gw.recent.slice(0, 5).join(", ")}</p>}
            {gw.winner && (
              <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm">
                🎉 <b>{gw.winner.name}</b> <span className="text-xs text-muted-foreground">({gw.winner.platform})</span>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {gw.open && (
                <Button size="sm" variant="outline" onClick={() => act((c) => c.closeGiveaway())}>
                  {g.close}
                </Button>
              )}
              <Button size="sm" className="flex-1" disabled={!gw.entries} onClick={() => act((c) => c.drawGiveaway())}>
                {gw.winner ? g.redraw : g.draw}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => act((c) => c.clearGiveaway())}>
                {g.finish}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <h4 className="text-sm font-semibold">{g.title}</h4>
              <p className="text-[11px] text-muted-foreground">{g.desc}</p>
            </div>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={g.what} maxLength={80} />
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                {g.keyword}
                <Input value={keyword} onChange={(e) => setKeyword(e.target.value.replace(/\s/g, ""))} placeholder={`${prefix}participar`} className="h-8 font-mono text-xs" />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                {g.subTickets}
                <Input type="number" min={1} max={10} value={subTickets} onChange={(e) => setSubTickets(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} className="h-8" />
              </label>
            </div>
            <label className={cn("flex flex-col gap-1 text-[11px] text-muted-foreground", !loyaltyOn && "opacity-60")}>
              {fmt(g.cost, { unit })}
              <Input type="number" min={0} disabled={!loyaltyOn} value={loyaltyOn ? cost : 0} onChange={(e) => setCost(Math.max(0, Number(e.target.value) || 0))} className="h-8" />
              {!loyaltyOn && <span>{t.chat.poll.needsPoints}</span>}
            </label>
            <label className="flex items-center justify-between gap-2 text-xs">
              {g.announce}
              <Switch checked={announce} onCheckedChange={setAnnounce} />
            </label>
            <Button disabled={!title.trim() || busy} onClick={start}>
              <Gift /> {g.start}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** The message shown on stream right now, with a button to remove it. */
function HighlightPill() {
  const t = useT();
  const h = useStore((s) => s.highlight);
  if (!h) return null;
  return (
    <Button size="sm" variant="outline" className="h-7 max-w-56 gap-1.5 border-amber-500/40 px-2 text-xs" onClick={() => act((c) => c.clearChatHighlight())} title={t.chat.unhighlight}>
      <Star className="size-3.5 fill-amber-500 text-amber-500" />
      <span className="truncate">
        {t.chat.onScreen}: {h.message.user.name}
      </span>
      <X className="size-3.5 opacity-70" />
    </Button>
  );
}

export function ChatPanel() {
  const t = useT();
  const chat = useStore((s) => s.chat);
  const conns = useStore((s) => s.state?.chat ?? EMPTY);
  const [filter, setFilter] = useState<ChatPlatform | "all" | "questions">("all");
  const counts = chat.reduce<Record<string, number>>((acc, m) => ((acc[m.platform] = (acc[m.platform] ?? 0) + 1), acc), {});
  const present = Array.from(new Set([...conns.filter((c) => c.enabled).map((c) => c.platform), ...chat.map((m) => m.platform)]));
  const connectedCount = conns.filter((c) => c.state === "connected").length;

  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_340px] md:grid-rows-1">
      <div className="flex min-h-0 min-w-0 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" role="group" aria-label={t.chat.filter}>
            <Button size="sm" variant={filter === "all" ? "secondary" : "ghost"} className="h-7 px-2.5 text-xs" onClick={() => setFilter("all")}>
              {t.chat.allPlatforms}
            </Button>
            {present.map((p) => {
              const m = chatPlatformMeta(p);
              const I = m.icon;
              return (
                <Button key={p} size="sm" variant={filter === p ? "secondary" : "ghost"} className="h-7 gap-1.5 px-2 text-xs" onClick={() => setFilter(p)} title={m.name}>
                  <span style={{ color: m.color }} className="inline-flex">
                    <I size={13} />
                  </span>
                  <span className="font-mono tabular-nums">{counts[p] ?? 0}</span>
                </Button>
              );
            })}
          </div>
          <HighlightPill />
          <PollButton />
          <GiveawayButton />
          <QuestionsButton active={filter === "questions"} onClick={() => setFilter(filter === "questions" ? "all" : "questions")} />
          <SummaryButton />
          <AssistSettings />
          <span className="hidden shrink-0 text-xs text-muted-foreground lg:inline">{fmt(t.chat.messages, { n: chat.length })}</span>
        </div>
        <ChatList filter={filter} className="px-2" />
        <ChatComposer />
      </div>
      <div className="flex min-h-0 flex-col border-t md:border-t-0 md:border-l">
        <div className="flex shrink-0 items-center gap-2 px-4 pt-3 pb-2">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-medium">{t.chat.connections}</h3>
            <p className="text-xs text-muted-foreground">{t.chat.connectionsDesc}</p>
          </div>
          <Badge variant="secondary" className="tabular-nums">
            {connectedCount}/{CONN_PLATFORMS.length}
          </Badge>
        </div>
        <Separator />
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-3 p-4">
            {CONN_PLATFORMS.map((p) => (
              <ConnectionCard key={p} platform={p} />
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
