import type { BotSettings, LoyaltyReward, LoyaltyRow, LoyaltySettings } from "@vexcast/protocol";
import { Coins, Gift, Minus, Pencil, Plus, RotateCw, Search, Trash2, Trophy } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { FilePick } from "@/components/alerts/alert-inspector";
import { EmptyHint } from "@/components/docks/dock";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n";
import { confirmDialog } from "@/lib/dialogs";
import { fmt } from "@/lib/format";
import { act, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Field, num, Section, SwitchRow } from "./shared";

const KINDS = ["chat", "tts", "sound", "highlight", "macro"] as const;
const SOUND_EXT = ["mp3", "wav", "ogg", "m4a", "flac"];

export const DEFAULT_LOYALTY: LoyaltySettings = {
  enabled: false,
  name: "puntos",
  perInterval: 10,
  intervalMin: 5,
  activeMinutes: 15,
  subMultiplier: 2,
  bonusFollow: 50,
  bonusSub: 500,
  bonusPer100Bits: 50,
  bonusPerCurrency: 100,
  bonusRaid: 200,
  command: "puntos",
  topCommand: "top",
  giveCommand: "dar",
  allowGive: true,
  redeemCommand: "canjear",
  rewards: [],
};

function useLoyalty() {
  const bot = useStore((s) => s.state!.bot);
  const mutate = useStore((s) => s.mutate);
  const cfg: LoyaltySettings = { ...DEFAULT_LOYALTY, ...(bot.loyalty ?? {}) };
  const save = (patch: Partial<LoyaltySettings>) => {
    const loyalty = { ...cfg, ...patch };
    mutate((s) => ({ ...s, bot: { ...s.bot, loyalty } }));
    return act((c) => c.setBot({ loyalty } as Partial<BotSettings>));
  };
  return { bot, cfg, save };
}

/** Number saved on blur. */
function NumField({ label, value, onChange, min = 0, step = 1, hint }: { label: string; value: number; onChange: (v: number) => void; min?: number; step?: number; hint?: string }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  return (
    <Field label={label} hint={hint}>
      <Input type="number" min={min} step={step} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => onChange(Math.max(min, num(v, value)))} />
    </Field>
  );
}

