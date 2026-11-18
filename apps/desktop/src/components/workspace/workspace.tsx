/**
 * Studio workspace: every panel is a dockview panel that can be re-docked
 * (split/tab), resized, maximized, floated, closed and reopened. Layouts are
 * persisted in the core (general.uiPrefs) and can be saved/restored by name.
 */
import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type DockviewTheme, type IDockviewHeaderActionsProps, type IDockviewPanelProps } from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import { Maximize2, Minimize2, PictureInPicture2, SquareArrowOutDownLeft } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ControlsDock, DestinationsList } from "@/components/docks/controls-dock";
import { InWorkspace } from "@/components/docks/dock";
import { MixerDock } from "@/components/docks/mixer-dock";
import { ScenesDock } from "@/components/docks/scenes-dock";
import { SourcesDock } from "@/components/docks/sources-dock";
import { StatsView } from "@/components/docks/stats-dock";
import { TransitionsDock } from "@/components/docks/transitions-dock";
import { ChatDock, EventsDock } from "@/components/extras/chat";
import { KickChatPanel, TwitchChatPanel } from "@/components/extras/native-chat";
import { PreviewPanel, ProgramPanel, VerticalPreviewPanel } from "@/components/preview/preview-area";
import { MacrosDock } from "@/components/docks/macros-dock";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getT, useT } from "@/i18n";
import { promptDialog } from "@/lib/dialogs";
import { fmt } from "@/lib/format";
import { DOCK_IDS, type DockId, type LayoutPreset, setDockHandlers, usePrefs } from "@/lib/prefs";
import { act, useStore } from "@/lib/store";
import { FilterPanel, SourcePropertiesPanel } from "./source-panels";
import { useFileDrop } from "./file-drop";

// ------------------------------------------------------------------ panels

const wrap = (C: () => React.ReactElement) =>
  function Panel(_: IDockviewPanelProps) {
    return (
      <InWorkspace.Provider value>
        <div className="h-full min-h-0 min-w-0 overflow-hidden bg-background">
          <C />
        </div>
      </InWorkspace.Provider>
    );
  };

function StatsPanel() {
  return (
    <ScrollArea className="h-full">
      <StatsView />
    </ScrollArea>
  );
}

function DestinationsPanel() {
  return (
    <ScrollArea className="h-full">
      <div className="p-3">
        <DestinationsList />
      </div>
    </ScrollArea>
  );
}

const PANELS: Record<DockId, { el: () => React.ReactElement; minW: number; minH: number }> = {
  preview: { el: PreviewPanel, minW: 240, minH: 160 },
  program: { el: ProgramPanel, minW: 240, minH: 160 },
  previewVertical: { el: VerticalPreviewPanel, minW: 140, minH: 200 },
  scenes: { el: ScenesDock, minW: 120, minH: 120 },
  sources: { el: SourcesDock, minW: 150, minH: 120 },
  mixer: { el: MixerDock, minW: 180, minH: 120 },
  transitions: { el: TransitionsDock, minW: 140, minH: 110 },
  controls: { el: ControlsDock, minW: 130, minH: 140 },
  stats: { el: StatsPanel, minW: 260, minH: 120 },
  chat: { el: ChatDock, minW: 200, minH: 160 },
  chatTwitch: { el: TwitchChatPanel, minW: 240, minH: 200 },
  chatKick: { el: KickChatPanel, minW: 240, minH: 200 },
  events: { el: EventsDock, minW: 220, minH: 120 },
  properties: { el: SourcePropertiesPanel, minW: 260, minH: 160 },
  filters: { el: FilterPanel, minW: 320, minH: 180 },
  destinations: { el: DestinationsPanel, minW: 240, minH: 120 },
  macros: { el: MacrosDock, minW: 150, minH: 100 },
};

const components = Object.fromEntries(DOCK_IDS.map((id) => [id, wrap(PANELS[id].el)])) as Record<string, React.FunctionComponent<IDockviewPanelProps>>;

const THEME: DockviewTheme = { name: "vexcast", className: "dockview-theme-vexcast", gap: 0, dndOverlayMounting: "absolute", dndPanelOverlay: "group" };

// ------------------------------------------------------------------ module api (menus, palette)

let dock: DockviewApi | null = null;
/** Action requested while the workspace was not mounted (e.g. a preset from another page). */
let pending: (() => void) | null = null;
/** True while a preset/restore is being built, or the workspace is unmounting (not a user change). */
let building = false;

const title = (id: DockId) => getT().docks[id];

