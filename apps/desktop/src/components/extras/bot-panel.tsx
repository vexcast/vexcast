import type { BotCommand, BotModeration, BotPermission, BotSettings, BotTimer, ChatPlatform } from "@vexcast/protocol";
import { Braces, Clock, Coins, Music, Pencil, Plus, ShieldCheck, Terminal, Trash2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { EmptyHint } from "@/components/docks/dock";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n";
import { confirmDialog } from "@/lib/dialogs";
import { fmt } from "@/lib/format";
import { act, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { LoyaltyPanel } from "./loyalty-panel";
import { SongsPanel } from "./songs-panel";
import { Field, num, PanelTabs, Section, SwitchRow } from "./shared";

const newId = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}`;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PLATFORMS: ChatPlatform[] = ["twitch", "youtube", "kick"];
const PLATFORM_NAME: Record<string, string> = { twitch: "Twitch", youtube: "YouTube", kick: "Kick" };
const PERMISSIONS: BotPermission[] = ["everyone", "subscriber", "vip", "moderator", "broadcaster"];
const VAR_RE = /(\{[a-z0-9]+(?::[^}]*)?\})/gi;

const DEFAULT_MOD: BotModeration = {
  links: false,
  allowedDomains: ["clips.twitch.tv", "youtube.com/clip"],
  caps: false,
  capsMinLength: 15,
  capsPercent: 70,
  spam: false,
  maxLength: 0,
  exemptSubscribers: true,
  exemptVip: true,
  warn: true,
  warnLinks: "{user}, no se permiten enlaces en el chat.",
  warnCaps: "{user}, sin tantas mayúsculas, por favor.",
  warnSpam: "{user}, nada de spam, por favor.",
  warnLength: "{user}, ese mensaje es demasiado largo.",
};

function blankCommand(): BotCommand {
  return { id: newId("cmd"), trigger: "", response: "", cooldownSec: 10, enabled: true, kind: "command", aliases: [], permission: "everyone", userCooldownSec: 0, platforms: [], random: false, reply: false, count: 0 };
}
/** Older saved commands miss the new fields. */
function fullCommand(c: BotCommand): BotCommand {
  return { ...blankCommand(), ...c, aliases: c.aliases ?? [], platforms: c.platforms ?? [] };
}

/** Bot settings are saved immediately (optimistic update). */
function useBot() {
  const bot = useStore((s) => s.state!.bot);
  const mutate = useStore((s) => s.mutate);
  const save = (patch: Partial<BotSettings>) => {
    mutate((s) => ({ ...s, bot: { ...s.bot, ...patch } }));
    return act((c) => c.setBot(patch));
  };
  return { bot, save };
}

/** Highlight {variables} in a response. */
function Highlighted({ text }: { text: string }) {
  return (
    <>
      {text.split(VAR_RE).map((part, i) =>
        /^\{[a-z0-9]+(?::[^}]*)?\}$/i.test(part) ? (
          <code key={i} className="rounded-sm bg-muted px-1 font-mono text-[0.92em] text-foreground">
            {part}
          </code>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

/** Chips to pick platforms; none selected = all. */
function PlatformPicker({ value, onChange }: { value: ChatPlatform[]; onChange: (v: ChatPlatform[]) => void }) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {PLATFORMS.map((p) => {
        const on = value.length === 0 || value.includes(p);
        return (
          <button
            key={p}
            type="button"
            aria-pressed={on}
            onClick={() => {
              const cur = value.length ? value : PLATFORMS;
              const next = cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p];
              if (next.length) onChange(next.length === PLATFORMS.length ? [] : next);
            }}
            className={cn("rounded-full border px-2.5 py-1 text-xs transition-colors", on ? "border-primary/50 bg-primary/10" : "text-muted-foreground opacity-60 hover:opacity-100")}
          >
            {PLATFORM_NAME[p]}
          </button>
        );
      })}
      <span className="text-[11px] text-muted-foreground">{value.length ? "" : t.bot.allPlatforms}</span>
    </div>
  );
}

function CommandDialog({ open, onClose, editing }: { open: boolean; onClose: () => void; editing: BotCommand | null }) {
  const t = useT();
  const { bot, save } = useBot();
  const id = useId();
  const [c, setC] = useState<BotCommand>(blankCommand);
  const [aliases, setAliases] = useState("");
  useEffect(() => {
    if (!open) return;
    const cmd = editing ? fullCommand(editing) : blankCommand();
    setC(cmd);
    setAliases(cmd.aliases.join(", "));
  }, [open, editing]);
  const keyword = c.kind === "keyword";
  const valid = !!c.trigger.trim() && !!c.response.trim();
  const submit = async () => {
    if (!valid) return;
    const strip = (s: string) => s.trim().replace(new RegExp(`^${escapeRe(bot.prefix)}`), "");
    const cmd: BotCommand = {
      ...c,
      trigger: keyword ? c.trigger.trim() : strip(c.trigger),
      aliases: aliases
        .split(",")
        .map((a) => (keyword ? a.trim() : strip(a).replace(/\s/g, "")))
        .filter(Boolean),
    };
    const commands = editing ? bot.commands.map((x) => (x.id === editing.id ? cmd : x)) : [...bot.commands, cmd];
    await save({ commands });
    onClose();
  };
  const insert = (v: string) => setC((p) => ({ ...p, response: `${p.response}${p.response && !/[\s\n]$/.test(p.response) ? " " : ""}{${v}}` }));
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? t.bot.editCommand : t.bot.addCommand}</DialogTitle>
        </DialogHeader>
        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid grid-cols-2 gap-1.5">
            {(["command", "keyword"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setC({ ...c, kind: k })}
                aria-pressed={c.kind === k}
                className={cn("flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left text-xs transition-colors hover:bg-accent/50", c.kind === k && "border-primary bg-primary/5 ring-1 ring-primary/40")}
              >
                <span className="font-medium">{t.bot.kinds[k]}</span>
                <span className="text-muted-foreground">{t.bot.kindHints[k]}</span>
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={keyword ? t.bot.keyword : t.bot.trigger} htmlFor={`${id}-tr`}>
              <div className="relative">
                {!keyword && <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-sm text-muted-foreground">{bot.prefix}</span>}
                <Input
                  id={`${id}-tr`}
                  value={c.trigger}
                  onChange={(e) => setC({ ...c, trigger: keyword ? e.target.value : e.target.value.replace(/\s/g, "") })}
                  className={cn(!keyword && "pl-7 font-mono")}
                  placeholder={keyword ? t.bot.keywordPh : "discord"}
                  autoFocus
                  spellCheck={false}
                />
              </div>
            </Field>
            <Field label={t.bot.aliases} hint={t.bot.aliasesHint} htmlFor={`${id}-al`}>
              <Input id={`${id}-al`} value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder={keyword ? t.bot.aliasesKwPh : "dc, server"} className={cn(!keyword && "font-mono")} spellCheck={false} />
            </Field>
          </div>
          <Field label={t.bot.response} hint={t.bot.responseHint} htmlFor={`${id}-rs`}>
            <Textarea id={`${id}-rs`} rows={3} value={c.response} onChange={(e) => setC({ ...c, response: e.target.value })} placeholder="¡Hola {user}!" />
          </Field>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(t.bot.vars) as (keyof typeof t.bot.vars)[]).map((v) => (
              <Button key={v} type="button" size="sm" variant="outline" className="h-7 px-2 font-mono text-xs" onClick={() => insert(v)} title={t.bot.vars[v]}>
                {`{${v}}`}
              </Button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t.bot.permission}>
              <Select value={c.permission} onValueChange={(v) => setC({ ...c, permission: v as BotPermission })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERMISSIONS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {t.bot.permissions[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={`${t.bot.cooldown} (${t.common.seconds})`} htmlFor={`${id}-cd`}>
              <Input id={`${id}-cd`} type="number" min={0} value={c.cooldownSec} onChange={(e) => setC({ ...c, cooldownSec: Math.max(0, num(e.target.value, c.cooldownSec)) })} />
            </Field>
            <Field label={`${t.bot.userCooldown} (${t.common.seconds})`} htmlFor={`${id}-ucd`}>
              <Input id={`${id}-ucd`} type="number" min={0} value={c.userCooldownSec} onChange={(e) => setC({ ...c, userCooldownSec: Math.max(0, num(e.target.value, c.userCooldownSec)) })} />
            </Field>
          </div>
          <p className="-mt-2 text-[11px] text-muted-foreground">{t.bot.modsSkip}</p>
          <Field label={t.bot.platforms}>
            <PlatformPicker value={c.platforms} onChange={(platforms) => setC({ ...c, platforms })} />
          </Field>
          <SwitchRow label={t.bot.random} hint={t.bot.randomHint} checked={c.random} onCheckedChange={(random) => setC({ ...c, random })} />
          <SwitchRow label={t.bot.reply} hint={t.bot.replyHint} checked={c.reply} onCheckedChange={(reply) => setC({ ...c, reply })} />
          <SwitchRow label={t.common.enabled} checked={c.enabled} onCheckedChange={(enabled) => setC({ ...c, enabled })} />
          {editing && c.count > 0 && (
            <div className="flex items-center justify-between rounded-md border px-3 py-2 text-xs">
              <span>{fmt(t.bot.usedTimes, { n: c.count })}</span>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => setC({ ...c, count: 0 })}>
                {t.bot.resetCount}
              </Button>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button disabled={!valid} onClick={submit}>
            {t.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TimerDialog({ open, onClose, editing }: { open: boolean; onClose: () => void; editing: BotTimer | null }) {
  const t = useT();
  const { bot, save } = useBot();
  const id = useId();
  const blank = (): BotTimer => ({ id: newId("tmr"), message: "", intervalMin: 15, enabled: true, minChatLines: 0, platforms: [] });
  const [tm, setTm] = useState<BotTimer>(blank);
  useEffect(() => {
    if (open) setTm(editing ? { ...blank(), ...editing, platforms: editing.platforms ?? [] } : blank());
  }, [open, editing]);
  const submit = async () => {
    if (!tm.message.trim()) return;
    const timers = editing ? bot.timers.map((x) => (x.id === editing.id ? tm : x)) : [...bot.timers, tm];
    await save({ timers });
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? t.bot.editTimer : t.bot.addTimer}</DialogTitle>
        </DialogHeader>
        <div className="flex min-w-0 flex-col gap-4">
          <Field label={t.bot.message} htmlFor={`${id}-msg`}>
            <Textarea id={`${id}-msg`} rows={3} value={tm.message} onChange={(e) => setTm({ ...tm, message: e.target.value })} autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`${t.bot.interval} (${t.common.minutes})`} htmlFor={`${id}-iv`}>
              <Input id={`${id}-iv`} type="number" min={1} value={tm.intervalMin} onChange={(e) => setTm({ ...tm, intervalMin: Math.max(1, num(e.target.value, tm.intervalMin)) })} />
            </Field>
            <Field label={t.bot.minLines} htmlFor={`${id}-ml`}>
              <Input id={`${id}-ml`} type="number" min={0} value={tm.minChatLines} onChange={(e) => setTm({ ...tm, minChatLines: Math.max(0, num(e.target.value, tm.minChatLines)) })} />
            </Field>
          </div>
          <p className="-mt-2 text-[11px] text-muted-foreground">{t.bot.minLinesHint}</p>
          <Field label={t.bot.platforms}>
            <PlatformPicker value={tm.platforms} onChange={(platforms) => setTm({ ...tm, platforms })} />
          </Field>
          <SwitchRow label={t.common.enabled} checked={tm.enabled} onCheckedChange={(enabled) => setTm({ ...tm, enabled })} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button disabled={!tm.message.trim()} onClick={submit}>
            {t.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Commands({ onEdit }: { onEdit: (c: BotCommand | null) => void }) {
  const t = useT();
  const { bot, save } = useBot();
  const remove = async (c: BotCommand) => {
    if (await confirmDialog({ title: fmt(t.bot.deleteCommand, { name: c.kind === "keyword" ? `«${c.trigger}»` : bot.prefix + c.trigger }), confirmLabel: t.common.delete, destructive: true }))
      save({ commands: bot.commands.filter((x) => x.id !== c.id) });
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <Section
        title={t.bot.commands}
        icon={<Terminal />}
        action={
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="tabular-nums">
              {bot.commands.length}
            </Badge>
            <Button size="sm" onClick={() => onEdit(null)} data-testid="bot-add-command">
              <Plus /> {t.bot.addCommand}
            </Button>
          </div>
        }
      >
        {bot.commands.length === 0 ? (
          <div className="rounded-md border border-dashed py-6">
            <EmptyHint title={t.bot.noCommands} hint={t.bot.noCommandsDesc} />
          </div>
        ) : (
          <div className="-mx-5 border-t">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[30%] pl-5">{t.bot.trigger}</TableHead>
                  <TableHead>{t.bot.response}</TableHead>
                  <TableHead className="w-28 pr-5" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {bot.commands.map((raw) => {
                  const c = fullCommand(raw);
                  return (
                    <TableRow key={c.id} className={cn(!c.enabled && "text-muted-foreground")}>
                      <TableCell className="pl-5 align-top whitespace-normal">
                        <code className="font-mono text-sm font-medium break-all">{c.kind === "keyword" ? `«${c.trigger}»` : bot.prefix + c.trigger}</code>
                        {c.aliases.length > 0 && <div className="mt-0.5 font-mono text-[11px] break-all text-muted-foreground">{c.aliases.map((a) => (c.kind === "keyword" ? a : bot.prefix + a)).join(" · ")}</div>}
                        <div className="mt-1 flex flex-wrap gap-1">
                          {c.kind === "keyword" && <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{t.bot.kinds.keyword}</Badge>}
                          {c.permission !== "everyone" && <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{t.bot.permissions[c.permission]}</Badge>}
                          {c.platforms.length > 0 && <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{c.platforms.map((p) => PLATFORM_NAME[p] ?? p).join(", ")}</Badge>}
                          {c.random && <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{t.bot.randomShort}</Badge>}
                          <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                            {c.cooldownSec}s{c.userCooldownSec ? ` · ${c.userCooldownSec}s/${t.bot.perUser}` : ""}
                            {c.count ? ` · ${fmt(t.bot.usedTimes, { n: c.count })}` : ""}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="selectable align-top text-sm leading-relaxed break-words whitespace-pre-line text-muted-foreground">
                        <Highlighted text={c.response} />
                      </TableCell>
                      <TableCell className="pr-5 align-top">
                        <div className="flex items-center justify-end gap-0.5">
                          <Switch
                            checked={c.enabled}
                            onCheckedChange={(enabled) => save({ commands: bot.commands.map((x) => (x.id === c.id ? { ...x, enabled } : x)) })}
                            aria-label={t.common.enabled}
                            className="mr-1"
                          />
                          <Button variant="ghost" size="icon-sm" className="size-7" onClick={() => onEdit(c)} aria-label={t.common.edit} title={t.common.edit}>
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon-sm" className="size-7 hover:text-destructive" onClick={() => remove(c)} aria-label={t.common.delete} title={t.common.delete}>
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <SwitchRow label={fmt(t.bot.listCommand, { cmd: `${bot.prefix}comandos` })} hint={t.bot.listCommandHint} checked={bot.listCommand ?? true} onCheckedChange={(listCommand) => save({ listCommand })} />
      </Section>
      <Section title={t.bot.variables} icon={<Braces />} className="self-start">
        <dl className="flex flex-col gap-2.5">
          {(Object.keys(t.bot.vars) as (keyof typeof t.bot.vars)[]).map((v) => (
            <div key={v} className="flex items-baseline gap-2.5">
              <dt className="shrink-0">
                <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs">{`{${v}}`}</code>
              </dt>
              <dd className="text-sm text-muted-foreground">{t.bot.vars[v]}</dd>
            </div>
          ))}
        </dl>
        <Separator />
        <p className="text-xs leading-relaxed text-muted-foreground">
          <code className="font-mono text-foreground">{bot.prefix}so</code> → <Highlighted text={t.bot.example} />
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          <code className="font-mono text-foreground">{bot.prefix}dado</code> → <Highlighted text={t.bot.example2} />
        </p>
      </Section>
    </div>
  );
}

function Timers({ onEdit }: { onEdit: (tm: BotTimer | null) => void }) {
  const t = useT();
  const { bot, save } = useBot();
  const remove = async (tm: BotTimer) => {
    if (await confirmDialog({ title: t.bot.deleteTimer, confirmLabel: t.common.delete, destructive: true })) save({ timers: bot.timers.filter((x) => x.id !== tm.id) });
  };
  return (
    <Section
      title={t.bot.timers}
      icon={<Clock />}
      description={t.bot.noTimersDesc}
      action={
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="tabular-nums">
            {bot.timers.length}
          </Badge>
          <Button size="sm" onClick={() => onEdit(null)} data-testid="bot-add-timer">
            <Plus /> {t.bot.addTimer}
          </Button>
        </div>
      }
    >
      {bot.timers.length === 0 ? (
        <div className="rounded-md border border-dashed py-6">
          <EmptyHint title={t.bot.noTimers} />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {bot.timers.map((tm) => (
            <div key={tm.id} className={cn("flex items-start gap-3 rounded-lg border p-3", !tm.enabled && "text-muted-foreground")}>
              <div className="min-w-0 flex-1">
                <p className="selectable text-sm leading-relaxed break-words">
                  <Highlighted text={tm.message} />
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {fmt(t.bot.every, { n: tm.intervalMin })}
                  {tm.minChatLines ? ` · ${fmt(t.bot.afterLines, { n: tm.minChatLines })}` : ""}
                  {tm.platforms?.length ? ` · ${tm.platforms.map((p) => PLATFORM_NAME[p] ?? p).join(", ")}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <Switch
                  checked={tm.enabled}
                  onCheckedChange={(enabled) => save({ timers: bot.timers.map((x) => (x.id === tm.id ? { ...x, enabled } : x)) })}
                  aria-label={t.common.enabled}
                  className="mr-1"
                />
                <Button variant="ghost" size="icon-sm" className="size-7" onClick={() => onEdit(tm)} aria-label={t.common.edit} title={t.common.edit}>
                  <Pencil className="size-3.5" />
                </Button>
                <Button variant="ghost" size="icon-sm" className="size-7 hover:text-destructive" onClick={() => remove(tm)} aria-label={t.common.delete} title={t.common.delete}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

/** Comma separated list edited as text, saved on blur. */
function ListInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [text, setText] = useState(value.join(", "));
  useEffect(() => setText(value.join(", ")), [value]);
  return <Input value={text} onChange={(e) => setText(e.target.value)} onBlur={() => onChange(text.split(",").map((x) => x.trim()).filter(Boolean))} placeholder={placeholder} className="font-mono text-xs" spellCheck={false} />;
}