/** Text saved on blur. */
function TextField({ label, value, onChange, prefix, hint }: { label: string; value: string; onChange: (v: string) => void; prefix?: string; hint?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <Field label={label} hint={hint}>
      <div className="relative">
        {prefix && <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-sm text-muted-foreground">{prefix}</span>}
        <Input value={v} onChange={(e) => setV(e.target.value.replace(/\s/g, ""))} onBlur={() => v.trim() && v !== value && onChange(v.trim())} className={cn(prefix && "pl-7 font-mono")} spellCheck={false} />
      </div>
    </Field>
  );
}

function RewardDialog({ open, editing, onClose }: { open: boolean; editing: LoyaltyReward | null; onClose: () => void }) {
  const t = useT();
  const l = t.bot.loyalty;
  const { cfg, save } = useLoyalty();
  const macros = useStore((s) => s.state?.macros ?? []);
  const blank = (): LoyaltyReward => ({ id: `rw_${Math.random().toString(36).slice(2, 10)}`, name: "", cost: 100, kind: "chat", value: "", needsInput: false, cooldownSec: 0, enabled: true });
  const [r, setR] = useState<LoyaltyReward>(blank);
  useEffect(() => {
    if (open) setR(editing ?? blank());
  }, [open, editing]);
  const valid = !!r.name.trim() && r.cost >= 0 && (r.kind !== "macro" || !!r.value) && (r.kind !== "sound" || !!r.value) && (r.kind !== "chat" || !!r.value.trim());
  const submit = async () => {
    const item = { ...r, name: r.name.trim().toLowerCase() };
    const rewards = editing ? cfg.rewards.map((x) => (x.id === editing.id ? item : x)) : [...cfg.rewards, item];
    await save({ rewards });
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? l.editReward : l.addReward}</DialogTitle>
        </DialogHeader>
        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
            <Field label={l.rewardName} hint={fmt(l.rewardNameHint, { cmd: `!${cfg.redeemCommand} ${r.name || "…"}` })}>
              <Input value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} placeholder="hidratate" autoFocus />
            </Field>
            <Field label={fmt(l.cost, { unit: cfg.name })}>
              <Input type="number" min={0} value={r.cost} onChange={(e) => setR({ ...r, cost: Math.max(0, num(e.target.value, r.cost)) })} />
            </Field>
          </div>
          <Field label={l.kind}>
            <div className="grid grid-cols-5 gap-1">
              {KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setR({ ...r, kind: k, value: k === r.kind ? r.value : "", needsInput: k === "tts" || k === "highlight" ? true : r.needsInput })}
                  aria-pressed={r.kind === k}
                  className={cn("rounded-md border px-1 py-1.5 text-[11px] transition-colors hover:bg-accent/50", r.kind === k && "border-primary bg-primary/10 font-medium")}
                >
                  {l.kinds[k]}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">{l.kindHints[r.kind as (typeof KINDS)[number]]}</p>
          </Field>
          {(r.kind === "chat" || r.kind === "tts" || r.kind === "highlight") && (
            <Field label={r.kind === "chat" ? l.message : l.fixedText} hint={l.valueHint}>
              <Textarea rows={2} value={r.value} onChange={(e) => setR({ ...r, value: e.target.value })} placeholder={r.kind === "chat" ? "💧 {user} recuerda al streamer que beba agua" : ""} />
            </Field>
          )}
          {r.kind === "sound" && (
            <Field label={l.sound}>
              <FilePick value={r.value} onChange={(value) => setR({ ...r, value })} exts={SOUND_EXT} label={l.sound} />
            </Field>
          )}
          {r.kind === "macro" && (
            <Field label={l.macro} hint={macros.length ? undefined : l.noMacros}>
              <Select value={r.value || undefined} onValueChange={(value) => setR({ ...r, value })}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={l.pickMacro} />
                </SelectTrigger>
                <SelectContent>
                  {macros.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name || m.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <SwitchRow label={l.needsInput} hint={l.needsInputHint} checked={r.needsInput} onCheckedChange={(needsInput) => setR({ ...r, needsInput })} />
          <Field label={`${t.bot.cooldown} (${t.common.seconds})`}>
            <Input type="number" min={0} value={r.cooldownSec} onChange={(e) => setR({ ...r, cooldownSec: Math.max(0, num(e.target.value, r.cooldownSec)) })} className="w-32" />
          </Field>
          <SwitchRow label={t.common.enabled} checked={r.enabled} onCheckedChange={(enabled) => setR({ ...r, enabled })} />
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

function Leaderboard() {
  const t = useT();
  const l = t.bot.loyalty;
  const { cfg } = useLoyalty();
  const client = useStore((s) => s.client);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<LoyaltyRow[]>([]);
  const [total, setTotal] = useState(0);
  const load = useCallback(async () => {
    if (!client) return;
    const r = await client.loyalty(q, 100).catch(() => null);
    if (r) {
      setRows(r.viewers);
      setTotal(r.total);
    }
  }, [client, q]);
  useEffect(() => {
    void load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);
  const adjust = async (row: LoyaltyRow, delta: number) => {
    await act((c) => c.setLoyalty(row.key, Math.max(0, row.points + delta)));
    void load();
  };
  return (
    <Section
      title={l.leaderboard}
      icon={<Trophy />}
      description={fmt(l.viewers, { n: total })}
      action={
        <div className="flex items-center gap-1">
          <Button size="icon-sm" variant="ghost" onClick={load} aria-label={t.alerts.reload} title={t.alerts.reload}>
            <RotateCw />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={!total}
            onClick={async () => {
              if (await confirmDialog({ title: fmt(l.resetQ, { unit: cfg.name }), confirmLabel: l.reset, destructive: true })) {
                await act((c) => c.resetLoyalty(), l.resetDone);
                void load();
              }
            }}
          >
            {l.reset}
          </Button>
        </div>
      }
    >
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={l.search} className="pl-8" />
      </div>
      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed py-6">
          <EmptyHint title={l.noViewers} hint={cfg.enabled ? l.noViewersHint : l.disabledHint} />
        </div>
      ) : (
        <div className="flex max-h-[28rem] flex-col overflow-y-auto">
          {rows.map((r) => (
            <div key={r.key} className="flex items-center gap-2 border-b py-1.5 text-sm last:border-b-0">
              <span className={cn("w-8 text-right font-mono text-xs tabular-nums text-muted-foreground", r.rank <= 3 && "font-bold text-amber-500")}>#{r.rank}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
              <Badge variant="outline" className="h-5 px-1.5 text-[10px] capitalize">
                {r.platform ?? "—"}
              </Badge>
              <span className="w-20 text-right font-mono tabular-nums">{r.points.toLocaleString(t.locale)}</span>
              <Button size="icon-sm" variant="ghost" className="size-7" onClick={() => adjust(r, -100)} aria-label="-100" title="-100">
                <Minus className="size-3.5" />
              </Button>
              <Button size="icon-sm" variant="ghost" className="size-7" onClick={() => adjust(r, 100)} aria-label="+100" title="+100">
                <Plus className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

/** Bot tab: loyalty points (earning, commands, rewards and leaderboard). */
export function LoyaltyPanel() {
  const t = useT();
  const l = t.bot.loyalty;
  const { bot, cfg, save } = useLoyalty();
  const [dlg, setDlg] = useState<{ open: boolean; editing: LoyaltyReward | null }>({ open: false, editing: null });
  const p = bot.prefix;
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="flex flex-col gap-4">
        <Section title={l.title} icon={<Coins />} description={l.desc}>
          <SwitchRow label={l.enable} hint={l.enableHint} checked={cfg.enabled} onCheckedChange={(enabled) => save({ enabled })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={l.name} hint={l.nameHint}>
              <BlurText value={cfg.name} onChange={(name) => save({ name })} />
            </Field>
            <NumField label={l.subMultiplier} value={cfg.subMultiplier} step={0.5} min={1} onChange={(subMultiplier) => save({ subMultiplier })} hint={l.subMultiplierHint} />
          </div>
          <p className="text-xs font-semibold text-muted-foreground uppercase">{l.earning}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <NumField label={fmt(l.perInterval, { unit: cfg.name })} value={cfg.perInterval} onChange={(perInterval) => save({ perInterval })} />
            <NumField label={l.intervalMin} value={cfg.intervalMin} min={1} onChange={(intervalMin) => save({ intervalMin })} />
            <NumField label={l.activeMinutes} value={cfg.activeMinutes} min={1} onChange={(activeMinutes) => save({ activeMinutes })} />
          </div>
          <p className="-mt-2 text-[11px] text-muted-foreground">{fmt(l.earningHint, { n: cfg.perInterval, unit: cfg.name, every: cfg.intervalMin, active: cfg.activeMinutes })}</p>
          <p className="text-xs font-semibold text-muted-foreground uppercase">{l.bonuses}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <NumField label={l.bonusFollow} value={cfg.bonusFollow} onChange={(bonusFollow) => save({ bonusFollow })} />
            <NumField label={l.bonusSub} value={cfg.bonusSub} onChange={(bonusSub) => save({ bonusSub })} />
            <NumField label={l.bonusBits} value={cfg.bonusPer100Bits} onChange={(bonusPer100Bits) => save({ bonusPer100Bits })} />
            <NumField label={l.bonusMoney} value={cfg.bonusPerCurrency} onChange={(bonusPerCurrency) => save({ bonusPerCurrency })} />
            <NumField label={l.bonusRaid} value={cfg.bonusRaid} onChange={(bonusRaid) => save({ bonusRaid })} />
          </div>
        </Section>
        <Section title={l.commands} description={l.commandsDesc}>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label={l.cmdPoints} prefix={p} value={cfg.command} onChange={(command) => save({ command })} />
            <TextField label={l.cmdTop} prefix={p} value={cfg.topCommand} onChange={(topCommand) => save({ topCommand })} />
            <TextField label={l.cmdGive} prefix={p} value={cfg.giveCommand} onChange={(giveCommand) => save({ giveCommand })} hint={l.cmdGiveHint} />
            <TextField label={l.cmdRedeem} prefix={p} value={cfg.redeemCommand} onChange={(redeemCommand) => save({ redeemCommand })} />
          </div>
          <SwitchRow label={l.allowGive} checked={cfg.allowGive} onCheckedChange={(allowGive) => save({ allowGive })} />
        </Section>
      </div>
      <div className="flex flex-col gap-4">
        <Section
          title={l.rewards}
          icon={<Gift />}
          description={fmt(l.rewardsDesc, { cmd: `${p}${cfg.redeemCommand}` })}
          action={
            <Button size="sm" onClick={() => setDlg({ open: true, editing: null })}>
              <Plus /> {l.addReward}
            </Button>
          }
        >
          {cfg.rewards.length === 0 ? (
            <div className="rounded-md border border-dashed py-6">
              <EmptyHint title={l.noRewards} />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {cfg.rewards.map((r) => (
                <div key={r.id} className={cn("flex items-center gap-3 rounded-lg border px-3 py-2", !r.enabled && "text-muted-foreground")}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <code className="truncate font-mono text-sm font-medium">{r.name}</code>
                      <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                        {l.kinds[r.kind as (typeof KINDS)[number]] ?? r.kind}
                      </Badge>
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {r.cost.toLocaleString(t.locale)} {cfg.name}
                      {r.cooldownSec ? ` · ${r.cooldownSec}s` : ""}
                      {r.needsInput ? ` · ${l.withText}` : ""}
                    </div>
                  </div>
                  <Switch checked={r.enabled} onCheckedChange={(enabled) => save({ rewards: cfg.rewards.map((x) => (x.id === r.id ? { ...x, enabled } : x)) })} aria-label={t.common.enabled} />
                  <Button variant="ghost" size="icon-sm" className="size-7" onClick={() => setDlg({ open: true, editing: r })} aria-label={t.common.edit}>
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-7 hover:text-destructive"
                    onClick={async () => {
                      if (await confirmDialog({ title: fmt(l.deleteReward, { name: r.name }), confirmLabel: t.common.delete, destructive: true })) save({ rewards: cfg.rewards.filter((x) => x.id !== r.id) });
                    }}
                    aria-label={t.common.delete}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Section>
        <Leaderboard />
      </div>
      <RewardDialog open={dlg.open} editing={dlg.editing} onClose={() => setDlg({ open: false, editing: null })} />
    </div>
  );
}

function BlurText({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return <Input value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v.trim() && v !== value && onChange(v.trim())} />;
}
