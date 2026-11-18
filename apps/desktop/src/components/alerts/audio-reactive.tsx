import { Copy, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useT } from "@/i18n";
import { fmt } from "@/lib/format";
import { act, baseSceneUuid, useStore } from "@/lib/store";
import { copyText } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { Field, Section } from "@/components/extras/shared";

type Style = "bars" | "ring" | "glow" | "wave";
const STYLES: Style[] = ["bars", "ring", "glow", "wave"];
/** Source size per style. */
const SIZE: Record<Style, [number, number]> = { bars: [1280, 300], ring: [600, 600], glow: [800, 600], wave: [1280, 300] };
const ANY = "__any";

/** Overlays that move with the audio (voice, music…). */
export function AudioReactiveSection() {
  const t = useT();
  const a = t.audioReactive;
  const client = useStore((s) => s.client);
  const sources = useStore((s) => s.state?.sources ?? []);
  const audio = useMemo(() => sources.filter((s) => s.audio), [sources]);
  const [style, setStyle] = useState<Style>("bars");
  const [source, setSource] = useState<string>(() => audio.find((s) => /input_capture/.test(s.kind))?.uuid ?? ANY);
  const [color, setColor] = useState("#8b5cf6");
  const [color2, setColor2] = useState("#22d3ee");
  const [gain, setGain] = useState(1.2);
  const query = (demo: boolean) =>
    `style=${style}&color=${color.slice(1)}&color2=${color2.slice(1)}&gain=${gain}${source !== ANY ? `&source=${source}` : ""}${demo ? "&demo=1" : ""}`;
  const base = client?.widgetUrl("audio") ?? "";
  const url = base ? `${base}${base.includes("?") ? "&" : "?"}${query(false)}` : "";
  const preview = (s: Style) => (base ? `${base}${base.includes("?") ? "&" : "?"}${query(true).replace(`style=${style}`, `style=${s}`)}` : "");
  const add = async () => {
    const st = useStore.getState().state;
    const scene = st ? baseSceneUuid(st) : null;
    if (!scene) return;
    const [width, height] = SIZE[style];
    const r = await act((c) => c.createSource({ name: fmt(a.sourceName, { style: a.styles[style] }), kind: "browser_source", settings: { url, width, height }, sceneUuid: scene }));
    if (r) toast.success(a.added);
  };
  return (
    <Section title={a.title} description={a.desc}>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {STYLES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStyle(s)}
            className={cn("overflow-hidden rounded-lg border text-left transition-colors hover:bg-accent/40", style === s && "border-primary ring-1 ring-primary/40")}
            aria-pressed={style === s}
          >
            <div className="pointer-events-none aspect-video bg-[repeating-conic-gradient(#80808018_0%_25%,transparent_0%_50%)] bg-[length:16px_16px]">
              {base && <iframe title={a.styles[s]} src={preview(s)} className="size-full border-0" />}
            </div>
            <div className="px-2.5 py-1.5 text-xs font-medium">{a.styles[s]}</div>
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={a.source} hint={a.sourceHint}>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{a.anySource}</SelectItem>
              {audio.map((s) => (
                <SelectItem key={s.uuid} value={s.uuid}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={`${a.gain} · ${gain.toFixed(1)}×`}>
          <Slider min={0.5} max={3} step={0.1} value={[gain]} onValueChange={([g]) => setGain(g)} className="my-auto py-2" />
        </Field>
        <Field label={a.colors}>
          <div className="flex items-center gap-2">
            <Input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-14 p-1" aria-label={a.colors} />
            <Input type="color" value={color2} onChange={(e) => setColor2(e.target.value)} className="h-9 w-14 p-1" aria-label={a.colors} />
          </div>
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={add} data-testid="audio-reactive-add">
          <Plus /> {a.add}
        </Button>
        <Button
          variant="outline"
          onClick={async () => {
            if (await copyText(url)) toast.success(t.common.copied);
          }}
        >
          <Copy /> {a.copyUrl}
        </Button>
        <span className="text-xs text-muted-foreground">{fmt(a.size, { w: SIZE[style][0], h: SIZE[style][1] })}</span>
      </div>
    </Section>
  );
}
