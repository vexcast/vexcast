import type { SourceInfo } from "@vexcast/protocol";
import { Badge } from "@/components/ui/badge";
import { Columns3, Filter, Headphones, MoreVertical, Rows3, SlidersHorizontal, Volume2, VolumeX } from "lucide-react";
import { memo, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/i18n";
import { openDialog } from "@/lib/dialogs";
import { fmt, throttle } from "@/lib/format";
import { dbToFader, faderToDb, formatDb } from "@/lib/obs";
import { usePrefs } from "@/lib/prefs";
import { act, flattenItems, useEditingScene, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Dock, EmptyHint, ToolButton } from "./dock";

const MIN_DB = -60;
const pct = (db: number) => Math.max(0, Math.min(1, (db - MIN_DB) / -MIN_DB)) * 100;
const GRADIENT = (dir: string) =>
  `linear-gradient(${dir}, var(--color-emerald-500) 0%, var(--color-emerald-500) ${pct(-20)}%, var(--color-amber-400) ${pct(-20)}%, var(--color-amber-400) ${pct(-9)}%, var(--color-red-500) ${pct(-9)}%, var(--color-red-500) 100%)`;

/** Audio sources shown in the mixer: global devices + the edited scene's audio sources. */
export function useMixerSources(includeHidden = false): SourceInfo[] {
  const scene = useEditingScene();
  const sources = useStore((s) => s.state!.sources);
  const hidden = usePrefs((p) => p.hiddenMixer);
  return useMemo(() => {
    const inScene = new Set(scene ? flattenItems(scene.items).map((i) => i.sourceUuid) : []);
    const list = sources.filter((s) => s.audio && (s.globalSlot != null || inScene.has(s.uuid)));
    list.sort((a, b) => (a.globalSlot ? 0 : 1) - (b.globalSlot ? 0 : 1));
    return includeHidden ? list : list.filter((s) => !hidden.includes(s.uuid));
  }, [scene, sources, hidden, includeHidden]);
}

export function MixerDock() {
  const t = useT();
  const vertical = usePrefs((p) => p.mixerVertical);
  const set = usePrefs((p) => p.set);
  const list = useMixerSources();
  return (
    <Dock
      title={t.docks.mixer}
      testId="dock-mixer"
      actions={
        <>
          <ToolButton icon={vertical ? Rows3 : Columns3} label={vertical ? t.mixer.horizontal : t.mixer.vertical} onClick={() => set({ mixerVertical: !vertical })} className="size-6" />
          <ToolButton icon={SlidersHorizontal} label={t.mixer.advanced} onClick={() => openDialog("advancedAudio", true)} className="size-6" />
        </>
      }
    >
      {list.length === 0 ? (
        <EmptyHint title={t.mixer.empty} />
      ) : vertical ? (
        <div className="h-full overflow-x-auto overflow-y-hidden" data-testid="mixer-vertical">
          <div className="flex h-full min-h-56 w-max gap-1.5 p-2">
            {list.map((s) => (
              <Strip key={s.uuid} source={s} vertical />
            ))}
          </div>
        </div>
      ) : (
        <ScrollArea className="h-full">
          <div className="flex flex-col divide-y">
            {list.map((s) => (
              <Strip key={s.uuid} source={s} vertical={false} />
            ))}
          </div>
        </ScrollArea>
      )}
    </Dock>
  );
}

function StripMenu({ source }: { source: SourceInfo }) {
  const t = useT();
  const prefs = usePrefs();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="size-6 text-muted-foreground" aria-label={t.common.properties}>
          <MoreVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={() => openDialog("properties", { type: "source", uuid: source.uuid })}>{t.mixer.properties}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openDialog("filters", source.uuid)}>{t.mixer.filters}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openDialog("advancedAudio", true)}>{t.mixer.advanced}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => prefs.set({ hiddenMixer: [...prefs.hiddenMixer, source.uuid] })}>{t.mixer.hide}</DropdownMenuItem>
        <DropdownMenuItem disabled={!prefs.hiddenMixer.length} onSelect={() => prefs.set({ hiddenMixer: [] })}>
          {t.mixer.unhideAll}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const Strip = memo(function Strip({ source, vertical }: { source: SourceInfo; vertical: boolean }) {
  const t = useT();
  const mutate = useStore((s) => s.mutate);
  const send = useMemo(() => throttle((db: number) => act((c) => c.updateSource(source.uuid, { volumeDb: db })), 50), [source.uuid]);
  const setDb = (db: number) => {
    mutate((s) => ({ ...s, sources: s.sources.map((x) => (x.uuid === source.uuid ? { ...x, volumeDb: db, volume: Number.isFinite(db) ? Math.pow(10, db / 20) : 0 } : x)) }));
    send(Number.isFinite(db) ? Math.round(db * 10) / 10 : -100);
  };
  const fader = Math.round(dbToFader(source.volumeDb) * 1000);
  const mute = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn("size-6", source.muted ? "text-red-500 hover:text-red-500" : "text-muted-foreground")}
          aria-label={source.muted ? t.mixer.unmute : t.mixer.mute}
          aria-pressed={source.muted}
          data-testid={`mute-${source.name}`}
          onClick={() => {
            mutate((s) => ({ ...s, sources: s.sources.map((x) => (x.uuid === source.uuid ? { ...x, muted: !x.muted } : x)) }));
            act((c) => c.updateSource(source.uuid, { muted: !source.muted }));
          }}
        >
          {source.muted ? <VolumeX /> : <Volume2 />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{source.muted ? t.mixer.unmute : t.mixer.mute}</TooltipContent>
    </Tooltip>
  );

  const badges = <StripBadges source={source} />;
  if (vertical)
    return (
      <div className="flex h-full w-[112px] shrink-0 flex-col gap-1.5 rounded-md border bg-card px-2 py-2" data-testid={`strip-${source.name}`}>
        <span className="w-full truncate text-center text-xs font-medium" title={source.name}>
          {source.name}
        </span>
        <div className="flex h-4 items-center justify-center gap-1">
          <span className="font-mono text-[10px] text-muted-foreground tabular-nums">{formatDb(source.volumeDb)}</span>
          {badges}
        </div>
        <div className="flex min-h-28 flex-1 items-stretch justify-center gap-2 py-1">
          <Meter uuid={source.uuid} muted={source.muted} vertical />
          <Slider orientation="vertical" min={0} max={1000} step={1} value={[fader]} onValueChange={([v]) => setDb(faderToDb(v / 1000))} aria-label={t.mixer.volume} className="min-h-0" />
        </div>
        <div className="flex items-center justify-center">
          {mute}
          <StripMenu source={source} />
        </div>
      </div>
    );

  return (
    <div className="flex flex-col gap-1 px-2.5 py-2" data-testid={`strip-${source.name}`}>
      <div className="flex items-center gap-2">
        <span className="line-clamp-2 min-w-0 flex-1 text-xs leading-tight font-medium break-words" title={source.name}>
          {source.name}
        </span>
        {badges}
        <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{formatDb(source.volumeDb)}</span>
      </div>
      <Meter uuid={source.uuid} muted={source.muted} vertical={false} />
      <div className="flex items-center gap-1">
        <Slider className="flex-1" min={0} max={1000} step={1} value={[fader]} onValueChange={([v]) => setDb(faderToDb(v / 1000))} aria-label={t.mixer.volume} />
        {mute}
        <StripMenu source={source} />
      </div>
    </div>
  );
});

