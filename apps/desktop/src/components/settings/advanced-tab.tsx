import type { AdvancedSettings, VideoSettings } from "@vexcast/protocol";
import { useT } from "@/i18n";
import { FormRow, NumberField, SelectField, Section, SwitchRow } from "./form";
import { useSettings } from "./settings-context";

export function AdvancedTab() {
  const t = useT();
  const a = t.settings.advanced;
  const { draft, set } = useSettings();
  const d = draft.advanced;
  const v = draft.video;
  const upd = (p: Partial<AdvancedSettings>) => set("advanced", p);
  const updV = (p: Partial<VideoSettings>) => set("video", p);
  const hdr = v.colorSpace === "2100PQ" || v.colorSpace === "2100HLG";
  return (
    <div className="grid gap-8">
      <Section title={a.general} description={a.restartHint}>
        <FormRow label={a.priority}>
          <SelectField
            value={d.processPriority}
            onChange={(x) => upd({ processPriority: x as AdvancedSettings["processPriority"] })}
            options={(["high", "above_normal", "normal", "below_normal", "idle"] as const).map((x) => ({ value: x, label: a.priorities[x] }))}
            className="max-w-64"
          />
        </FormRow>
        <FormRow label={a.renderer}>
          <SelectField
            value={d.renderer}
            onChange={(x) => upd({ renderer: x as AdvancedSettings["renderer"] })}
            options={[
              { value: "d3d11", label: "Direct3D 11" },
              { value: "opengl", label: "OpenGL" },
              { value: "metal", label: "Metal" },
            ]}
            className="max-w-64"
          />
        </FormRow>
        <SwitchRow id="adv-exit" label={a.confirmExit} checked={d.confirmOnExit} onChange={(x) => upd({ confirmOnExit: x })} />
      </Section>
      <Section title={a.video}>
        <FormRow label={a.colorFormat}>
          <SelectField
            value={v.colorFormat}
            onChange={(x) => updV({ colorFormat: x as VideoSettings["colorFormat"] })}
            options={(["NV12", "I420", "I444", "P010", "I010", "P216", "P416", "BGRA"] as const).map((x) => ({ value: x, label: x === "NV12" ? "NV12 (8-bit, 4:2:0, 2 planes)" : x === "P010" ? "P010 (10-bit, 4:2:0, 2 planes)" : x === "I444" ? "I444 (8-bit, 4:4:4, 3 planes)" : x }))}
            className="max-w-72"
          />
        </FormRow>
        <FormRow label={a.colorSpace}>
          <SelectField
            value={v.colorSpace}
            onChange={(x) => updV({ colorSpace: x as VideoSettings["colorSpace"] })}
            options={[
              { value: "601", label: "Rec. 601" },
              { value: "709", label: "Rec. 709" },
              { value: "sRGB", label: "sRGB" },
              { value: "2100PQ", label: "Rec. 2100 (PQ)" },
              { value: "2100HLG", label: "Rec. 2100 (HLG)" },
            ]}
            className="max-w-72"
          />
        </FormRow>
        <FormRow label={a.colorRange}>
          <SelectField value={v.colorRange} onChange={(x) => updV({ colorRange: x as VideoSettings["colorRange"] })} options={(["partial", "full"] as const).map((x) => ({ value: x, label: a.colorRanges[x] }))} className="max-w-40" />
        </FormRow>
        <FormRow label={a.sdrWhite}>
          <NumberField value={v.sdrWhiteLevel} min={80} max={480} suffix="nits" disabled={!hdr} onChange={(n) => updV({ sdrWhiteLevel: n })} />
        </FormRow>
        <FormRow label={a.hdrPeak}>
          <NumberField value={v.hdrNominalPeakLevel} min={400} max={10000} suffix="nits" disabled={!hdr} onChange={(n) => updV({ hdrNominalPeakLevel: n })} />
        </FormRow>
      </Section>
      <Section title={a.browser}>
        <SwitchRow id="adv-bhw" label={a.browserHw} checked={d.browserHwAccel} onChange={(x) => upd({ browserHwAccel: x })} />
      </Section>
      <Section title={a.hotkeys}>
        <FormRow label={a.hotkeyFocus}>
          <SelectField
            value={d.hotkeyFocusBehavior}
            onChange={(x) => upd({ hotkeyFocusBehavior: x as AdvancedSettings["hotkeyFocusBehavior"] })}
            options={(["never", "focused", "unfocused"] as const).map((x) => ({ value: x, label: a.hotkeyFocuses[x] }))}
          />
        </FormRow>
      </Section>
      <Section title={a.recording}>
        <SwitchRow id="adv-remux" label={a.autoRemux} checked={d.autoRemux} onChange={(x) => upd({ autoRemux: x })} />
      </Section>
    </div>
  );
}
