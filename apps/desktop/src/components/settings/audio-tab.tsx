import type { AudioDevice, AudioSettings } from "@vexcast/protocol";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n";
import { fmt } from "@/lib/format";
import { useStore } from "@/lib/store";
import { FormRow, SelectField, Section, SwitchRow } from "./form";
import { useSettings } from "./settings-context";

export function AudioTab() {
  const t = useT();
  const a = t.settings.audio;
  const { draft, set } = useSettings();
  const d = draft.audio;
  const upd = (p: Partial<AudioSettings>) => set("audio", p);
  const client = useStore((s) => s.client);
  const [inputs, setInputs] = useState<AudioDevice[]>([]);
  const [outputs, setOutputs] = useState<AudioDevice[]>([]);
  const [monitors, setMonitors] = useState<AudioDevice[]>([]);
  useEffect(() => {
    if (!client) return;
    client.audioDevices("input").then(setInputs).catch(() => {});
    client.audioDevices("output").then(setOutputs).catch(() => {});
    client
      .monitoringDevices()
      .then(setMonitors)
      .catch(() => client.audioDevices("output").then(setMonitors).catch(() => {}));
  }, [client]);

  const devOptions = (list: AudioDevice[], value: string) => {
    const opts = [
      { value: "default", label: a.default },
      { value: "disabled", label: a.disabled },
      ...list.filter((x) => x.id !== "default").map((x) => ({ value: x.id, label: x.name })),
    ];
    if (!opts.some((o) => o.value === value)) opts.push({ value, label: value });
    return opts;
  };

  const slots: { key: "desktop1" | "desktop2" | "mic1" | "mic2" | "mic3" | "mic4"; out: boolean }[] = [
    { key: "desktop1", out: true },
    { key: "desktop2", out: true },
    { key: "mic1", out: false },
    { key: "mic2", out: false },
    { key: "mic3", out: false },
    { key: "mic4", out: false },
  ];

  return (
    <div className="grid gap-8">
      <Section title={a.general} description={a.restartHint}>
        <FormRow label={a.sampleRate}>
          <SelectField value={String(d.sampleRate)} onChange={(v) => upd({ sampleRate: Number(v) as 44100 | 48000 })} options={[{ value: "44100", label: "44.1 kHz" }, { value: "48000", label: "48 kHz" }]} className="max-w-40" />
        </FormRow>
        <FormRow label={a.channels}>
          <SelectField
            value={d.channels}
            onChange={(v) => upd({ channels: v as AudioSettings["channels"] })}
            options={(["mono", "stereo", "2.1", "4.0", "4.1", "5.1", "7.1"] as const).map((c) => ({ value: c, label: c === "mono" ? "Mono" : c === "stereo" ? "Stereo" : c }))}
            className="max-w-40"
          />
        </FormRow>
      </Section>
      <Section title={a.devices}>
        {slots.map(({ key, out }) => (
          <FormRow key={key} label={a[key]}>
            <SelectField value={d[key]} onChange={(v) => upd({ [key]: v } as Partial<AudioSettings>)} options={devOptions(out ? outputs : inputs, d[key])} />
          </FormRow>
        ))}
      </Section>
      <Section title={a.monitoring}>
        <FormRow label={a.monitoring}>
          <SelectField
            value={d.monitoringDeviceId || "default"}
            onChange={(v) => upd({ monitoringDeviceId: v, monitoringDeviceName: monitors.find((o) => o.id === v)?.name ?? a.default })}
            options={[{ value: "default", label: a.default }, ...monitors.filter((x) => x.id !== "default").map((x) => ({ value: x.id, label: x.name }))]}
          />
        </FormRow>
        <SwitchRow id="aud-lowlat" label={a.lowLatency} checked={d.lowLatencyBuffering} onChange={(v) => upd({ lowLatencyBuffering: v })} />
      </Section>
      <Section title={a.meters}>
        <FormRow label={a.decay}>
          <SelectField value={d.meterDecayRate} onChange={(v) => upd({ meterDecayRate: v as AudioSettings["meterDecayRate"] })} options={(["fast", "medium", "slow"] as const).map((x) => ({ value: x, label: a.decays[x] }))} className="max-w-64" />
        </FormRow>
        <FormRow label={a.peakType}>
          <SelectField value={d.peakMeterType} onChange={(v) => upd({ peakMeterType: v as AudioSettings["peakMeterType"] })} options={(["sample", "true_peak"] as const).map((x) => ({ value: x, label: a.peakTypes[x] }))} className="max-w-64" />
        </FormRow>
      </Section>
      <Section title={a.trackNames}>
        <div className="grid grid-cols-[14rem_1fr] gap-4">
          <span />
          <div className="grid max-w-md grid-cols-2 gap-2">
            {Array.from({ length: 6 }, (_, i) => (
              <Input
                key={i}
                value={d.trackNames[i] ?? ""}
                placeholder={fmt(a.track, { n: i + 1 })}
                onChange={(e) => {
                  const names = [...d.trackNames];
                  while (names.length < 6) names.push("");
                  names[i] = e.target.value;
                  upd({ trackNames: names });
                }}
                className="h-8"
              />
            ))}
          </div>
        </div>
      </Section>
    </div>
  );
}
