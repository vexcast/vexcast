import { useState } from "react";
import { Copy, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n";
import { useStore } from "@/lib/store";
import { copyText } from "@/lib/tauri";
import { FormRow, SelectField, Section, SwitchRow } from "./form";
import { useSettings } from "./settings-context";

export function GeneralTab() {
  const t = useT();
  const g = t.settings.general;
  const m = t.mcp;
  const { draft, set } = useSettings();
  const [showKofi, setShowKofi] = useState(false);
  const p = draft.prefs;
  return (
    <div className="grid gap-8">
      <Section title={t.settings.tabs.general}>
        <FormRow label={g.language} htmlFor="set-lang">
          <SelectField
            id="set-lang"
            value={draft.general.language}
            onChange={(v) => set("general", { language: v as "es" | "en" })}
            options={[
              { value: "es", label: "Español" },
              { value: "en", label: "English" },
            ]}
            className="max-w-56"
          />
        </FormRow>
        <FormRow label={g.theme} htmlFor="set-theme">
          <SelectField
            id="set-theme"
            value={draft.general.theme}
            onChange={(v) => set("general", { theme: v as "dark" | "light" | "system" })}
            options={(["dark", "light", "system"] as const).map((v) => ({ value: v, label: g.themes[v] }))}
            className="max-w-56"
          />
        </FormRow>
      </Section>
      <Section title={g.updates}>
        <SwitchRow id="set-upd" label={g.checkUpdates} checked={draft.general.checkForUpdates} onChange={(v) => set("general", { checkForUpdates: v })} />
      </Section>
      <Section title={g.output}>
        <SwitchRow id="set-preflight" label={t.recovery.preflight} hint={t.recovery.preflightHint} checked={p.preflight} onChange={(v) => set("prefs", { preflight: v })} />
        <SwitchRow id="set-resume" label={t.recovery.title} hint={t.recovery.hint} checked={draft.general.resumeAfterCrash ?? true} onChange={(v) => set("general", { resumeAfterCrash: v })} />
        <SwitchRow id="set-cstart" label={g.confirmStart} checked={p.confirmStreamStart} onChange={(v) => set("prefs", { confirmStreamStart: v })} />
        <SwitchRow id="set-cstop" label={g.confirmStop} checked={p.confirmStreamStop} onChange={(v) => set("prefs", { confirmStreamStop: v })} />
        <SwitchRow id="set-crec" label={g.confirmRecStop} checked={p.confirmRecordStop} onChange={(v) => set("prefs", { confirmRecordStop: v })} />
      </Section>
      <Section title={g.preview}>
        <SwitchRow id="set-snap" label={g.snapping} checked={p.snapping} onChange={(v) => set("prefs", { snapping: v })} />
      </Section>
      <Section title={g.studio}>
        <SwitchRow id="set-sdbl" label={g.studioDoubleClick} checked={p.studioDoubleClick} onChange={(v) => set("prefs", { studioDoubleClick: v })} />
        <SwitchRow id="set-squick" label={g.studioQuick} checked={p.studioQuickTransitions} onChange={(v) => set("prefs", { studioQuickTransitions: v })} />
        <SwitchRow id="set-sswap" label={g.studioSwap} checked={p.studioSwap} onChange={(v) => set("prefs", { studioSwap: v })} />
      </Section>
      <Section title={g.remote}>
        <SwitchRow id="set-remote" label={g.remoteEnabled} hint={g.remoteHint} checked={draft.general.remoteControlEnabled} onChange={(v) => set("general", { remoteControlEnabled: v })} />
        <FormRow label={g.kofi} htmlFor="set-kofi" hint={g.kofiHint}>
          <div className="flex max-w-sm gap-1.5">
            <Input
              id="set-kofi"
              type={showKofi ? "text" : "password"}
              value={draft.general.kofiVerificationToken}
              onChange={(e) => set("general", { kofiVerificationToken: e.target.value })}
              className="h-8 font-mono text-xs"
            />
            <Button variant="outline" size="icon-sm" className="size-8" onClick={() => setShowKofi(!showKofi)} aria-label={showKofi ? t.common.hide : t.common.show}>
              {showKofi ? <EyeOff /> : <Eye />}
            </Button>
          </div>
        </FormRow>
      </Section>
      <Section title={m.title} description={m.desc}>
        <SwitchRow id="set-mcp" label={m.enabled} hint={m.enabledHint} checked={draft.general.mcpEnabled ?? true} onChange={(v) => set("general", { mcpEnabled: v })} />
        <McpConnect />
      </Section>
    </div>
  );
}

/** URL + ready-to-paste commands for MCP clients. */
function McpConnect() {
  const t = useT();
  const m = t.mcp;
  const client = useStore((s) => s.client);
  const url = `${client?.baseUrl ?? "http://localhost:7420"}/api/v1/mcp`.replace("127.0.0.1", "localhost");
  const snippets: { label: string; value: string }[] = [
    { label: m.url, value: url },
    { label: m.claudeCode, value: `claude mcp add --transport http vexcast ${url}` },
    { label: m.cursor, value: JSON.stringify({ mcpServers: { vexcast: { url } } }, null, 2) },
    { label: m.claudeDesktop, value: JSON.stringify({ mcpServers: { vexcast: { command: "npx", args: ["-y", "mcp-remote", url] } } }, null, 2) },
  ];
  return (
    <div className="flex flex-col gap-3">
      {snippets.map((s) => (
        <div key={s.label} className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">{s.label}</span>
          <div className="flex items-start gap-1.5">
            <pre className="selectable min-w-0 flex-1 overflow-x-auto rounded-md border bg-muted/40 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed whitespace-pre">{s.value}</pre>
            <Button
              variant="outline"
              size="icon-sm"
              className="size-8 shrink-0"
              aria-label={t.common.copy}
              onClick={async () => {
                if (await copyText(s.value)) toast.success(m.copied);
              }}
            >
              <Copy />
            </Button>
          </div>
        </div>
      ))}
      <p className="text-[11px] text-muted-foreground">{m.examples}</p>
    </div>
  );
}