/** Per-channel meter: peak bar in green/yellow/red zones, magnitude line, peak-hold tick, clip indicator. */
const Meter = memo(function Meter({ uuid, muted, vertical }: { uuid: string; muted: boolean; vertical: boolean }) {
  const level = useStore((s) => s.levels[uuid]);
  const hold = useRef<{ db: number; at: number }[]>([]);
  const channels = level ? level.peak.length : 2;
  const now = performance.now();
  const rows = Array.from({ length: Math.max(1, channels) }, (_, ch) => {
    const peak = level?.peak[ch] ?? -100;
    const mag = level?.magnitude[ch] ?? -100;
    const input = level?.inputPeak[ch] ?? -100;
    const h = hold.current[ch];
    if (!h || peak >= h.db || now - h.at > 1500) hold.current[ch] = { db: peak, at: now };
    return { peak, mag, input, hold: hold.current[ch].db };
  });
  const marks = [0, -10, -20, -30, -40, -50, -60];
  if (vertical)
    return (
      <div className={cn("flex h-full gap-1", muted && "opacity-40 grayscale")}>
        <div className="relative w-5 font-mono text-[9px] text-muted-foreground">
          {marks.map((m) => (
            <span key={m} className="absolute right-0 translate-y-1/2 leading-none tabular-nums first:translate-y-0 last:translate-y-0" style={{ bottom: `${pct(m)}%` }}>
              {m}
            </span>
          ))}
        </div>
        {rows.map((r, i) => (
          <div key={i} className="relative w-2 overflow-hidden rounded-[2px]" style={{ background: GRADIENT("to top") }}>
            <div className="absolute inset-x-0 top-0 bg-muted/90" style={{ height: `${100 - pct(r.peak)}%` }} />
            <div className="absolute inset-x-0 h-px bg-foreground/70" style={{ bottom: `${pct(r.mag)}%` }} />
            <div className="absolute inset-x-0 h-0.5 bg-foreground" style={{ bottom: `calc(${pct(r.hold)}% - 1px)` }} />
            {r.input >= -0.5 && <div className="absolute inset-x-0 top-0 h-1 bg-red-500" />}
          </div>
        ))}
      </div>
    );
  return (
    <div className={cn("flex flex-col gap-0.5", muted && "opacity-40 grayscale")}>
      {rows.map((r, i) => (
        <div key={i} className="relative h-1.5 overflow-hidden rounded-[2px]" style={{ background: GRADIENT("to right") }}>
          <div className="absolute inset-y-0 right-0 bg-muted/90" style={{ width: `${100 - pct(r.peak)}%` }} />
          <div className="absolute inset-y-0 w-px bg-foreground/70" style={{ left: `${pct(r.mag)}%` }} />
          <div className="absolute inset-y-0 w-0.5 bg-foreground" style={{ left: `calc(${pct(r.hold)}% - 1px)` }} />
          {r.input >= -0.5 && <div className="absolute inset-y-0 right-0 w-1 bg-red-500" />}
        </div>
      ))}
      <div className="relative mt-0.5 h-3 font-mono text-[9px] text-muted-foreground">
        {marks.map((m) => (
          <span key={m} className="absolute top-0 -translate-x-1/2 tabular-nums first:translate-x-[-100%] last:translate-x-0" style={{ left: `${pct(m)}%` }}>
            {m}
          </span>
        ))}
      </div>
    </div>
  );
});

/** Monitoring indicator + filters badge. */
function StripBadges({ source }: { source: SourceInfo }) {
  const t = useT();
  const n = source.filters.length;
  return (
    <>
      {source.monitoring !== "none" && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Headphones className="size-3 shrink-0 text-muted-foreground" aria-label={t.mixer.monitoring} />
          </TooltipTrigger>
          <TooltipContent>{t.advAudio.monitoringTypes[source.monitoring]}</TooltipContent>
        </Tooltip>
      )}
      {n > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={() => openDialog("filters", source.uuid)} className="flex shrink-0 items-center" aria-label={fmt(t.mixer.filtersCount, { n })}>
              <Badge variant="secondary" className="h-4 gap-0.5 px-1 text-[10px]">
                <Filter className="size-2.5" />
                {n}
              </Badge>
            </button>
          </TooltipTrigger>
          <TooltipContent>{fmt(t.mixer.filtersCount, { n })}</TooltipContent>
        </Tooltip>
      )}
    </>
  );
}
