import { RestartDialog } from "@/components/dialogs/restart-dialog";
import { PostStreamDialog } from "@/components/dialogs/post-stream-dialog";
import { SystemChecksBanner } from "@/components/layout/system-checks-banner";
import { ReportsPage } from "@/components/pages/reports-page";
import { PreflightDialog } from "@/components/dialogs/preflight-dialog";
import { Loader2, PlugZap, RefreshCw } from "lucide-react";
import { useCallback, useEffect } from "react";
import { AddSourceDialog } from "@/components/dialogs/add-source-dialog";
import { AdvancedAudioDialog } from "@/components/dialogs/advanced-audio-dialog";
import { FiltersDialog } from "@/components/dialogs/filters-dialog";
import { ImportObsDialog } from "@/components/dialogs/import-obs-dialog";
import { InteractDialog } from "@/components/dialogs/interact-dialog";
import { ConfirmHost, PromptHost } from "@/components/dialogs/prompt-host";
import { TransformDialog } from "@/components/dialogs/transform-dialog";
import { AboutDialog, ReleaseNotesDialog } from "@/components/layout/Banners";
import { PhoneCamAlert } from "@/components/layout/phone-cam-alert";
import { StreamInfoDialog } from "@/components/accounts/stream-info-dialog";
import { NavRail } from "@/components/layout/nav-rail";
import { AiPage, AlertsPage, BotPage, ChatPage, DestinationsPage, RemotePage } from "@/components/pages/pages";
import { MenuBar } from "@/components/layout/menu-bar";
import { StatusBar } from "@/components/layout/status-bar";
import { Workspace } from "@/components/workspace/workspace";
import { CommandPalette } from "@/components/command-palette";
import { FirstRunWizard } from "@/components/wizard/first-run-wizard";
import { usePreviewKeys } from "@/components/preview/preview-editor";
import { PropertiesDialog } from "@/components/properties/properties-dialog";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useT } from "@/i18n";
import { copySource, duplicateItems, nudgeSelection, orderItems, pasteSource, removeItems, selectedItems, transformItems } from "@/lib/actions";
import { openDialog } from "@/lib/dialogs";
import { installUndoShortcuts } from "@/lib/history";
import { usePrefs } from "@/lib/prefs";
import { act, editingSceneUuid, useStore } from "@/lib/store";
import { VexcastMark } from "@/lib/platforms";
import { toggleFullscreen } from "@/lib/tauri";

function useTheme() {
  const theme = useStore((s) => s.state?.general.theme ?? "dark");
  const lang = useStore((s) => s.state?.general.language ?? "es");
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      root.classList.toggle("dark", dark);
      root.style.colorScheme = dark ? "dark" : "light";
    };
    apply();
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
}

/** Global shortcuts (OBS-like). */
function useShortcuts() {
  const onKey = useCallback((e: KeyboardEvent) => {
    const st = useStore.getState().state;
    if (!st) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const sel = selectedItems();
    const step = e.shiftKey ? 10 : 1;
    if (!ctrl && e.key.startsWith("Arrow") && sel.length) {
      e.preventDefault();
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key] as [number, number];
      nudgeSelection(d[0], d[1]);
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && sel.length && !ctrl) {
      e.preventDefault();
      removeItems(sel);
      return;
    }
    if (e.key === "F11") {
      e.preventDefault();
      toggleFullscreen();
      return;
    }
    if (!ctrl) return;
    const k = e.key.toLowerCase();
    if (k === "c" && sel[0]) return copySource(sel[0].sourceUuid);
    if (k === "v") return void pasteSource(e.shiftKey);
    if (k === "," ) {
      e.preventDefault();
      return openDialog("settings", "general");
    }
    if (sel.length) {
      const scene = editingSceneUuid(st);
      if (k === "d") {
        e.preventDefault();
        return duplicateItems(sel);
      }
      const tr = { r: "reset", f: "fit", s: "stretch" } as const;
      if (k in tr) {
        e.preventDefault();
        return transformItems(sel, tr[k as keyof typeof tr]);
      }
      if (k === "e" && scene) {
        e.preventDefault();
        return openDialog("transform", { scene, item: sel[0].id });
      }
      const ord = { ArrowUp: "up", ArrowDown: "down", Home: "top", End: "bottom" } as const;
      if (e.key in ord) {
        e.preventDefault();
        return orderItems(sel, ord[e.key as keyof typeof ord]);
      }
    }
    // Ctrl+1..9 = switch scene (or set preview in studio mode).
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= 9 && !e.shiftKey && !e.altKey) {
      const scene = st.scenes[n - 1];
      if (!scene) return;
      e.preventDefault();
      if (st.status.studioMode) act((c) => c.setPreviewScene(scene.uuid));
      else act((c) => c.setProgramScene(scene.uuid));
    }
  }, []);
  usePreviewKeys(onKey);
  useEffect(() => installUndoShortcuts(), []);
}

function BootScreen() {
  const t = useT();
  const bootError = useStore((s) => s.bootError);
  const client = useStore((s) => s.client);
  return (
    <div className="grid h-full place-items-center p-8">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <VexcastMark size={48} />
        {bootError ? (
          <>
            <div className="flex items-center gap-2 text-lg font-semibold">
              <PlugZap className="size-5 text-muted-foreground" /> {t.conn.bootTitle}
            </div>
            <p className="text-sm text-muted-foreground">{t.conn.bootDesc}</p>
            {client && <code className="selectable rounded-md bg-muted px-2 py-1 font-mono text-xs">{client.baseUrl}</code>}
            <Button onClick={() => location.reload()}>
              <RefreshCw /> {t.common.retry}
            </Button>
          </>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> {t.conn.connecting}
          </div>
        )}
      </div>
    </div>
  );
}

function StudioPage() {
  return <Workspace />;
}

const PAGE_VIEWS = { studio: StudioPage, chat: ChatPage, alerts: AlertsPage, bot: BotPage, ai: AiPage, destinations: DestinationsPage, remote: RemotePage, reports: ReportsPage };

function Shell() {
  const page = usePrefs((p) => p.page);
  useShortcuts();
  const Page = PAGE_VIEWS[page] ?? StudioPage;
  return (
    <div className="flex h-full flex-col">
      <MenuBar />
      <SystemChecksBanner />
      <div className="flex min-h-0 flex-1">
        <NavRail />
        <main className="min-w-0 flex-1 overflow-hidden">
          <Page />
        </main>
      </div>
      <StatusBar />
      <PhoneCamAlert />
    </div>
  );
}

export function App() {
  useTheme();
  const hasState = useStore((s) => !!s.state);
  return (
    <TooltipProvider delayDuration={300}>
      {hasState ? (
        <>
          <Shell />
          <PropertiesDialog />
          <FiltersDialog />
          <TransformDialog />
          <AdvancedAudioDialog />
          <AddSourceDialog />
          <SettingsDialog />
          <ImportObsDialog />
          <PreflightDialog />
      <RestartDialog />
          <InteractDialog />
          <AboutDialog />
          <ReleaseNotesDialog />
          <PostStreamDialog />
          <CommandPalette />
          <StreamInfoDialog />
          <FirstRunWizard />
          <PromptHost />
          <ConfirmHost />
        </>
      ) : (
        <BootScreen />
      )}
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