function addPanel(api: DockviewApi, id: DockId, position?: { referencePanel: string; direction: "left" | "right" | "above" | "below" | "within" }, size?: { w?: number; h?: number }) {
  if (api.getPanel(id)) return api.getPanel(id)!;
  const p = PANELS[id];
  return api.addPanel({
    id,
    component: id,
    title: title(id),
    minimumWidth: p.minW,
    minimumHeight: p.minH,
    ...(position ? { position } : {}),
    ...(size?.w ? { initialWidth: size.w } : {}),
    ...(size?.h ? { initialHeight: size.h } : {}),
    inactive: position?.direction === "within",
  });
}

type LayoutJson = {
  grid?: { root?: unknown };
  panels?: Record<string, unknown>;
  floatingGroups?: { data?: { views?: string[]; activeView?: string } }[];
  popoutGroups?: { data?: { views?: string[]; activeView?: string } }[];
  [k: string]: unknown;
};

/** Repair a saved layout: a panel shown twice (docked and floating) or listed but placed
 *  nowhere makes dockview show duplicates or fail. Docked copies win. */
export function sanitizeLayout(input: unknown): unknown {
  const json = structuredClone(input) as LayoutJson;
  if (!json || typeof json !== "object") return input;
  const seen = new Set<string>();
  const walk = (node: unknown) => {
    const n = node as { type?: string; data?: unknown };
    if (!n || typeof n !== "object") return;
    if (n.type === "leaf") {
      const d = n.data as { views?: string[]; activeView?: string };
      d.views = (d.views ?? []).filter((v) => !seen.has(v) && seen.add(v));
      if (d.activeView && !d.views.includes(d.activeView)) d.activeView = d.views[0];
    } else if (Array.isArray(n.data)) n.data.forEach(walk);
  };
  walk(json.grid?.root);
  for (const key of ["floatingGroups", "popoutGroups"] as const) {
    const groups = json[key];
    if (!Array.isArray(groups)) continue;
    json[key] = groups.filter((g) => {
      const d = g.data ?? {};
      d.views = (d.views ?? []).filter((v) => !seen.has(v) && seen.add(v));
      if (d.activeView && !d.views.includes(d.activeView)) d.activeView = d.views[0];
      return d.views.length > 0;
    });
  }
  if (json.panels) for (const id of Object.keys(json.panels)) if (!seen.has(id)) delete json.panels[id];
  return json;
}

/** Saved layouts carry the minimum sizes they were created with: apply today's (smaller) ones
 *  so the docks fit narrow windows, then refit to the real size. */
function applyConstraints(api: DockviewApi, el?: HTMLElement | null) {
  for (const g of api.groups) {
    const ids = g.panels.map((p) => p.id).filter((id): id is DockId => id in PANELS);
    if (!ids.length) continue;
    g.api.setConstraints({
      minimumWidth: Math.max(...ids.map((id) => PANELS[id].minW)),
      minimumHeight: Math.max(...ids.map((id) => PANELS[id].minH)),
    });
  }
  if (el && el.clientWidth > 0 && el.clientHeight > 0) api.layout(el.clientWidth, el.clientHeight, true);
}

/** Rebuild the workspace as one of the built-in layouts. */
export function applyPreset(preset: LayoutPreset) {
  const api = dock;
  if (!api) {
    pending = () => applyPreset(preset);
    return;
  }
  building = true;
  try {
    api.clear();
    const W = api.width || 1400;
    const H = api.height || 800;
    const bottom = Math.round(H * 0.36);
    const row = (ids: DockId[], first: DockId, ref: string, dir: "below" | "right") => {
      addPanel(api, first, { referencePanel: ref, direction: dir }, dir === "below" ? { h: bottom } : undefined);
      let prev: string = first;
      for (const id of ids) {
        addPanel(api, id, { referencePanel: prev, direction: "right" });
        prev = id;
      }
    };
    if (preset === "classic") {
      addPanel(api, "preview");
      row(["sources", "mixer", "transitions", "controls"], "scenes", "preview", "below");
    } else if (preset === "streamlabs") {
      addPanel(api, "preview");
      addPanel(api, "chat", { referencePanel: "preview", direction: "right" }, { w: Math.round(W * 0.24) });
      addPanel(api, "controls", { referencePanel: "chat", direction: "below" }, { h: Math.round(H * 0.3) });
      row(["sources", "mixer"], "scenes", "preview", "below");
    } else if (preset === "compact") {
      addPanel(api, "preview");
      addPanel(api, "scenes", { referencePanel: "preview", direction: "below" }, { h: bottom });
      for (const id of ["sources", "mixer", "transitions", "controls"] as DockId[]) addPanel(api, id, { referencePanel: "scenes", direction: "within" });
      api.getPanel("scenes")?.api.setActive();
    } else if (preset === "dual") {
      addPanel(api, "preview");
      row(["sources", "mixer", "controls"], "scenes", "preview", "below");
      addPanel(api, "previewVertical", { referencePanel: "preview", direction: "right" }, { w: Math.round(W * 0.26) });
    } else if (preset === "production") {
      addPanel(api, "preview");
      row(["sources", "mixer", "transitions", "controls"], "scenes", "preview", "below");
      addPanel(api, "program", { referencePanel: "preview", direction: "right" }, { w: Math.round(W / 2) });
      addPanel(api, "stats", { referencePanel: "mixer", direction: "within" });
      api.getPanel("mixer")?.api.setActive();
      if (!useStore.getState().state?.status.studioMode) act((c) => c.setStudioMode(true));
    }
  } finally {
    building = false;
  }
  usePrefs.getState().set({ layoutCustomized: preset !== "compact" ? false : usePrefs.getState().layoutCustomized });
  persistLayout(true);
}

