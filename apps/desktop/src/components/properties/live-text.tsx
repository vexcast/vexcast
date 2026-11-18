import type { SourceInfo } from "@vexcast/protocol";
import { Loader2, Radio, RotateCw, Type } from "lucide-react";
import { requestRestart } from "@/components/dialogs/restart-dialog";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/i18n";
import { goTo } from "@/lib/prefs";
import { fmt } from "@/lib/format";
import { act, useStore } from "@/lib/store";

const KEY = "vexcast_label";
const TEMPLATE_KEY = "vexcast_label_template";
const NONE = "__none";
const LATEST = ["latest_follower", "latest_subscriber", "latest_gift", "latest_bits", "latest_donation", "latest_raid"] as const;
const TOP = ["top_donation", "top_bits", "top_raid"] as const;
const SESSION = ["session_top_donation", "session_top_bits", "session_follows", "session_subs", "session_bits", "session_donations", "session_raids"] as const;
const TOTALS = ["total_followers", "total_subs"] as const;

/** Texts from Streamlabs themes use a font Windows may not have: offer to install it. */
export function ThemeFontNotice({ source, onChanged }: { source: SourceInfo; onChanged?: () => void }) {
  const t = useT();
  const f = t.liveText.font;
  const client = useStore((s) => s.client);
  const custom = String((source.settings as Record<string, unknown>)?.custom_font ?? "");
  const [info, setInfo] = useState<{ family: string; installed: boolean; pending?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!custom || !client || !source.kind.startsWith("text_")) return setInfo(null);
    client
      .themeFonts()
      .then((list) => setInfo(list.find((x) => x.file === custom) ?? null))
      .catch(() => setInfo(null));
  }, [client, custom, source.uuid, source.kind]);
  if (!info) return null;
  const face = String(((source.settings as Record<string, unknown>)?.font as Record<string, unknown> | undefined)?.face ?? "");
  if (info.installed && face === info.family) return null;
  const install = async () => {
    setBusy(true);
    const r = await act((c) => c.installThemeFonts());
    setBusy(false);
    if (r) {
      setInfo({ ...info, installed: true, pending: true });
      requestRestart(fmt(f.restartReason, { list: r.installed.join(", ") }));
      onChanged?.();
    }
  };
  return (
    <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
      <div className="mb-1 flex items-center gap-2 text-sm font-medium">
        <Type className="size-4 text-amber-500" /> {fmt(f.title, { family: info.family })}
      </div>
      <p className="text-xs text-muted-foreground">{info.installed ? f.pending : fmt(f.detail, { family: info.family })}</p>
      {info.installed ? (
        <Button size="sm" className="mt-2" onClick={() => requestRestart(fmt(f.restartReason, { list: info.family }))}>
          <RotateCw /> {t.restart.now}
        </Button>
      ) : (
        <Button size="sm" className="mt-2" disabled={busy} onClick={install}>
          {busy && <Loader2 className="animate-spin" />}
          {f.install}
        </Button>
      )}
    </div>
  );
}

/** For text sources: show a live value (latest follower, a counter, the countdown…) that Vexcast keeps up to date. */
export function LiveTextBinding({ source, onChanged }: { source: SourceInfo; onChanged?: () => void }) {
  const t = useT();
  const l = t.liveText;
  const names = t.look.lb.names;
  const counters = useStore((s) => s.state?.counters ?? []);
  const settings = (source.settings ?? {}) as Record<string, unknown>;
  const current = typeof settings[KEY] === "string" ? (settings[KEY] as string) : "";
  const [tpl, setTpl] = useState(String(settings[TEMPLATE_KEY] ?? ""));
  useEffect(() => setTpl(String(settings[TEMPLATE_KEY] ?? "")), [source.uuid, settings[TEMPLATE_KEY]]);
  if (!source.kind.startsWith("text_")) return null;
  const save = async (patch: Record<string, unknown>) => {
    await act((c) => c.updateSourceSettings(source.uuid, patch));
    onChanged?.();
  };
  const placeholder = current.startsWith("counter:") ? "{value}" : current === "countdown" ? "{time}" : current.startsWith("session_") && !current.includes("top") ? "{count}" : "{user}";
  return (
    <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <Radio className="size-4 text-primary" /> {l.title}
      </div>
      <Select value={current || NONE} onValueChange={(v) => save({ [KEY]: v === NONE ? "" : v })}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-80">
          <SelectItem value={NONE}>{l.none}</SelectItem>
          <SelectGroup>
            <SelectLabel>{t.look.lb.groups.latest}</SelectLabel>
            {LATEST.map((id) => (
              <SelectItem key={id} value={id}>
                {names[id]}
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectGroup>
            <SelectLabel>{t.look.lb.groups.top}</SelectLabel>
            {TOP.map((id) => (
              <SelectItem key={id} value={id}>
                {names[id]}
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectGroup>
            <SelectLabel>{t.look.lb.groups.session}</SelectLabel>
            {SESSION.map((id) => (
              <SelectItem key={id} value={id}>
                {names[id]}
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectGroup>
            <SelectLabel>{t.look.lb.groups.totals}</SelectLabel>
            {TOTALS.map((id) => (
              <SelectItem key={id} value={id}>
                {names[id]}
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectGroup>
            <SelectLabel>{t.look.ct.tab}</SelectLabel>
            <SelectItem value="countdown">{t.look.ct.cdTitle}</SelectItem>
            {counters.map((c) => (
              <SelectItem key={c.id} value={`counter:${c.id}`}>
                {c.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {current ? (
        <div className="mt-2 grid gap-1">
          <span className="text-xs text-muted-foreground">{l.template}</span>
          <Input value={tpl} onChange={(e) => setTpl(e.target.value)} onBlur={() => tpl !== String(settings[TEMPLATE_KEY] ?? "") && save({ [TEMPLATE_KEY]: tpl })} placeholder={`${l.templateDefault} ${placeholder}`} className="h-8 font-mono text-xs" />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {l.hint}{" "}
            <button type="button" className="text-primary hover:underline" onClick={() => goTo("alerts")}>
              {l.more}
            </button>
          </p>
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-muted-foreground">{l.noneHint}</p>
      )}
    </div>
  );
}
