import { useState } from "react";
import { Gauge, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { AutoConfig } from "@vexcast/protocol";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { fmt } from "@/lib/format";
import { errorMessage, useStore } from "@/lib/store";
import { Section } from "./form";
import { useSettings } from "./settings-context";

/** Settings → Output → Streaming: measure the upload and apply recommended settings. */
export function AutoConfigSection() {
  const t = useT();
  const a = t.settings.output.auto;
  const client = useStore((s) => s.client);
  const { draft, set } = useSettings();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<AutoConfig | null>(null);
  const run = async () => {
    setBusy(true);
    try {
      setRes(await client!.autoconfig());
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const apply = () => {
    if (!res) return;
    const keep = draft.output.streamEncoder === res.encoder ? draft.output.streamEncoderSettings : {};
    set("output", { streamEncoder: res.encoder, streamEncoderSettings: { ...keep, bitrate: res.videoKbps, rate_control: "CBR" }, streamAudioBitrate: res.audioKbps });
    set("video", { outputWidth: res.width, outputHeight: res.height, fpsNum: res.fps, fpsDen: 1 });
    toast.success(a.applied);
  };
  const row = (label: string, value: string) => (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      <div className="text-sm font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
  return (
    <Section
      title={a.title}
      description={a.desc}
      actions={
        <Button size="sm" variant="outline" className="h-7" disabled={busy || !client} onClick={run} data-testid="autoconfig-run">
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Gauge className="size-3.5" />}
          {busy ? a.running : a.run}
        </Button>
      }
    >
      {res && (
        <div className="grid gap-3" data-testid="autoconfig-result">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {row(a.upload, `${(res.uploadKbps / 1000).toFixed(1)} Mbps`)}
            {row(a.encoder, `${res.encoder} (${res.hardware ? a.hardware : a.software})`)}
            {row(a.bitrate, `${res.videoKbps} kbps`)}
            {row(a.resolution, `${res.width}×${res.height} · ${res.fps} FPS`)}
          </div>
          <p className="text-xs text-muted-foreground">
            {res.destinations.length > 1 && `${fmt(a.destinations, { n: res.destinations.length })} `}
            {res.limitedBy === "upload" ? a.limitedUpload : a.limitedPlatform}
          </p>
          <div>
            <Button size="sm" onClick={apply}>
              {a.apply}
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}
