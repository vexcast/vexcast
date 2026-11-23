import {
  Bell,
  Bot,
  Check,
  Circle,
  Clapperboard,
  Columns2,
  HardDrive,
  History,
  Import,
  Info,
  Keyboard,
  type LucideIcon,
  MessagesSquare,
  Monitor,
  PanelsTopLeft,
  Radio,
  RefreshCw,
  Settings,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Volume2,
  WandSparkles,
  PenLine,
  Webcam,
  Wrench,
  ChartNoAxesCombined,
  Scissors,
} from "lucide-react";
import { useEffect } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { useT } from "@/i18n";
import {
  activateScene,
  checkForUpdates,
  toggleRecording,
  toggleReplayBuffer,
  createClip,
  toggleStreaming,
  toggleStudioMode,
  toggleVirtualCam,
} from "@/lib/actions";
import { useCatalogEntry } from "@/lib/catalog";
import { type SettingsTab, openDialog, useDialogs } from "@/lib/dialogs";
import { fmt } from "@/lib/format";
import { DOCK_IDS, type Page, PAGES, goTo, usePrefs } from "@/lib/prefs";
import { sourceIcon } from "@/lib/obs";
import { useAppState, useStore } from "@/lib/store";

const SETTINGS_TABS: { id: SettingsTab; icon: LucideIcon }[] = [
  { id: "general", icon: Settings },
  { id: "stream", icon: Radio },
  { id: "output", icon: HardDrive },
  { id: "audio", icon: Volume2 },
  { id: "video", icon: Monitor },
  { id: "hotkeys", icon: Keyboard },
  { id: "advanced", icon: Wrench },
];

const PAGE_ICONS: Record<Page, LucideIcon> = {
  reports: ChartNoAxesCombined,
  studio: Clapperboard,
  chat: MessagesSquare,
  alerts: Bell,
  bot: Bot,
  ai: Sparkles,
  destinations: Radio,
  remote: Smartphone,
};

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl+";

/** Global command palette (Ctrl+K / Cmd+K). */
export function CommandPalette() {
  const t = useT();
  const open = useDialogs((d) => d.palette);
  const connected = useStore((s) => !!s.state);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        !e.shiftKey &&
        e.key.toLowerCase() === "k"
      ) {
        e.preventDefault();
        const d = useDialogs.getState();
        if (d.palette) d.close("palette");
        else d.open("palette", true);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const setOpen = (v: boolean) =>
    v ? openDialog("palette", true) : useDialogs.getState().close("palette");

  return (
    <CommandDialog
      open={open && connected}
      onOpenChange={setOpen}
      title={t.palette.title}
      description={t.palette.description}
      className="sm:max-w-xl"
    >
      <CommandInput
        placeholder={t.palette.placeholder}
        data-testid="palette-input"
      />
      {open && connected && <PaletteItems />}
    </CommandDialog>
  );
}

/** Close the palette, then run the command (after the dialog released focus). */
function run(fn: () => unknown) {
  useDialogs.getState().close("palette");
  setTimeout(() => void fn(), 0);
}