export async function saveCurrentLayout() {
  if (!dock) return;
  const t = getT();
  const name = await promptDialog({ title: t.workspace.saveTitle, label: t.workspace.saveName, defaultValue: "" });
  if (!name?.trim()) return;
  const p = usePrefs.getState();
  p.set({ savedLayouts: { ...p.savedLayouts, [name.trim()]: dock.toJSON() } });
  toast.success(fmt(t.workspace.saved, { name: name.trim() }));
}

export function loadSavedLayout(name: string) {
  const json = usePrefs.getState().savedLayouts[name];
  if (!json) return;
  if (!dock) {
    pending = () => loadSavedLayout(name);
    return;
  }
  building = true;
  try {
    dock.fromJSON(sanitizeLayout(json) as Parameters<DockviewApi["fromJSON"]>[0]);
    applyConstraints(dock);
    retitle(dock);
  } catch {
    applyPreset("classic");
  } finally {
    building = false;
  }
  persistLayout(true);
}

export function deleteSavedLayout(name: string) {
  const p = usePrefs.getState();
  const next = { ...p.savedLayouts };
  delete next[name];
  p.set({ savedLayouts: next });
}

function togglePanel(id: DockId) {
  const api = dock;
  if (!api) return;
  const existing = api.getPanel(id);
  if (existing) {
    api.removePanel(existing);
    return;
  }
  // Re-open next to a sensible neighbour.
  const near: Record<DockId, DockId[]> = {
    preview: ["program", "previewVertical", "scenes"],
    program: ["preview"],
    previewVertical: ["preview", "program"],
    scenes: ["sources", "mixer"],
    sources: ["scenes", "mixer"],
    mixer: ["sources", "controls"],
    transitions: ["controls", "mixer"],
    controls: ["transitions", "mixer"],
    stats: ["mixer", "controls"],
    chat: ["controls", "mixer"],
    chatTwitch: ["chat", "chatKick", "controls"],
    chatKick: ["chat", "chatTwitch", "controls"],
    events: ["chat", "controls"],
    properties: ["sources", "scenes"],
    filters: ["properties", "sources"],
    destinations: ["controls", "stats"],
    macros: ["controls", "transitions"],
  };
  const ref = near[id].find((r) => api.getPanel(r));
  const side: "right" | "within" | "below" = id === "program" || id === "previewVertical" || id === "properties" ? "right" : id === "preview" ? "right" : "within";
  if (ref) addPanel(api, id, { referencePanel: ref, direction: side });
  else addPanel(api, id);
  api.getPanel(id)?.api.setActive();
  usePrefs.getState().set({ layoutCustomized: true });
}

