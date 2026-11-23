import type { OutputSettings } from "@vexcast/protocol";
import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useT } from "@/i18n";
import { useCatalogEntry } from "@/lib/catalog";
import { isTauri, pickFolder } from "@/lib/tauri";
import { EncoderSettings, encoderOptions } from "./encoder-settings";
import { FormRow, NumberField, SelectField, Section, SwitchRow } from "./form";
import { AutoConfigSection } from "./autoconfig-section";
import { useSettings } from "./settings-context";

function Tracks({ value, onChange, single }: { value: number; onChange: (v: number) => void; single?: boolean }) {
  return (
    <div className="flex gap-3">
      {[0, 1, 2, 3, 4, 5].map((b) => (
        <label key={b} className="flex items-center gap-1.5 text-sm">
          <Checkbox checked={single ? value === b + 1 : !!(value & (1 << b))} onCheckedChange={(v) => (single ? onChange(b + 1) : onChange(v ? value | (1 << b) : value & ~(1 << b)))} />
          {b + 1}
        </label>
      ))}
    </div>
  );
}

export function OutputTab() {
  const t = useT();
  const o = t.settings.output;
  const { draft, set } = useSettings();
  const d = draft.output;
  const upd = (p: Partial<OutputSettings>) => set("output", p);
  const encoders = useCatalogEntry("encoders");
  const advanced = d.mode === "advanced";
  const videoOpts = encoderOptions(encoders, "video", o);
  const audioOpts = encoderOptions(encoders, "audio", o);
  const audioBitrates = [64, 96, 128, 160, 192, 224, 256, 320].map((b) => ({ value: String(b), label: `${b}` }));

  return (
    <div className="grid gap-6">
      <FormRow label={o.mode}>
        <ToggleGroup type="single" variant="outline" size="sm" value={d.mode} onValueChange={(v) => v && upd({ mode: v as OutputSettings["mode"] })}>
          <ToggleGroupItem value="simple" className="px-4">
            {o.modes.simple}
          </ToggleGroupItem>
          <ToggleGroupItem value="advanced" className="px-4">
            {o.modes.advanced}
          </ToggleGroupItem>
        </ToggleGroup>
      </FormRow>
      <Tabs defaultValue="streaming" className="gap-6">
        <TabsList>
          <TabsTrigger value="streaming">{o.streaming}</TabsTrigger>
          <TabsTrigger value="recording">{o.recording}</TabsTrigger>
          <TabsTrigger value="replay">{o.replay}</TabsTrigger>
          <TabsTrigger value="network">{o.network}</TabsTrigger>
        </TabsList>

        <TabsContent value="streaming" className="grid gap-8">
          <AutoConfigSection />
          <Section title={o.videoEncoder}>
            <FormRow label={o.videoEncoder}>
              <SelectField value={d.streamEncoder} onChange={(v) => upd({ streamEncoder: v, streamEncoderSettings: {} })} options={videoOpts} />
            </FormRow>
          </Section>
          <Section title={o.encoderSettings}>
            <EncoderSettings encoder={d.streamEncoder} settings={d.streamEncoderSettings} onChange={(s) => upd({ streamEncoderSettings: s })} />
          </Section>
          <Section title={o.audioEncoder}>
            <FormRow label={o.audioEncoder}>
              <SelectField value={d.streamAudioEncoder} onChange={(v) => upd({ streamAudioEncoder: v })} options={audioOpts} className="max-w-64" />
            </FormRow>
            <FormRow label={o.audioBitrate}>
              <SelectField value={String(d.streamAudioBitrate)} onChange={(v) => upd({ streamAudioBitrate: Number(v) })} options={audioBitrates} className="max-w-40" />
            </FormRow>
            {advanced && (
              <FormRow label={o.audioTrack}>
                <Tracks value={d.streamAudioTrack} single onChange={(v) => upd({ streamAudioTrack: v })} />
              </FormRow>
            )}
          </Section>
        </TabsContent>

        <TabsContent value="recording" className="grid gap-8">
          <Section title={o.recording}>
            <FormRow label={o.recPath}>
              <div className="flex max-w-xl gap-1.5">
                <Input value={d.recordingPath} onChange={(e) => upd({ recordingPath: e.target.value })} className="h-8 font-mono text-xs" />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={!isTauri()}
                  onClick={async () => {
                    const p = await pickFolder(d.recordingPath);
                    if (p) upd({ recordingPath: p });
                  }}
                >
                  <FolderOpen /> {t.props.browse}
                </Button>
              </div>
            </FormRow>
            <FormRow label={o.filenameFormat}>
              <Input value={d.recordingFilenameFormat} onChange={(e) => upd({ recordingFilenameFormat: e.target.value })} className="h-8 max-w-sm font-mono text-xs" />
            </FormRow>
            <SwitchRow id="out-overwrite" label={o.overwrite} checked={d.overwriteIfExists} onChange={(v) => upd({ overwriteIfExists: v })} />
            <FormRow label={o.format}>
              <SelectField
                value={d.recordingFormat}
                onChange={(v) => upd({ recordingFormat: v as OutputSettings["recordingFormat"] })}
                options={(["mkv", "mp4", "hybrid_mp4", "fragmented_mp4", "mov", "fragmented_mov", "flv", "ts"] as const).map((f) => ({ value: f, label: o.formats[f] }))}
                className="max-w-72"
              />
            </FormRow>
            <SwitchRow id="out-remux" label={o.autoRemux} checked={d.autoRemux} onChange={(v) => upd({ autoRemux: v })} />
            <FormRow label={o.recEncoder}>
              <SelectField
                value={d.recordingEncoder || "__same"}
                onChange={(v) => upd({ recordingEncoder: v === "__same" ? "" : v, recordingEncoderSettings: {} })}
                options={[{ value: "__same", label: o.sameAsStream }, ...videoOpts]}
              />
            </FormRow>
            {advanced && (
              <FormRow label={o.recTracks}>
                <Tracks value={d.recordingTracks} onChange={(v) => upd({ recordingTracks: v })} />
              </FormRow>
            )}
            {advanced && (
              <FormRow label={o.rescale}>
                <div className="flex items-center gap-3">
                  <Checkbox id="out-rescale" checked={!!d.recordingRescale} onCheckedChange={(v) => upd({ recordingRescale: v ? { width: draft.video.outputWidth, height: draft.video.outputHeight } : null })} />
                  {d.recordingRescale && (
                    <>
                      <NumberField value={d.recordingRescale.width} min={16} className="w-28" onChange={(w) => upd({ recordingRescale: { ...d.recordingRescale!, width: w } })} />
                      <span className="text-muted-foreground">×</span>
                      <NumberField value={d.recordingRescale.height} min={16} className="w-28" onChange={(h) => upd({ recordingRescale: { ...d.recordingRescale!, height: h } })} />
                    </>
                  )}
                </div>
              </FormRow>
            )}
            <FormRow label={o.splitFile}>
              <div className="flex flex-wrap items-center gap-3">
                <SelectField
                  value={d.splitFile.mode}
                  onChange={(v) => upd({ splitFile: { ...d.splitFile, mode: v as OutputSettings["splitFile"]["mode"] } })}
                  options={(["off", "time", "size", "manual"] as const).map((m) => ({ value: m, label: o.splitModes[m] }))}
                  className="w-56"
                />
                {d.splitFile.mode === "time" && <NumberField value={d.splitFile.minutes} min={1} suffix="min" onChange={(v) => upd({ splitFile: { ...d.splitFile, minutes: v } })} />}
                {d.splitFile.mode === "size" && <NumberField value={d.splitFile.megabytes} min={10} suffix="MB" onChange={(v) => upd({ splitFile: { ...d.splitFile, megabytes: v } })} />}
              </div>
            </FormRow>
          </Section>
          {d.recordingEncoder && (
            <Section title={o.encoderSettings}>
              <EncoderSettings encoder={d.recordingEncoder} settings={d.recordingEncoderSettings} onChange={(s) => upd({ recordingEncoderSettings: s })} />
            </Section>
          )}
        </TabsContent>

        <TabsContent value="replay" className="grid gap-8">
          <Section title={o.replay}>
            <SwitchRow id="out-rb" label={o.replayEnable} checked={d.replayBufferEnabled} onChange={(v) => upd({ replayBufferEnabled: v })} />
            <FormRow label={o.replaySeconds}>
              <NumberField value={d.replayBufferSeconds} min={1} max={21600} suffix="s" disabled={!d.replayBufferEnabled} onChange={(v) => upd({ replayBufferSeconds: v })} />
            </FormRow>
            <FormRow label={o.replayMb}>
              <NumberField value={d.replayBufferMaxMb} min={16} max={65536} suffix="MB" disabled={!d.replayBufferEnabled} onChange={(v) => upd({ replayBufferMaxMb: v })} />
            </FormRow>
          </Section>
        </TabsContent>

        <TabsContent value="network" className="grid gap-8">
          <Section title={o.reconnect}>
            <SwitchRow id="out-rc" label={o.reconnect} checked={d.reconnect} onChange={(v) => upd({ reconnect: v })} />
            <FormRow label={o.retryDelay}>
              <NumberField value={d.reconnectRetryDelaySec} min={1} max={30} suffix="s" disabled={!d.reconnect} onChange={(v) => upd({ reconnectRetryDelaySec: v })} />
            </FormRow>
            <FormRow label={o.maxRetries}>
              <NumberField value={d.reconnectMaxRetries} min={1} max={10000} disabled={!d.reconnect} onChange={(v) => upd({ reconnectMaxRetries: v })} />
            </FormRow>
          </Section>
          <Section title={o.delay}>
            <FormRow label={o.delay}>
              <NumberField value={d.streamDelaySec} min={0} max={1800} suffix="s" onChange={(v) => upd({ streamDelaySec: v })} />
            </FormRow>
            <SwitchRow id="out-dp" label={o.delayPreserve} checked={d.streamDelayPreserve} disabled={!d.streamDelaySec} onChange={(v) => upd({ streamDelayPreserve: v })} />
          </Section>
          <Section title={o.network}>
            <FormRow label={o.bindIp}>
              <Input value={d.bindIp} onChange={(e) => upd({ bindIp: e.target.value })} className="h-8 max-w-56 font-mono text-xs" />
            </FormRow>
            <SwitchRow id="out-dyn" label={o.dynamicBitrate} checked={d.dynamicBitrate} onChange={(v) => upd({ dynamicBitrate: v })} />
            <SwitchRow id="out-ll" label={o.lowLatency} checked={d.lowLatencyMode} onChange={(v) => upd({ lowLatencyMode: v })} />
          </Section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