function PaletteItems() {
  const t = useT();
  const scenes = useAppState((s) => s.scenes);
  const program = useAppState((s) => s.programSceneUuid);
  const preview = useAppState((s) => s.previewSceneUuid);
  const status = useAppState((s) => s.status);
  const docks = usePrefs((p) => p.docks);
  const sourceTypes = useCatalogEntry("sourceTypes");
  const inputs = (sourceTypes ?? []).filter(
    (st) => st.kind === "input" && !st.deprecated,
  );
  const current = status.studioMode ? preview : program;

  return (
    <CommandList className="max-h-[min(420px,60vh)]">
      <CommandEmpty>{t.palette.empty}</CommandEmpty>

      {scenes.length > 0 && (
        <CommandGroup heading={t.palette.scenes}>
          {scenes.map((s) => (
            <CommandItem
              key={s.uuid}
              value={fmt(
                status.studioMode ? t.palette.previewTo : t.palette.switchTo,
                { name: s.name },
              )}
              keywords={[t.palette.scenes]}
              onSelect={() => run(() => activateScene(s.uuid))}
            >
              <Clapperboard />
              <span className="truncate">
                {fmt(
                  status.studioMode ? t.palette.previewTo : t.palette.switchTo,
                  { name: s.name },
                )}
              </span>
              <CommandShortcut className="tracking-normal">
                {s.uuid === current ? t.palette.current : null}
              </CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
      )}

      {inputs.length > 0 && (
        <>
          <CommandSeparator />
          <CommandGroup heading={t.palette.addSource}>
            {inputs.map((st) => {
              const Icon = sourceIcon(st.icon);
              return (
                <CommandItem
                  key={st.id}
                  value={`${t.palette.addSource}: ${st.name}`}
                  keywords={[st.id]}
                  onSelect={() => run(() => openDialog("addSource", st.id))}
                >
                  <Icon />
                  <span className="truncate">{st.name}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        </>
      )}

      <CommandSeparator />
      <CommandGroup heading={t.palette.outputs}>
        <CommandItem
          value={
            status.streaming
              ? t.controls.stopStreaming
              : t.controls.startStreaming
          }
          keywords={["stream live"]}
          onSelect={() => run(toggleStreaming)}
        >
          <Radio className={status.streaming ? "text-red-500" : undefined} />
          {status.streaming
            ? t.controls.stopStreaming
            : t.controls.startStreaming}
        </CommandItem>
        <CommandItem
          value={
            status.recording
              ? t.controls.stopRecording
              : t.controls.startRecording
          }
          keywords={["rec"]}
          onSelect={() => run(toggleRecording)}
        >
          <Circle
            className={
              status.recording ? "fill-red-500 text-red-500" : undefined
            }
          />
          {status.recording
            ? t.controls.stopRecording
            : t.controls.startRecording}
        </CommandItem>
        <CommandItem
          value={
            status.replayBufferActive
              ? t.controls.stopReplay
              : t.controls.startReplay
          }
          keywords={["replay"]}
          onSelect={() => run(toggleReplayBuffer)}
        >
          <History />
          {status.replayBufferActive
            ? t.controls.stopReplay
            : t.controls.startReplay}
        </CommandItem>
        {status.streaming && (
          <CommandItem value={t.controls.createClip} keywords={["clip", "twitch"]} onSelect={() => run(createClip)}>
            <Scissors />
            {t.controls.createClip}
          </CommandItem>
        )}
        <CommandItem
          value={
            status.virtualCamActive
              ? t.controls.stopVirtualCam
              : t.controls.startVirtualCam
          }
          keywords={["virtual camera"]}
          onSelect={() => run(toggleVirtualCam)}
        >
          <Webcam />
          {status.virtualCamActive
            ? t.controls.stopVirtualCam
            : t.controls.startVirtualCam}
        </CommandItem>
        <CommandItem
          value={
            status.studioMode
              ? t.palette.disableStudioMode
              : t.palette.enableStudioMode
          }
          keywords={["studio"]}
          onSelect={() => run(toggleStudioMode)}
        >
          <Columns2 />
          {status.studioMode
            ? t.palette.disableStudioMode
            : t.palette.enableStudioMode}
        </CommandItem>
      </CommandGroup>

      <CommandSeparator />
      <CommandGroup heading={t.palette.docks}>
        {DOCK_IDS.map((id) => (
          <CommandItem
            key={id}
            value={fmt(t.palette.toggleDock, { name: t.docks[id] })}
            keywords={[t.palette.docks]}
            onSelect={() => run(() => usePrefs.getState().toggleDock(id))}
          >
            <PanelsTopLeft />
            {fmt(t.palette.toggleDock, { name: t.docks[id] })}
            {docks[id] && <Check className="ml-auto" />}
          </CommandItem>
        ))}
      </CommandGroup>

      <CommandSeparator />
      <CommandGroup heading={t.palette.goTo}>
        {PAGES.map((p) => {
          const Icon = PAGE_ICONS[p];
          return (
            <CommandItem
              key={p}
              value={`${t.palette.goTo}: ${t.nav[p]}`}
              onSelect={() => run(() => goTo(p))}
            >
              <Icon />
              {t.nav[p]}
            </CommandItem>
          );
        })}
      </CommandGroup>

      <CommandSeparator />
      <CommandGroup heading={t.palette.settings}>
        {SETTINGS_TABS.map(({ id, icon: Icon }) => (
          <CommandItem
            key={id}
            value={fmt(t.palette.settingsTab, { name: t.settings.tabs[id] })}
            onSelect={() => run(() => openDialog("settings", id))}
          >
            <Icon />
            {fmt(t.palette.settingsTab, { name: t.settings.tabs[id] })}
            {id === "general" && <CommandShortcut>{MOD},</CommandShortcut>}
          </CommandItem>
        ))}
      </CommandGroup>

      <CommandSeparator />
      <CommandGroup heading={t.palette.tools}>
        <CommandItem value={t.accounts.info.title} keywords={[t.accounts.info.open]} onSelect={() => run(() => openDialog("streamInfo", true))}>
          <PenLine />
          {t.accounts.info.open}
        </CommandItem>
        <CommandItem
          value={t.palette.wizard}
          onSelect={() => run(() => openDialog("wizard", true))}
        >
          <WandSparkles />
          {t.palette.wizard}
        </CommandItem>
        <CommandItem
          value={t.palette.importObs}
          onSelect={() => run(() => openDialog("importObs", true))}
        >
          <Import />
          {t.palette.importObs}
        </CommandItem>
        <CommandItem
          value={t.palette.advancedAudio}
          onSelect={() => run(() => openDialog("advancedAudio", true))}
        >
          <SlidersHorizontal />
          {t.palette.advancedAudio}
        </CommandItem>
        <CommandItem
          value={t.palette.checkUpdates}
          onSelect={() => run(checkForUpdates)}
        >
          <RefreshCw />
          {t.palette.checkUpdates}
        </CommandItem>
        <CommandItem
          value={t.palette.about}
          onSelect={() => run(() => openDialog("about", true))}
        >
          <Info />
          {t.palette.about}
        </CommandItem>
      </CommandGroup>
    </CommandList>
  );
}

/** Keyboard hint for opening the palette (for menus/tooltips). */
export const PALETTE_SHORTCUT = `${MOD}K`;
