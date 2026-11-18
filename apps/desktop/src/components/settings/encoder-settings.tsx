import type { EncoderType, Property } from "@vexcast/protocol";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PropertiesView } from "@/components/properties/properties-view";
import { useT } from "@/i18n";
import { useStore } from "@/lib/store";
import type { Option } from "./form";

/** Video encoder options grouped hardware / software (like OBS). */
export function encoderOptions(encoders: EncoderType[] | null, type: "video" | "audio", t: { hardware: string; software: string }): Option[] {
  return (encoders ?? [])
    .filter((e) => e.type === type && !e.deprecated)
    .sort((a, b) => Number(b.hardware) - Number(a.hardware) || a.name.localeCompare(b.name))
    .map((e) => ({ value: e.id, label: e.name, group: type === "video" ? (e.hardware ? t.hardware : t.software) : undefined }));
}

/** Encoder property schema bound to a settings object (re-evaluated on every change). */
export function EncoderSettings({ encoder, settings, onChange }: { encoder: string; settings: Record<string, unknown>; onChange: (s: Record<string, unknown>) => void }) {
  const t = useT();
  const client = useStore((s) => s.client);
  const [props, setProps] = useState<Property[] | null>(null);
  const seq = useRef(0);
  const settingsKey = JSON.stringify(settings);
  useEffect(() => {
    if (!client || !encoder) return;
    const s = ++seq.current;
    const id = setTimeout(() => {
      client
        .encoderProperties(encoder, settings)
        .then((p) => s === seq.current && setProps(p))
        .catch(() => s === seq.current && setProps([]));
    }, 120);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, encoder, settingsKey]);
  useEffect(() => setProps(null), [encoder]);

  if (!props)
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> {t.settings.output.loadingEncoder}
      </div>
    );
  return (
    <PropertiesView
      properties={props}
      labelWidth="w-56"
      onChange={(name, value) => {
        setProps((cur) => cur && cur.map((p) => (p.name === name ? { ...p, value } : p)));
        onChange({ ...settings, [name]: value });
      }}
    />
  );
}