/** Text saved on blur (moderation warnings). */
function BlurInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return <Input value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text !== value && onChange(text)} />;
}

function Moderation() {
  const t = useT();
  const m = t.bot.mod;
  const { bot, save } = useBot();
  const mod: BotModeration = { ...DEFAULT_MOD, ...(bot.moderation ?? {}) };
  const set = (p: Partial<BotModeration>) => save({ moderation: { ...mod, ...p } });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title={m.rules} icon={<ShieldCheck />} description={m.rulesDesc} className="self-start">
        <SwitchRow label={m.links} hint={m.linksHint} checked={mod.links} onCheckedChange={(links) => set({ links })} />
        {mod.links && (
          <Field label={m.allowed} hint={m.allowedHint}>
            <ListInput value={mod.allowedDomains} onChange={(allowedDomains) => set({ allowedDomains })} placeholder="clips.twitch.tv, youtube.com/clip" />
          </Field>
        )}
        <SwitchRow label={m.caps} hint={fmt(m.capsHint, { pct: mod.capsPercent, len: mod.capsMinLength })} checked={mod.caps} onCheckedChange={(caps) => set({ caps })} />
        {mod.caps && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={m.capsPercent}>
              <Input type="number" min={30} max={100} value={mod.capsPercent} onChange={(e) => set({ capsPercent: Math.max(30, Math.min(100, num(e.target.value, mod.capsPercent))) })} />
            </Field>
            <Field label={m.capsMin}>
              <Input type="number" min={1} value={mod.capsMinLength} onChange={(e) => set({ capsMinLength: Math.max(1, num(e.target.value, mod.capsMinLength)) })} />
            </Field>
          </div>
        )}
        <SwitchRow label={m.spam} hint={m.spamHint} checked={mod.spam} onCheckedChange={(spam) => set({ spam })} />
        <Field label={m.maxLength} hint={m.maxLengthHint}>
          <Input type="number" min={0} value={mod.maxLength} onChange={(e) => set({ maxLength: Math.max(0, num(e.target.value, mod.maxLength)) })} className="w-32" />
        </Field>
      </Section>
      <div className="flex flex-col gap-4">
        <Section title={m.who} description={m.whoDesc}>
          <SwitchRow label={m.exemptSubs} checked={mod.exemptSubscribers} onCheckedChange={(exemptSubscribers) => set({ exemptSubscribers })} />
          <SwitchRow label={m.exemptVip} checked={mod.exemptVip} onCheckedChange={(exemptVip) => set({ exemptVip })} />
        </Section>
        <Section title={m.warnings} description={m.warningsDesc}>
          <SwitchRow label={m.warn} checked={mod.warn} onCheckedChange={(warn) => set({ warn })} />
          {mod.warn && (
            <>
              <Field label={m.links}>
                <BlurInput value={mod.warnLinks} onChange={(warnLinks) => set({ warnLinks })} />
              </Field>
              <Field label={m.caps}>
                <BlurInput value={mod.warnCaps} onChange={(warnCaps) => set({ warnCaps })} />
              </Field>
              <Field label={m.spam}>
                <BlurInput value={mod.warnSpam} onChange={(warnSpam) => set({ warnSpam })} />
              </Field>
              <Field label={m.maxLength}>
                <BlurInput value={mod.warnLength} onChange={(warnLength) => set({ warnLength })} />
              </Field>
            </>
          )}
        </Section>
      </div>
    </div>
  );
}

