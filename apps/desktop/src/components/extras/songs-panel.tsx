import type { BotSettings, SongSettings } from "@vexcast/protocol";
import { Copy, ListMusic, Music, Pause, Play, Plus, SkipForward, Trash2, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { useT } from "@/i18n";
import { fmt } from "@/lib/format";
import { act, editingSceneUuid, useStore } from "@/lib/store";
import { Field, num, Section, SwitchRow } from "./shared";

const DEFAULT: SongSettings = { enabled: false, command: "sr", maxQueue: 30, maxPerUser: 2, maxMinutes: 8, cost: 0, subsOnly: false };

function mmss(s?: number | null) {
  if (!s) return "";
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function NumBlur({ label, value, onChange, hint }: { label: string; value: number; onChange: (v: number) => void; hint?: string }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  return (
    <Field label={label} hint={hint}>
      <Input type="number" min={0} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => onChange(Math.max(0, num(v, value)))} />
    </Field>
  );
}

/** Bot tab: song requests (settings, live queue and the player source). */
export function SongsPanel() {
  const t = useT();
  const s = t.bot.songs;
  const bot = useStore((st) => st.state!.bot);
  const mutate = useStore((st) => st.mutate);
  const q = useStore((st) => st.songs);
  const client = useStore((st) => st.client);
  const sceneUuid = useStore((st) => (st.state ? editingSceneUuid(st.state) : null));
  const loyaltyOn = !!bot.loyalty?.enabled;
  const cfg: SongSettings = { ...DEFAULT, ...(bot.songs ?? {}) };
  const save = (p: Partial<SongSettings>) => {
    const songs = { ...cfg, ...p };
    mutate((x) => ({ ...x, bot: { ...x.bot, songs } }));
    return act((c) => c.setBot({ songs } as Partial<BotSettings>));
  };
  const [link, setLink] = useState("");
  const [cmd, setCmd] = useState(cfg.command);
  useEffect(() => setCmd(cfg.command), [cfg.command]);
  const playerUrl = () => {
    const base = client?.widgetUrl("songs") ?? "";
    return `${base}${base.includes("?") ? "&" : "?"}player=1`;
  };
  const addSource = () => {
    if (!sceneUuid) return;
    act((c) => c.createSource({ name: s.sourceName, kind: "browser_source", settings: { url: playerUrl(), width: 1280, height: 720, reroute_audio: true }, sceneUuid }), t.alerts.addedToScene);
  };
  const addLink = async () => {
    if (!link.trim()) return;
    const r = await act((c) => c.addSong(link.trim()), s.added);
    if (r) setLink("");
  };
  const cur = q?.current ?? null;
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="flex flex-col gap-4">
        <Section title={s.title} icon={<Music />} description={fmt(s.desc, { cmd: `${bot.prefix}${cfg.command}` })}>
          <SwitchRow label={s.enable} checked={cfg.enabled} onCheckedChange={(enabled) => save({ enabled })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={s.command}>
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-sm text-muted-foreground">{bot.prefix}</span>
                <Input value={cmd} onChange={(e) => setCmd(e.target.value.replace(/\s/g, ""))} onBlur={() => cmd.trim() && cmd !== cfg.command && save({ command: cmd.trim().replace(/^!/, "") })} className="pl-7 font-mono" />
              </div>
            </Field>
            <NumBlur label={s.maxMinutes} value={cfg.maxMinutes} onChange={(maxMinutes) => save({ maxMinutes })} hint={s.zeroNoLimit} />
            <NumBlur label={s.maxQueue} value={cfg.maxQueue} onChange={(maxQueue) => save({ maxQueue })} hint={s.zeroNoLimit} />
            <NumBlur label={s.maxPerUser} value={cfg.maxPerUser} onChange={(maxPerUser) => save({ maxPerUser })} hint={s.zeroNoLimit} />
          </div>
          <div className={loyaltyOn ? "" : "opacity-60"}>
            <NumBlur label={fmt(s.cost, { unit: bot.loyalty?.name ?? "puntos" })} value={loyaltyOn ? cfg.cost : 0} onChange={(cost) => save({ cost })} hint={loyaltyOn ? s.costHint : t.chat.poll.needsPoints} />
          </div>
          <SwitchRow label={s.subsOnly} checked={cfg.subsOnly} onCheckedChange={(subsOnly) => save({ subsOnly })} />
          <p className="text-[11px] leading-relaxed text-muted-foreground">{fmt(s.commandsHelp, { p: bot.prefix })}</p>
        </Section>
        <Section title={s.player} description={s.playerDesc}>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={!sceneUuid} onClick={addSource}>
              <Plus /> {t.alerts.addToScene}
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={() => navigator.clipboard.writeText(playerUrl()).then(() => toast.success(t.look.lb.copied))} aria-label={t.alerts.widgetUrl} title={t.alerts.widgetUrl}>
              <Copy />
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">{s.playerHint}</p>
        </Section>
      </div>
      <Section
        title={s.queue}
        icon={<ListMusic />}
        description={fmt(s.inQueue, { n: q?.queue.length ?? 0 })}
        action={
          q && (q.current || q.queue.length) ? (
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => act((c) => c.clearSongs())}>
              {s.clear}
            </Button>
          ) : undefined
        }
      >
        <div className="flex gap-2">
          <Input value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addLink()} placeholder="https://youtu.be/…" />
          <Button onClick={addLink} disabled={!link.trim()}>
            <Plus /> {s.add}
          </Button>
        </div>
        <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
          <Music className="size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{cur ? cur.title : s.nothing}</div>
            {cur && (
              <div className="truncate text-xs text-muted-foreground">
                {cur.requestedBy ? fmt(s.by, { user: cur.requestedBy }) : cur.author} {cur.durationSec ? `· ${mmss(cur.durationSec)}` : ""}
              </div>
            )}
          </div>
          <Button size="icon-sm" variant="outline" disabled={!cur} onClick={() => act((c) => c.pauseSongs(!q?.paused))} aria-label={q?.paused ? s.play : s.pause} title={q?.paused ? s.play : s.pause}>
            {q?.paused ? <Play /> : <Pause />}
          </Button>
          <Button size="icon-sm" variant="outline" disabled={!cur} onClick={() => act((c) => c.nextSong())} aria-label={s.skip} title={s.skip}>
            <SkipForward />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Volume2 className="size-4 text-muted-foreground" />
          <Slider min={0} max={100} step={1} value={[q?.volume ?? 50]} onValueChange={([v]) => act((c) => c.songVolume(v))} className="flex-1" />
          <span className="w-8 text-right font-mono text-xs tabular-nums">{q?.volume ?? 50}</span>
        </div>
        {q && q.queue.length > 0 ? (
          <div className="flex max-h-96 flex-col overflow-y-auto">
            {q.queue.map((x, i) => (
              <div key={x.id} className="flex items-center gap-2 border-b py-1.5 text-sm last:border-b-0">
                <span className="w-6 text-right font-mono text-xs text-muted-foreground">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate">{x.title}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{x.requestedBy ? fmt(s.by, { user: x.requestedBy }) : x.author}</div>
                </div>
                {x.platform && (
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px] capitalize">
                    {x.platform}
                  </Badge>
                )}
                <Button size="icon-sm" variant="ghost" className="size-7 hover:text-destructive" onClick={() => act((c) => c.removeSong(x.id))} aria-label={t.common.delete}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">{s.empty}</p>
        )}
      </Section>
    </div>
  );
}
