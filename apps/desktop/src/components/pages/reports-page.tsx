import type { SessionListItem, SessionSample, StreamSession } from "@vexcast/protocol";
import { ChartNoAxesCombined, Loader2, Sparkles, Table2, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useT } from "@/i18n";
import { confirmDialog } from "@/lib/dialogs";
import { fmt, formatDuration } from "@/lib/format";
import { act, errorMessage, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

// Validated categorical slots (light / dark), assigned in fixed order by platform.
const SERIES = [
  { stroke: "stroke-[#2a78d6] dark:stroke-[#3987e5]", fill: "fill-[#2a78d6] dark:fill-[#3987e5]", bg: "bg-[#2a78d6] dark:bg-[#3987e5]" },
  { stroke: "stroke-[#eb6834] dark:stroke-[#d95926]", fill: "fill-[#eb6834] dark:fill-[#d95926]", bg: "bg-[#eb6834] dark:bg-[#d95926]" },
  { stroke: "stroke-[#1baf7a] dark:stroke-[#199e70]", fill: "fill-[#1baf7a] dark:fill-[#199e70]", bg: "bg-[#1baf7a] dark:bg-[#199e70]" },
];
const ORDER = ["twitch", "kick"];
const platformsOf = (samples: SessionSample[]) => {
  const keys = new Set<string>();
  for (const s of samples) for (const k of Object.keys(s.viewers)) keys.add(k);
  return [...keys].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b));
};
const total = (s: SessionSample) => Object.values(s.viewers).reduce((a, b) => a + b, 0);
const niceMax = (v: number) => {
  if (v <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p) * p;
};

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Viewers (one line per platform) over chat messages (bars), sharing the minute axis. */
function Timeline({ s }: { s: StreamSession }) {
  const t = useT();
  const r = t.reports;
  const [ref, W] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const samples = s.samples;
  const platforms = platformsOf(samples);
  const n = samples.length;
  const padL = 36;
  const padR = platforms.length ? 92 : 16;
  const innerW = Math.max(40, W - padL - padR);
  const step = n > 1 ? innerW / (n - 1) : innerW;
  const x = (i: number) => padL + (n > 1 ? i * step : innerW / 2);
  const VH = 200;
  const vTop = 22;
  const vBottom = VH - 8;
  const vMax = niceMax(Math.max(1, ...samples.flatMap((x) => Object.values(x.viewers))));
  const y = (v: number) => vBottom - (v / vMax) * (vBottom - vTop);
  const CH = 96;
  const cTop = 6;
  const cBottom = CH - 18;
  const cMax = niceMax(Math.max(1, ...samples.map((x) => x.chat)));
  const cy = (v: number) => cBottom - (v / cMax) * (cBottom - cTop);
  const minuteOf = (ts: number) => Math.max(0, Math.round((ts - s.startedAt) / 60000));
  const evName = (type: string) => t.alerts.types[type as keyof typeof t.alerts.types] ?? type;

  // Scene periods.
  const bands = useMemo(() => {
    const out: { scene: string; from: number; to: number }[] = [];
    samples.forEach((x, i) => {
      const last = out[out.length - 1];
      if (last && last.scene === x.scene) last.to = i;
      else out.push({ scene: x.scene, from: i, to: i });
    });
    return out;
  }, [samples]);
  // Events grouped on the nearest sample.
  const evAt = useMemo(() => {
    const m = new Map<number, typeof s.events>();
    for (const e of s.events) {
      let best = 0;
      samples.forEach((x, i) => {
        if (Math.abs(x.ts - e.ts) < Math.abs(samples[best].ts - e.ts)) best = i;
      });
      if (n) m.set(best, [...(m.get(best) ?? []), e]);
    }
    return m;
  }, [s.events, samples, n]);

  const ticks = [0, 0.5, 1].map((f) => Math.round(vMax * f));
  const xEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 70))));
  const h = hover != null ? samples[hover] : null;
  const onMove = (e: React.MouseEvent<SVGElement>) => {
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    if (!n) return;
    setHover(Math.min(n - 1, Math.max(0, Math.round((px - padL) / (step || 1)))));
  };

  return (
    <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
      <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-xs font-medium">{r.viewersChart}</span>
        {platforms.length > 1 &&
          platforms.map((p, i) => (
            <span key={p} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={cn("size-2 rounded-full", SERIES[i % SERIES.length].bg)} />
              {r.platforms[p as keyof typeof r.platforms] ?? p}
            </span>
          ))}
      </div>
      {platforms.length === 0 && <p className="mb-2 text-xs text-muted-foreground">{r.noViewers}</p>}
      <svg width={W} height={VH} className="block overflow-visible" onMouseMove={onMove} role="img" aria-label={r.viewersChart}>
        {bands.map((b, i) => {
          const x0 = n > 1 ? Math.max(padL, x(b.from) - step / 2) : padL;
          const x1 = n > 1 ? Math.min(padL + innerW, x(b.to) + step / 2) : padL + innerW;
          return (
            <g key={i}>
              {i % 2 === 1 && <rect x={x0} y={vTop - 16} width={Math.max(0, x1 - x0)} height={vBottom - vTop + 16} className="fill-muted/50" />}
              {x1 - x0 > 64 && (
                <text x={x0 + 4} y={vTop - 6} className="fill-muted-foreground text-[10px]">
                  {b.scene.length > Math.floor((x1 - x0) / 6) ? `${b.scene.slice(0, Math.floor((x1 - x0) / 6) - 1)}…` : b.scene}
                </text>
              )}
            </g>
          );
        })}
        {ticks.map((v) => (
          <g key={v}>
            <line x1={padL} x2={padL + innerW} y1={y(v)} y2={y(v)} className="stroke-border" strokeDasharray={v === 0 ? undefined : "2 3"} />
            <text x={padL - 6} y={y(v) + 3} textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
              {v}
            </text>
          </g>
        ))}
        {platforms.map((p, pi) => {
          const d = samples.map((smp, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(smp.viewers[p] ?? 0).toFixed(1)}`).join("");
          const last = samples[n - 1];
          return (
            <g key={p}>
              <path d={d} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className={SERIES[pi % SERIES.length].stroke} />
              {last && (
                <text x={x(n - 1) + 8} y={y(last.viewers[p] ?? 0) + 3 + pi * (platforms.length > 1 && Math.abs(y(last.viewers[platforms[0]] ?? 0) - y(last.viewers[platforms[1]] ?? 0)) < 12 ? 12 : 0)} className="fill-foreground text-[11px]">
                  {r.platforms[p as keyof typeof r.platforms] ?? p} {last.viewers[p] ?? 0}
                </text>
              )}
            </g>
          );
        })}
        {[...evAt.entries()].map(([i, evs]) => (
          <rect key={i} x={x(i) - 4} y={vBottom - 4} width={8} height={8} transform={`rotate(45 ${x(i)} ${vBottom})`} className="fill-foreground stroke-background" strokeWidth={2}>
            <title>{evs.map((e) => `${e.type} · ${e.user}${e.amount ? ` (${e.amount})` : ""}`).join("\n")}</title>
          </rect>
        ))}
        {h && hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={vTop - 16} y2={vBottom} className="stroke-foreground/40" />
            {platforms.map((p, pi) => (
              <circle key={p} cx={x(hover)} cy={y(h.viewers[p] ?? 0)} r={4} strokeWidth={2} className={cn(SERIES[pi % SERIES.length].fill, "stroke-background")} />
            ))}
          </g>
        )}
        <rect x={padL - step / 2} y={0} width={innerW + step} height={VH} fill="transparent" />
      </svg>
      <div className="mt-3 mb-1 text-xs font-medium">{r.chatChart}</div>
      <svg width={W} height={CH} className="block" onMouseMove={onMove} role="img" aria-label={r.chatChart}>
        <line x1={padL} x2={padL + innerW} y1={cBottom} y2={cBottom} className="stroke-border" />
        <text x={padL - 6} y={cTop + 8} textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
          {cMax}
        </text>
        {samples.map((smp, i) => {
          const bw = Math.max(2, Math.min(14, step - 2));
          const top = cy(smp.chat);
          return smp.chat > 0 ? (
            <rect key={i} x={x(i) - bw / 2} y={top} width={bw} height={Math.max(1, cBottom - top)} rx={Math.min(2, bw / 2)} className={cn("fill-muted-foreground/55", hover === i && "fill-foreground")} />
          ) : null;
        })}
        {samples.map((x0, i) =>
          i % xEvery === 0 ? (
            <text key={i} x={x(i)} y={CH - 4} textAnchor="middle" className="fill-muted-foreground text-[10px] tabular-nums">
              {minuteOf(x0.ts)}m
            </text>
          ) : null,
        )}
        <rect x={padL - step / 2} y={0} width={innerW + step} height={CH} fill="transparent" />
      </svg>
      {h && hover != null && (
        <div
          className="pointer-events-none absolute top-8 z-10 w-52 rounded-md border bg-popover p-2.5 text-xs shadow-md"
          style={{ left: Math.min(Math.max(0, x(hover) + 12), W - 212) }}
        >
          <div className="mb-1 font-medium">{fmt(r.minute, { m: minuteOf(h.ts) })}</div>
          {platforms.map((p, pi) => (
            <div key={p} className="flex items-center gap-1.5">
              <span className={cn("size-2 rounded-full", SERIES[pi % SERIES.length].bg)} />
              <span className="flex-1 text-muted-foreground">{r.platforms[p as keyof typeof r.platforms] ?? p}</span>
              <span className="tabular-nums">{h.viewers[p] ?? 0}</span>
            </div>
          ))}
          <div className="flex gap-1.5">
            <span className="flex-1 text-muted-foreground">{r.chat}</span>
            <span className="tabular-nums">{h.chat}</span>
          </div>
          <div className="mt-1 truncate text-muted-foreground">
            {r.scene}: <span className="text-foreground">{h.scene || "—"}</span>
          </div>
          {(evAt.get(hover) ?? []).map((e, k) => (
            <div key={k} className="truncate">
              ◆ {evName(e.type)} · {e.user}
              {e.amount ? ` (${e.amount})` : ""}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SampleTable({ s }: { s: StreamSession }) {
  const t = useT();
  const r = t.reports;
  const platforms = platformsOf(s.samples);
  return (
    <div className="max-h-80 overflow-auto rounded-md border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted text-muted-foreground">
          <tr>
            <th className="px-2 py-1.5 text-left font-medium">min</th>
            {platforms.map((p) => (
              <th key={p} className="px-2 py-1.5 text-right font-medium">
                {r.platforms[p as keyof typeof r.platforms] ?? p}
              </th>
            ))}
            <th className="px-2 py-1.5 text-right font-medium">{r.total}</th>
            <th className="px-2 py-1.5 text-right font-medium">{r.chat}</th>
            <th className="px-2 py-1.5 text-left font-medium">{r.scene}</th>
          </tr>
        </thead>
        <tbody>
          {s.samples.map((x) => (
            <tr key={x.ts} className="border-t">
              <td className="px-2 py-1 tabular-nums">{Math.round((x.ts - s.startedAt) / 60000)}</td>
              {platforms.map((p) => (
                <td key={p} className="px-2 py-1 text-right tabular-nums">
                  {x.viewers[p] ?? 0}
                </td>
              ))}
              <td className="px-2 py-1 text-right tabular-nums">{total(x)}</td>
              <td className="px-2 py-1 text-right tabular-nums">{x.chat}</td>
              <td className="max-w-40 truncate px-2 py-1">{x.scene}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function SessionView({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const t = useT();
  const r = t.reports;
  const client = useStore((s) => s.client);
  const engine = useStore((s) => s.state?.ai.llm.provider ?? "none");
  const [s, setS] = useState<StreamSession | null>(null);
  const [table, setTable] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const v = await client!.getSession(id);
        if (!alive) return;
        setS(v);
        if (v.endedAt == null) timer = setTimeout(load, 30000);
      } catch {
        /* removed */
      }
    };
    setS(null);
    if (client) load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [client, id]);
  if (!s)
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  const m = s.summary;
  const analyze = async () => {
    setBusy(true);
    const res = await act((c) => c.sessionInsights(id));
    setBusy(false);
    if (res) setS({ ...s, insights: res.text });
  };
  const n = (v: number) => v.toLocaleString(t.locale, { maximumFractionDigits: 1 });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-lg font-semibold">{s.title || r.untitled}</h2>
            {s.endedAt == null && (
              <Badge variant="destructive" className="shrink-0">
                {r.live}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {new Date(s.startedAt).toLocaleString(t.locale, { dateStyle: "full", timeStyle: "short" })}
            {s.category ? ` · ${s.category}` : ""} · {s.destinations.join(", ")}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={async () => {
            if (await confirmDialog({ title: r.deleteConfirm, destructive: true, confirmLabel: t.common.delete })) {
              if ((await act((c) => c.deleteSession(id))) !== undefined) onDeleted();
            }
          }}
        >
          <Trash2 /> {r.delete}
        </Button>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2">
        <Tile label={r.duration} value={formatDuration(m.durationMs)} />
        <Tile label={r.peak} value={n(m.peakViewers)} />
        <Tile label={r.avg} value={n(m.avgViewers)} />
        <Tile label={r.chat} value={n(m.chatMessages)} />
        <Tile label={r.chatters} value={n(m.chatters)} />
        <Tile label={r.newChatters} value={n(m.newChatters)} />
        <Tile label={r.follows} value={n(m.follows)} />
        <Tile label={r.subs} value={n(m.subs)} />
        {m.bits > 0 && <Tile label={r.bits} value={n(m.bits)} />}
        {m.donations > 0 && <Tile label={r.donations} value={n(m.donations)} />}
        {m.raids > 0 && <Tile label={r.raids} value={n(m.raids)} />}
      </div>
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-2 flex justify-end">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setTable(!table)} disabled={!s.samples.length}>
            {table ? <ChartNoAxesCombined /> : <Table2 />} {table ? r.showChart : r.showTable}
          </Button>
        </div>
        {s.samples.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">{r.waiting}</p> : table ? <SampleTable s={s} /> : <Timeline s={s} />}
      </div>
      <div className="rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Sparkles className="size-4 text-muted-foreground" /> {r.insights}
            </div>
            <p className="text-xs text-muted-foreground">{engine === "none" ? r.needsEngine : r.insightsDesc}</p>
          </div>
          <Button size="sm" variant={s.insights ? "outline" : "default"} onClick={analyze} disabled={busy || engine === "none" || s.samples.length === 0}>
            {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} {busy ? r.analyzing : s.insights ? r.reanalyze : r.analyze}
          </Button>
        </div>
        {s.insights && <p className="selectable mt-3 text-sm leading-relaxed whitespace-pre-wrap">{s.insights}</p>}
      </div>
    </div>
  );
}

/** Analytics: one report per stream, with the timeline and AI takeaways. */
export function ReportsPage() {
  const t = useT();
  const r = t.reports;
  const client = useStore((s) => s.client);
  const streaming = useStore((s) => !!s.state?.status.streaming);
  const [list, setList] = useState<SessionListItem[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    try {
      const l = await client!.listSessions();
      setList(l);
      setSel((cur) => (cur && l.some((x) => x.id === cur) ? cur : (l[0]?.id ?? null)));
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  useEffect(() => {
    if (client) load();
    // Refresh when a stream starts or ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, streaming]);
  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-background md:grid-cols-[280px_minmax(0,1fr)] md:grid-rows-1" data-testid="page-reports">
      <div className="flex min-h-0 flex-col border-b md:border-r md:border-b-0">
        <div className="px-4 pt-4 pb-2">
          <h1 className="text-sm font-semibold">{r.title}</h1>
        </div>
        <ScrollArea className="max-h-48 min-h-0 flex-1 md:max-h-none">
          <ul className="flex flex-col gap-1 p-2">
            {list?.map((x) => (
              <li key={x.id}>
                <button
                  type="button"
                  onClick={() => setSel(x.id)}
                  className={cn("flex w-full flex-col gap-0.5 rounded-md px-3 py-2 text-left hover:bg-accent/60", sel === x.id && "bg-accent")}
                >
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {new Date(x.startedAt).toLocaleDateString(t.locale, { weekday: "short", day: "numeric", month: "short" })}
                    {x.endedAt == null && <span className="size-1.5 rounded-full bg-red-500" />}
                  </span>
                  <span className="truncate text-sm font-medium">{x.title || r.untitled}</span>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {formatDuration(x.summary.durationMs)} · {r.peak.toLowerCase()} {x.summary.peakViewers}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </div>
      <ScrollArea className="min-h-0">
        <div className="mx-auto max-w-5xl p-6">
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : list === null ? (
            <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
          ) : !sel ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <ChartNoAxesCombined className="size-8 text-muted-foreground" />
              <p className="max-w-md text-sm text-muted-foreground">{r.empty}</p>
            </div>
          ) : (
            <SessionView key={sel} id={sel} onDeleted={() => (setSel(null), load())} />
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