/** Prefix + enable switch, shown next to the tab bar. */
function BotGeneral() {
  const t = useT();
  const { bot, save } = useBot();
  const id = useId();
  const [prefix, setPrefix] = useState(bot.prefix);
  useEffect(() => setPrefix(bot.prefix), [bot.prefix]);
  const commit = () => {
    const p = prefix.trim();
    if (p && p !== bot.prefix) save({ prefix: p });
    else setPrefix(bot.prefix);
  };
  return (
    <>
      <div className="flex items-center gap-2">
        <Label htmlFor={`${id}-px`} className="text-xs text-muted-foreground">
          {t.bot.prefix}
        </Label>
        <Input
          id={`${id}-px`}
          value={prefix}
          maxLength={3}
          onChange={(e) => setPrefix(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className="h-8 w-14 text-center font-mono"
        />
      </div>
      <Separator orientation="vertical" className="h-5!" />
      <div className="flex items-center gap-2">
        <Label htmlFor={`${id}-en`} className="text-sm font-normal">
          {t.bot.enable}
        </Label>
        <Switch id={`${id}-en`} checked={bot.enabled} onCheckedChange={(enabled) => save({ enabled })} />
      </div>
    </>
  );
}

/** Tool panel: chat bot commands, timed messages and automatic moderation. */
export function BotPanel() {
  const t = useT();
  const enabled = useStore((s) => s.state?.bot.enabled ?? false);
  const [tab, setTab] = useState<"commands" | "timers" | "loyalty" | "songs" | "moderation">("commands");
  const [cmd, setCmd] = useState<{ open: boolean; editing: BotCommand | null }>({ open: false, editing: null });
  const [tmr, setTmr] = useState<{ open: boolean; editing: BotTimer | null }>({ open: false, editing: null });
  return (
    <>
      <PanelTabs
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: "commands", label: t.bot.commands, icon: <Terminal /> },
          { value: "timers", label: t.bot.timers, icon: <Clock /> },
          { value: "loyalty", label: t.bot.loyalty.tab, icon: <Coins /> },
          { value: "songs", label: t.bot.songs.tab, icon: <Music /> },
          { value: "moderation", label: t.bot.mod.title, icon: <ShieldCheck /> },
        ]}
        aside={<BotGeneral />}
      >
        <div className={cn("transition-opacity", !enabled && "opacity-60")}>
          <TabsContent value="commands">
            <Commands onEdit={(editing) => setCmd({ open: true, editing })} />
          </TabsContent>
          <TabsContent value="timers">
            <Timers onEdit={(editing) => setTmr({ open: true, editing })} />
          </TabsContent>
          <TabsContent value="loyalty">
            <LoyaltyPanel />
          </TabsContent>
          <TabsContent value="songs">
            <SongsPanel />
          </TabsContent>
          <TabsContent value="moderation">
            <Moderation />
          </TabsContent>
        </div>
      </PanelTabs>
      <CommandDialog open={cmd.open} editing={cmd.editing} onClose={() => setCmd({ open: false, editing: null })} />
      <TimerDialog open={tmr.open} editing={tmr.editing} onClose={() => setTmr({ open: false, editing: null })} />
    </>
  );
}