function retitle(api: DockviewApi) {
  for (const p of api.panels) if ((DOCK_IDS as string[]).includes(p.id)) p.api.setTitle(title(p.id as DockId));
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
/** Save the layout and the open-panel flags (debounced). */
function persistLayout(now = false) {
  if (persistTimer) clearTimeout(persistTimer);
  const run = () => {
    if (!dock || building || dock.panels.length === 0) return;
    const docks = Object.fromEntries(DOCK_IDS.map((id) => [id, !!dock!.getPanel(id)])) as Record<DockId, boolean>;
    usePrefs.getState().set({ dockLayout: dock.toJSON(), docks });
  };
  if (now) run();
  else persistTimer = setTimeout(run, 500);
}

// ------------------------------------------------------------------ header actions (float / maximize / close)

function HeaderActions(props: IDockviewHeaderActionsProps) {
  const t = useT();
  const locked = usePrefs((p) => p.layoutLocked);
  // Narrow docks: leave the room to the title (float/maximize stay in the tab's context menu and View menu).
  const [width, setWidth] = useState(() => props.group.api.width);
  useEffect(() => {
    const d = props.group.api.onDidDimensionsChange((e) => setWidth(e.width));
    return () => d.dispose();
  }, [props.group]);
  const panel = props.activePanel;
  if (!panel || (width > 0 && width < 200)) return null;
  const floating = props.group.api.location.type === "floating";
  const maximized = props.containerApi.hasMaximizedGroup() && props.group.api.isMaximized();
  const btn = (icon: React.ReactNode, label: string, onClick: () => void, testId?: string) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="size-6 text-muted-foreground hover:text-foreground" aria-label={label} onClick={onClick} data-testid={testId}>
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
  return (
    <div className="flex h-full items-center gap-0.5 px-1">
      {!locked &&
        (floating
          ? btn(<SquareArrowOutDownLeft className="size-3.5" />, t.workspace.dock, () => {
              props.group.api.moveTo({ position: "right" });
            })
          : btn(<PictureInPicture2 className="size-3.5" />, t.workspace.float, () => props.containerApi.addFloatingGroup(panel, { width: 420, height: 320 }), `float-${panel.id}`))}
      {!floating &&
        btn(
          maximized ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />,
          maximized ? t.workspace.restore : t.workspace.maximize,
          () => (maximized ? props.containerApi.exitMaximizedGroup() : props.containerApi.maximizeGroup(panel)),
          `max-${panel.id}`,
        )}
    </div>
  );
}

function Watermark() {
  const t = useT();
  return <div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">{t.workspace.empty}</div>;
}

// ------------------------------------------------------------------ component

export function Workspace() {
  const locked = usePrefs((p) => p.layoutLocked);
  const lang = useStore((s) => s.state?.general.language);
  const studio = useStore((s) => s.state?.status.studioMode ?? false);
  const ref = useRef<HTMLDivElement>(null);
  const drop = useFileDrop();

  useEffect(() => {
    if (dock) retitle(dock);
  }, [lang]);

  // Studio mode needs a Program panel; remove it again when leaving studio mode.
  useEffect(() => {
    const api = dock;
    if (!api) return;
    if (studio && !api.getPanel("program")) addPanel(api, "program", api.getPanel("preview") ? { referencePanel: "preview", direction: "right" } : undefined);
    if (!studio && api.getPanel("program") && !building) api.removePanel(api.getPanel("program")!);
  }, [studio]);

  const apiRef = useRef<DockviewApi | null>(null);
  useLayoutEffect(() => {
    // (Re)attach — React StrictMode mounts effects twice without re-running onReady.
    if (apiRef.current) {
      dock = apiRef.current;
      building = false;
      setDockHandlers(togglePanel, () => applyPreset("classic"));
    }
    return () => {
      // Unmounting (page change): don't record the teardown as a user edit.
      building = true;
      setDockHandlers(null, null);
      if (persistTimer) clearTimeout(persistTimer);
      dock = null;
    };
  }, []);

  const onReady = (e: DockviewReadyEvent) => {
    dock = e.api;
    apiRef.current = e.api;
    const prefs = usePrefs.getState();
    building = true;
    let restored = false;
    if (prefs.dockLayout) {
      try {
        e.api.fromJSON(sanitizeLayout(prefs.dockLayout) as Parameters<DockviewApi["fromJSON"]>[0]);
        retitle(e.api);
        applyConstraints(e.api, ref.current);
        restored = e.api.panels.length > 0;
      } catch {
        restored = false;
      }
    }
    building = false;
    if (!restored) applyPreset((ref.current?.clientWidth ?? 1400) < 1100 ? "compact" : "classic");
    if (useStore.getState().state?.status.studioMode && !e.api.getPanel("program")) addPanel(e.api, "program", { referencePanel: "preview", direction: "right" });
    setDockHandlers(togglePanel, () => applyPreset("classic"));
    e.api.onDidLayoutChange(() => {
      if (building) return;
      persistLayout();
    });
    e.api.onDidRemovePanel(() => !building && usePrefs.getState().set({ layoutCustomized: true }));
    e.api.onDidMovePanel?.(() => !building && usePrefs.getState().set({ layoutCustomized: true }));
    if (pending) {
      const run = pending;
      pending = null;
      run();
    }
  };

  // Small windows: switch to the compact layout unless the user customized it.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let compactApplied = false;
    const ro = new ResizeObserver(() => {
      const p = usePrefs.getState();
      if (p.layoutCustomized || !dock) return;
      const narrow = el.clientWidth < 1100;
      if (narrow && !compactApplied) {
        compactApplied = true;
        applyPreset("compact");
      } else if (!narrow && compactApplied) {
        compactApplied = false;
        applyPreset("classic");
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} className="relative h-full min-h-0 w-full" data-testid="workspace" {...drop.handlers}>
      <DockviewReact
        className="h-full"
        theme={THEME}
        components={components}
        onReady={onReady}
        rightHeaderActionsComponent={HeaderActions}
        watermarkComponent={Watermark}
        disableDnd={locked}
        locked={locked}
      />
      {drop.overlay}
    </div>
  );
}
