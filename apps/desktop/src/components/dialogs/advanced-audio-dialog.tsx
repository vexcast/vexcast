import { EMPTY } from "@/lib/store";
import type { MonitoringType, SourceInfo } from "@vexcast/protocol";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useT } from "@/i18n";
import { useDialogs } from "@/lib/dialogs";
import { throttle } from "@/lib/format";
import { dbToMul, mulToDb } from "@/lib/obs";
import { act, flattenItems, useStore } from "@/lib/store";

function NumCell({ value, onCommit, suffix, step = 1, min, max, width = "w-24" }: { value: number; onCommit: (v: number) => void; suffix?: string; step?: number; min?: number; max?: number; width?: string }) {
  const [d, setD] = useState(String(value));
  useEffect(() => setD(String(value)), [value]);
  const commit = () => {
    let v = Number(d);
    if (!Number.isFinite(v)) return setD(String(value));
    if (min != null) v = Math.max(min, v);
    if (max != null) v = Math.min(max, v);
    if (v !== value) onCommit(v);
  };
  return (
    <div className={`relative ${width}`}>
      <Input type="number" step={step} value={d} onChange={(e) => setD(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} className="h-7 pr-8 text-xs tabular-nums" />
      {suffix && <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[10px] text-muted-foreground">{suffix}</span>}
    </div>
  );
}

export function AdvancedAudioDialog() {
  const t = useT();
  const open = useDialogs((d) => d.advancedAudio);
  const close = useDialogs((d) => d.close);
  const sources = useStore((s) => s.state?.sources ?? EMPTY);
  const scenes = useStore((s) => s.state?.scenes ?? EMPTY);
  const [unit, setUnit] = useState<"db" | "pct">("db");
  const [showInactive, setShowInactive] = useState(true);
  const mutate = useStore((s) => s.mutate);

  const active = useMemo(() => {
    const used = new Set(scenes.flatMap((sc) => flattenItems(sc.items).map((i) => i.sourceUuid)));
    return (s: SourceInfo) => s.globalSlot != null || used.has(s.uuid);
  }, [scenes]);
  const list = sources.filter((s) => s.audio && (showInactive || active(s)));

  const update = useMemo(() => {
    const map = new Map<string, ReturnType<typeof throttle<[Partial<SourceInfo>]>>>();
    return (uuid: string, patch: Partial<SourceInfo>) => {
      mutate((s) => ({ ...s, sources: s.sources.map((x) => (x.uuid === uuid ? { ...x, ...patch } : x)) }));
      let f = map.get(uuid);
      if (!f) {
        f = throttle((p: Partial<SourceInfo>) => act((c) => c.updateSource(uuid, p)), 80);
        map.set(uuid, f);
      }
      f(patch);
    };
  }, [mutate]);

  const monitoring: MonitoringType[] = ["none", "monitor_only", "monitor_and_output"];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close("advancedAudio")}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-[min(1400px,95vw)]" data-testid="advanced-audio-dialog">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>{t.advAudio.title}</DialogTitle>
          <DialogDescription className="sr-only">{t.advAudio.title}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="px-4 py-2">
            <Table className="text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead>{t.advAudio.name}</TableHead>
                  <TableHead>{t.advAudio.status}</TableHead>
                  <TableHead>{t.advAudio.volume}</TableHead>
                  <TableHead className="text-center">{t.advAudio.mono}</TableHead>
                  <TableHead className="min-w-36">{t.advAudio.balance}</TableHead>
                  <TableHead>{t.advAudio.syncOffset}</TableHead>
                  <TableHead>{t.advAudio.monitoring}</TableHead>
                  <TableHead>{t.advAudio.tracks}</TableHead>
                  <TableHead>{t.advAudio.pushToMute}</TableHead>
                  <TableHead>{t.advAudio.pushToTalk}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((s) => (
                  <TableRow key={s.uuid}>
                    <TableCell className="max-w-40 truncate font-medium">{s.name}</TableCell>
                    <TableCell className={active(s) ? "" : "text-muted-foreground"}>{active(s) ? t.advAudio.active : t.advAudio.inactive}</TableCell>
                    <TableCell>
                      {unit === "db" ? (
                        <NumCell value={Math.round((Number.isFinite(s.volumeDb) ? s.volumeDb : -100) * 10) / 10} step={0.1} min={-100} max={26} suffix="dB" onCommit={(v) => update(s.uuid, { volumeDb: v, volume: dbToMul(v) })} />
                      ) : (
                        <NumCell value={Math.round(s.volume * 100)} min={0} max={2000} suffix="%" onCommit={(v) => update(s.uuid, { volume: v / 100, volumeDb: mulToDb(v / 100) })} />
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Checkbox checked={s.forceMono} onCheckedChange={(v) => update(s.uuid, { forceMono: !!v })} aria-label={t.advAudio.mono} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground">L</span>
                        <Slider min={0} max={100} step={1} value={[Math.round(s.balance * 100)]} onValueChange={([v]) => update(s.uuid, { balance: v / 100 })} className="w-24" disabled={s.forceMono} onDoubleClick={() => update(s.uuid, { balance: 0.5 })} />
                        <span className="text-[10px] text-muted-foreground">R</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <NumCell value={s.syncOffsetMs} min={-950} max={20000} suffix="ms" onCommit={(v) => update(s.uuid, { syncOffsetMs: Math.round(v) })} />
                    </TableCell>
                    <TableCell>
                      <Select value={s.monitoring} onValueChange={(v) => update(s.uuid, { monitoring: v as MonitoringType })}>
                        <SelectTrigger size="sm" className="h-7 w-60 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {monitoring.map((m) => (
                            <SelectItem key={m} value={m}>
                              {t.advAudio.monitoringTypes[m]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1.5">
                        {[0, 1, 2, 3, 4, 5].map((b) => (
                          <label key={b} className="flex flex-col items-center gap-0.5 text-[10px] text-muted-foreground">
                            <Checkbox checked={!!(s.mixers & (1 << b))} onCheckedChange={(v) => update(s.uuid, { mixers: v ? s.mixers | (1 << b) : s.mixers & ~(1 << b) })} />
                            {b + 1}
                          </label>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Checkbox checked={s.pushToMute} onCheckedChange={(v) => update(s.uuid, { pushToMute: !!v })} aria-label={t.advAudio.pushToMute} />
                        <NumCell value={s.pushToMuteDelayMs} min={0} suffix="ms" width="w-20" onCommit={(v) => update(s.uuid, { pushToMuteDelayMs: Math.round(v) })} />
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Checkbox checked={s.pushToTalk} onCheckedChange={(v) => update(s.uuid, { pushToTalk: !!v })} aria-label={t.advAudio.pushToTalk} />
                        <NumCell value={s.pushToTalkDelayMs} min={0} suffix="ms" width="w-20" onCommit={(v) => update(s.uuid, { pushToTalkDelayMs: Math.round(v) })} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
        <DialogFooter className="items-center border-t px-6 py-3 sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch id="aa-inactive" checked={showInactive} onCheckedChange={setShowInactive} />
              <Label htmlFor="aa-inactive" className="font-normal">
                {t.advAudio.showInactive}
              </Label>
            </div>
            <ToggleGroup type="single" variant="outline" size="sm" value={unit} onValueChange={(v) => v && setUnit(v as "db" | "pct")}>
              <ToggleGroupItem value="db" className="px-3">
                {t.advAudio.unitDb}
              </ToggleGroupItem>
              <ToggleGroupItem value="pct" className="px-3">
                {t.advAudio.unitPercent}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <Button onClick={() => close("advancedAudio")}>{t.common.close}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
