import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import type { AdvancedSettings, ObsPlugins } from "@vexcast/protocol";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/i18n";
import { fmt } from "@/lib/format";
import { useStore } from "@/lib/store";
import { isTauri, revealPath } from "@/lib/tauri";
import { Section, SwitchRow } from "./form";

/** Settings → Advanced → OBS plugins: third-party plugins found at startup. */
export function PluginsSection({ value, onChange }: { value: AdvancedSettings; onChange: (p: Partial<AdvancedSettings>) => void }) {
  const t = useT();
  const a = t.settings.advanced;
  const client = useStore((s) => s.client);
  const saved = useStore((s) => s.state?.advanced);
  const [info, setInfo] = useState<ObsPlugins | null>(null);
  useEffect(() => {
    client?.obsPlugins().then(setInfo).catch(() => setInfo(null));
  }, [client]);
  const third = info?.plugins.filter((p) => p.thirdParty) ?? [];
  const bundled = info?.plugins.filter((p) => !p.thirdParty) ?? [];
  const disabled = new Set(value.disabledPlugins.map((n) => n.toLowerCase()));
  const toggle = (name: string, on: boolean) => {
    const rest = value.disabledPlugins.filter((n) => n.toLowerCase() !== name.toLowerCase());
    onChange({ disabledPlugins: on ? rest : [...rest, name] });
  };
  const changed = saved && (saved.thirdPartyPlugins !== value.thirdPartyPlugins || saved.disabledPlugins.join("|") !== value.disabledPlugins.join("|"));
  const folder = info?.folders[0];
  return (
    <Section
      title={a.plugins}
      description={a.pluginsDesc}
      actions={
        isTauri() && folder ? (
          <Button size="sm" variant="outline" className="h-7" onClick={() => revealPath(folder)}>
            <FolderOpen className="size-3.5" />
            {a.openFolder}
          </Button>
        ) : null
      }
    >
      <SwitchRow id="adv-plugins" label={a.thirdParty} checked={value.thirdPartyPlugins} onChange={(x) => onChange({ thirdPartyPlugins: x })} hint={a.thirdPartyHint} />
      {info && (
        <div className="grid gap-2 sm:ml-[15rem]">
          {third.length === 0 ? (
            <p className="text-xs text-muted-foreground">{a.noPlugins}</p>
          ) : (
            <ul className="divide-y rounded-md border text-sm">
              {third.map((p) => {
                const on = !disabled.has(p.name.toLowerCase());
                return (
                  <li key={p.path} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{p.name}</span>
                        <Badge variant={p.state === "failed" ? "destructive" : p.state === "loaded" ? "secondary" : "outline"}>{a.pluginStates[p.state]}</Badge>
                      </div>
                      <p className="truncate text-xs text-muted-foreground" title={p.path}>
                        {p.error ?? p.path}
                      </p>
                    </div>
                    <Switch checked={on} disabled={!value.thirdPartyPlugins || p.state === "duplicate"} onCheckedChange={(x) => toggle(p.name, x)} aria-label={a.pluginEnabled} />
                  </li>
                );
              })}
            </ul>
          )}
          {info.folders[1] && <p className="text-xs text-muted-foreground">{fmt(a.foldersHint, { folder: info.folders[1] })}</p>}
          {changed && <p className="text-xs font-medium text-amber-500">{a.restartNeeded}</p>}
          {bundled.length > 0 && (
            <div className="grid gap-1 pt-2">
              <p className="text-xs font-medium">{a.bundledFailed}</p>
              {bundled.map((p) => (
                <p key={p.path} className="text-xs text-muted-foreground">
                  {p.name}: {p.error}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
