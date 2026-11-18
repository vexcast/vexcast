import type { VexcastClient } from "@vexcast/protocol";
import { Gauge, Keyboard, Monitor, Radio, Settings, SlidersHorizontal, Volume2, Wrench } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useT } from "@/i18n";
import { type SettingsTab, useDialogs } from "@/lib/dialogs";
import { usePrefs } from "@/lib/prefs";
import { act, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { AdvancedTab } from "./advanced-tab";
import { AudioTab } from "./audio-tab";
import { GeneralTab } from "./general-tab";
import { HotkeysTab } from "./hotkeys-tab";
import { OutputTab } from "./output-tab";
import { SettingsContext, type SettingsDraft } from "./settings-context";
import { DestinationsView } from "@/components/pages/pages";
import { VideoTab } from "./video-tab";

const TABS: { id: SettingsTab; icon: typeof Settings }[] = [
  { id: "general", icon: Settings },
  { id: "stream", icon: Radio },
  { id: "output", icon: Gauge },
  { id: "audio", icon: Volume2 },
  { id: "video", icon: Monitor },
  { id: "hotkeys", icon: Keyboard },
  { id: "advanced", icon: Wrench },
];

function snapshot(): SettingsDraft {
  const s = useStore.getState().state!;
  const p = usePrefs.getState();
  return structuredClone({
    video: s.video,
    audio: s.audio,
    output: s.output,
    advanced: s.advanced,
    general: s.general,
    prefs: {
      confirmStreamStart: p.confirmStreamStart,
      confirmStreamStop: p.confirmStreamStop,
      confirmRecordStop: p.confirmRecordStop,
      studioDoubleClick: p.studioDoubleClick,
      studioQuickTransitions: p.studioQuickTransitions,
      studioSwap: p.studioSwap,
      snapping: p.snapping,
      preflight: p.preflight,
    },
    hotkeys: {},
  });
}

/** Changed top-level keys of a section. */
function diff<T extends object>(a: T, b: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(b) as (keyof T)[]) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out[k] = b[k];
  return out;
}

export function SettingsDialog() {
  const t = useT();
  const tab = useDialogs((d) => d.settings);
  const openTab = useDialogs((d) => d.open);
  const close = useDialogs((d) => d.close);
  const isOpen = tab != null;
  const [orig, setOrig] = useState<SettingsDraft | null>(null);
  const [draft, setDraft] = useState<SettingsDraft | null>(null);

  useEffect(() => {
    if (isOpen) {
      const s = snapshot();
      setOrig(s);
      setDraft(structuredClone(s));
    } else {
      setOrig(null);
      setDraft(null);
    }
  }, [isOpen]);

  const changes = useMemo(() => {
    if (!orig || !draft) return null;
    return {
      video: diff(orig.video, draft.video),
      audio: diff(orig.audio, draft.audio),
      output: diff(orig.output, draft.output),
      advanced: diff(orig.advanced, draft.advanced),
      general: diff(orig.general, draft.general),
      prefs: diff(orig.prefs, draft.prefs),
      hotkeys: draft.hotkeys,
    };
  }, [orig, draft]);
  const dirty = !!changes && (Object.values(changes).some((c) => Object.keys(c).length > 0));

  const apply = async () => {
    if (!changes || !draft) return true;
    const ok: boolean[] = [];
    const run = async (fn: (c: VexcastClient) => Promise<unknown>) => ok.push((await act((c) => fn(c).then(() => true))) === true);
    if (Object.keys(changes.video).length) await run((c) => c.setVideo(changes.video));
    if (Object.keys(changes.audio).length) await run((c) => c.setAudio(changes.audio));
    if (Object.keys(changes.output).length) await run((c) => c.setOutput(changes.output));
    if (Object.keys(changes.advanced).length) await run((c) => c.setAdvanced(changes.advanced));
    if (Object.keys(changes.general).length) await run((c) => c.setGeneral(changes.general));
    for (const [id, b] of Object.entries(changes.hotkeys)) await run((c) => c.setHotkey(Number(id), b));
    if (Object.keys(changes.prefs).length) usePrefs.getState().set(changes.prefs);
    const success = ok.every(Boolean);
    if (success) {
      const next = { ...structuredClone(draft), hotkeys: {} };
      setOrig(next);
      setDraft(structuredClone(next));
      if (ok.length) toast.success(t.settings.applied);
    }
    return success;
  };

  const ctx = draft
    ? {
        draft,
        set: <K extends Exclude<keyof SettingsDraft, "hotkeys">>(key: K, patch: Partial<SettingsDraft[K]>) => setDraft((d) => (d ? { ...d, [key]: { ...d[key], ...patch } } : d)),
        setHotkey: (id: number, bindings: SettingsDraft["hotkeys"][number]) => setDraft((d) => (d ? { ...d, hotkeys: { ...d.hotkeys, [id]: bindings } } : d)),
      }
    : null;

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && close("settings")}>
      <DialogContent className="flex h-[88vh] max-h-[860px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1100px,94vw)]" data-testid="settings-dialog">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>{t.settings.title}</DialogTitle>
          <DialogDescription className="sr-only">{t.settings.title}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1">
          <nav className="flex w-52 shrink-0 flex-col gap-0.5 border-r bg-muted/30 p-2">
            {TABS.map(({ id, icon: Icon }) => (
              <button
                key={id}
                onClick={() => openTab("settings", id)}
                data-testid={`settings-tab-${id}`}
                className={cn(
                  "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                  tab === id && "bg-accent font-medium text-accent-foreground",
                )}
              >
                <Icon className="size-4" />
                {t.settings.tabs[id]}
              </button>
            ))}
          </nav>
          {/* Radix renders the viewport content as a table, which lets wide rows grow the page sideways. */}
          <ScrollArea className="min-w-0 flex-1">
            <div className="min-w-0 px-8 py-6">
              {ctx && (
                <SettingsContext.Provider value={ctx}>
                  {tab === "general" && <GeneralTab />}
                  {tab === "stream" && <DestinationsView />}
                  {tab === "output" && <OutputTab />}
                  {tab === "audio" && <AudioTab />}
                  {tab === "video" && <VideoTab />}
                  {tab === "hotkeys" && <HotkeysTab />}
                  {tab === "advanced" && <AdvancedTab />}
                </SettingsContext.Provider>
              )}
            </div>
          </ScrollArea>
        </div>
        <DialogFooter className="items-center border-t px-6 py-3">
          {dirty && (
            <span className="mr-auto flex items-center gap-2 text-xs text-muted-foreground">
              <SlidersHorizontal className="size-3.5" />
              {t.settings.unsaved}
            </span>
          )}
          <Button variant="outline" onClick={() => close("settings")}>
            {t.common.cancel}
          </Button>
          <Button variant="outline" disabled={!dirty} onClick={apply} data-testid="settings-apply">
            {t.settings.apply}
          </Button>
          <Button
            onClick={async () => {
              if (await apply()) close("settings");
            }}
            data-testid="settings-ok"
          >
            {t.ok}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
