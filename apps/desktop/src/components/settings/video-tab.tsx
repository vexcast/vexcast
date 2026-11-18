import type { VideoSettings } from "@vexcast/protocol";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n";
import { fmt } from "@/lib/format";
import { FormRow, NumberField, SelectField, Section, SwitchRow } from "./form";
import { useSettings } from "./settings-context";

const BASE_RES = ["3840x2160", "2560x1440", "1920x1080", "1600x900", "1280x720", "1080x1920", "720x1280"];
const SCALES = [1, 1.25, 1.5, 1.67, 2, 2.25, 2.5, 3];
const COMMON_FPS: [string, number, number][] = [
  ["24 NTSC", 24000, 1001],
  ["25 PAL", 25, 1],
  ["29.97", 30000, 1001],
  ["30", 30, 1],
  ["48", 48, 1],
  ["50 PAL", 50, 1],
  ["59.94", 60000, 1001],
  ["60", 60, 1],
  ["120", 120, 1],
  ["144", 144, 1],
];

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
const aspect = (w: number, h: number) => {
  const g = gcd(w, h) || 1;
  return `${w / g}:${h / g}`;
};

/** Resolution select with common values + free "WxH" entry. */
function ResolutionField({ value, options, onChange, testId }: { value: string; options: string[]; onChange: (w: number, h: number) => void; testId?: string }) {
  const t = useT();
  const [text, setText] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const all = options.includes(value) ? options : [value, ...options];
  const commit = (s: string) => {
    const m = /^\s*(\d{2,5})\s*[x×]\s*(\d{2,5})\s*$/i.exec(s);
    if (!m) return setInvalid(true);
    setInvalid(false);
    onChange(Number(m[1]), Number(m[2]));
  };
  return (
    <div className="flex items-center gap-2">
      <SelectField
        value={value}
        onChange={(v) => {
          setText(v);
          commit(v);
        }}
        options={all.map((r) => {
          const [w, h] = r.split("x").map(Number);
          return { value: r, label: `${r}  (${aspect(w, h)})` };
        })}
        className="w-56"
      />
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => commit(text)}
        onKeyDown={(e) => e.key === "Enter" && commit(text)}
        aria-invalid={invalid}
        placeholder="1920x1080"
        className="h-8 w-32 font-mono text-xs"
        data-testid={testId}
      />
      {invalid && <span className="text-xs text-destructive">{t.settings.video.invalid}</span>}
    </div>
  );
}

export function VideoTab() {
  const t = useT();
  const v = t.settings.video;
  const { draft, set } = useSettings();
  const d = draft.video;
  const upd = (p: Partial<VideoSettings>) => set("video", p);
  const base = `${d.baseWidth}x${d.baseHeight}`;
  const out = `${d.outputWidth}x${d.outputHeight}`;
  const outputs = SCALES.map((s) => `${Math.round(d.baseWidth / s / 2) * 2}x${Math.round(d.baseHeight / s / 2) * 2}`).filter((x, i, a) => a.indexOf(x) === i);
  const fpsIdx = COMMON_FPS.findIndex(([, n, den]) => n === d.fpsNum && den === d.fpsDen);
  const [fpsType, setFpsType] = useState<"common" | "integer" | "fraction">(fpsIdx >= 0 ? "common" : d.fpsDen === 1 ? "integer" : "fraction");

  return (
    <div className="grid gap-8">
      <Section title={t.settings.tabs.video}>
        <FormRow label={v.base}>
          <ResolutionField
            value={base}
            options={BASE_RES}
            testId="video-base"
            onChange={(w, h) => {
              // Keep the output scale ratio like OBS when the base changes.
              const ratio = d.outputWidth / d.baseWidth;
              upd({ baseWidth: w, baseHeight: h, outputWidth: Math.round((w * ratio) / 2) * 2, outputHeight: Math.round((h * ratio) / 2) * 2 });
            }}
          />
        </FormRow>
        <FormRow label={v.output}>
          <ResolutionField value={out} options={outputs} onChange={(w, h) => upd({ outputWidth: w, outputHeight: h })} />
        </FormRow>
        <FormRow label={v.downscale}>
          <SelectField
            value={d.downscaleFilter}
            disabled={base === out}
            onChange={(x) => upd({ downscaleFilter: x as VideoSettings["downscaleFilter"] })}
            options={(["bilinear", "area", "bicubic", "lanczos"] as const).map((x) => ({ value: x, label: v.downscales[x] }))}
          />
        </FormRow>
        <FormRow label={v.fpsType}>
          <SelectField value={fpsType} onChange={(x) => setFpsType(x as typeof fpsType)} options={(["common", "integer", "fraction"] as const).map((x) => ({ value: x, label: v.fpsTypes[x] }))} className="max-w-64" />
        </FormRow>
        {fpsType === "common" && (
          <FormRow label={v.fps}>
            <SelectField
              value={fpsIdx >= 0 ? String(fpsIdx) : ""}
              placeholder={`${d.fpsNum}/${d.fpsDen}`}
              onChange={(x) => upd({ fpsNum: COMMON_FPS[Number(x)][1], fpsDen: COMMON_FPS[Number(x)][2] })}
              options={COMMON_FPS.map(([l], i) => ({ value: String(i), label: l }))}
              className="max-w-40"
            />
          </FormRow>
        )}
        {fpsType === "integer" && (
          <FormRow label={v.fps}>
            <NumberField value={Math.round(d.fpsNum / d.fpsDen)} min={1} max={240} onChange={(n) => upd({ fpsNum: n, fpsDen: 1 })} />
          </FormRow>
        )}
        {fpsType === "fraction" && (
          <>
            <FormRow label={v.numerator}>
              <NumberField value={d.fpsNum} min={1} onChange={(n) => upd({ fpsNum: n })} />
            </FormRow>
            <FormRow label={v.denominator}>
              <NumberField value={d.fpsDen} min={1} onChange={(n) => upd({ fpsDen: n })} />
            </FormRow>
          </>
        )}
      </Section>
      <Section title={v.vertical}>
        <SwitchRow id="vid-vert" label={v.verticalEnable} checked={d.verticalEnabled} onChange={(x) => upd({ verticalEnabled: x })} />
        <FormRow label={v.verticalSize} hint={fmt(v.aspect, { ratio: aspect(d.verticalWidth, d.verticalHeight) })}>
          <ResolutionField value={`${d.verticalWidth}x${d.verticalHeight}`} options={["1080x1920", "720x1280", "1440x2560"]} onChange={(w, h) => upd({ verticalWidth: w, verticalHeight: h })} />
        </FormRow>
      </Section>
    </div>
  );
}
