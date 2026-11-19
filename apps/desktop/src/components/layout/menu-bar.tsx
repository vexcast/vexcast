import { Coffee } from "lucide-react";
import { MenuItems, type MenuNode, sep } from "@/components/menu";
import { useTransformNodes } from "@/components/source-menu";
import { Menubar, MenubarContent, MenubarMenu, MenubarTrigger } from "@/components/ui/menubar";
import { useT } from "@/i18n";
import {
  checkForUpdates,
  exportOverlay,
  copySource,
  duplicateCollection,
  exitVexcast,
  newCollection,
  pasteSource,
  removeCollection,
  renameCollection,
  selectedItems,
  showRecordings,
  toggleStudioMode,
} from "@/lib/actions";
import { openDialog } from "@/lib/dialogs";
import { fmt } from "@/lib/format";
import { redo, undo, useHistory } from "@/lib/history";
import { DOCK_IDS, goTo, type LayoutPreset, type PreviewQuality, type PreviewScaling, usePrefs } from "@/lib/prefs";
import { applyPreset, deleteSavedLayout, loadSavedLayout, saveCurrentLayout } from "@/components/workspace/workspace";

const PRESETS: LayoutPreset[] = ["classic", "streamlabs", "compact", "dual", "production"];
import { act, useAppState, useStore } from "@/lib/store";
import { GITHUB_URL, isTauri, KOFI_URL, openExternal, toggleFullscreen } from "@/lib/tauri";

function Menu({ label, nodes, testId }: { label: string; nodes: MenuNode[]; testId?: string }) {
  return (
    <MenubarMenu>
      <MenubarTrigger className="h-7 px-2.5 text-[13px] font-normal" data-testid={testId}>
        {label}
      </MenubarTrigger>
      <MenubarContent className="min-w-56">
        <MenuItems nodes={nodes} kind="menubar" />
      </MenubarContent>
    </MenubarMenu>
  );
}

export function MenuBar() {
  const t = useT();
  const prefs = usePrefs();
  const studio = useAppState((s) => s.status.studioMode);
  const video = useAppState((s) => s.video);
  const collections = useAppState((s) => s.sceneCollections);
  const current = useAppState((s) => s.sceneCollection);
  const clipboard = useStore((s) => s.clipboard);
  useStore((s) => s.selection);
  const sel = selectedItems();
  const transformNodes = useTransformNodes(sel);
  const lastUndo = useHistory((h) => h.undo[h.undo.length - 1]);
  const lastRedo = useHistory((h) => h.redo[h.redo.length - 1]);
  const historyBusy = useHistory((h) => h.busy);

  const file: MenuNode[] = [
    { type: "item", label: t.menu.showRecordings, onSelect: showRecordings },
    sep,
    { type: "item", label: t.menu.settings, onSelect: () => openDialog("settings", "general"), shortcut: "Ctrl+," },
    sep,
    { type: "item", label: t.menu.exit, onSelect: exitVexcast },
  ];

  const edit: MenuNode[] = [
    {
      type: "item",
      label: lastUndo ? fmt(t.history.undoLabel, { label: lastUndo.label }) : t.history.undo,
      disabled: !lastUndo || historyBusy,
      onSelect: () => void undo(),
      shortcut: "Ctrl+Z",
    },
    {
      type: "item",
      label: lastRedo ? fmt(t.history.redoLabel, { label: lastRedo.label }) : t.history.redo,
      disabled: !lastRedo || historyBusy,
      onSelect: () => void redo(),
      shortcut: "Ctrl+Y",
    },
    sep,
    { type: "item", label: t.menu.copySource, disabled: !sel[0], onSelect: () => sel[0] && copySource(sel[0].sourceUuid), shortcut: "Ctrl+C" },
    { type: "item", label: t.menu.pasteRef, disabled: !clipboard, onSelect: () => pasteSource(false), shortcut: "Ctrl+V" },
    { type: "item", label: t.menu.pasteDup, disabled: !clipboard, onSelect: () => pasteSource(true) },
    sep,
    { type: "sub", label: t.menu.transform, disabled: !sel.length, children: transformNodes },
    sep,
    { type: "check", label: t.menu.lockPreview, checked: prefs.previewLocked, onCheckedChange: (v) => prefs.set({ previewLocked: v }) },
    {
      type: "sub",
      label: t.menu.previewScaling,
      children: [
        {
          type: "radio",
          value: prefs.previewScaling,
          onValueChange: (v) => prefs.set({ previewScaling: v as PreviewScaling }),
          options: [
            { value: "window", label: t.menu.scaleWindow },
            { value: "canvas", label: fmt(t.menu.scaleCanvas, { w: video.baseWidth, h: video.baseHeight }) },
            { value: "output", label: fmt(t.menu.scaleOutput, { w: video.outputWidth, h: video.outputHeight }) },
          ],
        },
      ],
    },
    {
      type: "sub",
      label: t.preview.qualityTitle,
      children: [
        {
          type: "radio",
          value: prefs.previewQuality,
          onValueChange: (v) => prefs.set({ previewQuality: v as PreviewQuality }),
          options: [
            { value: "low", label: t.preview.qLow },
            { value: "medium", label: t.preview.qMedium },
            { value: "high", label: t.preview.qHigh },
            { value: "full", label: t.preview.qFull },
          ],
        },
      ],
    },
    {
      type: "sub",
      label: t.menu.snapping,
      children: [
        { type: "check", label: t.menu.snapEnable, checked: prefs.snapping, onCheckedChange: (v) => prefs.set({ snapping: v }) },
        sep,
        { type: "check", label: t.menu.snapEdges, checked: prefs.snapToEdges, disabled: !prefs.snapping, onCheckedChange: (v) => prefs.set({ snapToEdges: v }) },
        { type: "check", label: t.menu.snapItems, checked: prefs.snapToItems, disabled: !prefs.snapping, onCheckedChange: (v) => prefs.set({ snapToItems: v }) },
        { type: "check", label: t.menu.snapCenter, checked: prefs.snapToCenter, disabled: !prefs.snapping, onCheckedChange: (v) => prefs.set({ snapToCenter: v }) },
      ],
    },
  ];

  const view: MenuNode[] = [
    {
      type: "sub",
      label: t.menu.docks,
      children: [
        ...DOCK_IDS.map((id) => ({ type: "check", label: t.docks[id], checked: prefs.docks[id], onCheckedChange: () => (goTo("studio"), prefs.toggleDock(id)) }) as MenuNode),
        sep,
        { type: "item", label: t.menu.resetDocks, onSelect: prefs.resetDocks },
      ],
    },
    {
      type: "sub",
      label: t.workspace.layout,
      children: [
        ...PRESETS.map((id) => ({ type: "item", label: t.workspace.presets[id], onSelect: () => (goTo("studio"), applyPreset(id)) }) as MenuNode),
        ...(Object.keys(prefs.savedLayouts).length
          ? [
              sep,
              ...Object.keys(prefs.savedLayouts).map(
                (name) =>
                  ({
                    type: "sub",
                    label: name,
                    children: [
                      { type: "item", label: t.common.open, onSelect: () => (goTo("studio"), loadSavedLayout(name)) },
                      { type: "item", label: t.workspace.deleteSaved, destructive: true, onSelect: () => deleteSavedLayout(name) },
                    ],
                  }) as MenuNode,
              ),
            ]
          : []),
        sep,
        { type: "item", label: t.workspace.save, onSelect: saveCurrentLayout },
        { type: "item", label: t.workspace.reset, onSelect: prefs.resetDocks },
        { type: "check", label: t.workspace.lock, checked: prefs.layoutLocked, onCheckedChange: (v) => prefs.set({ layoutLocked: v }) },
      ],
    },
    { type: "check", label: t.menu.stats, checked: prefs.docks.stats, onCheckedChange: () => prefs.toggleDock("stats") },
    { type: "check", label: t.menu.mixerVertical, checked: prefs.mixerVertical, onCheckedChange: (v) => prefs.set({ mixerVertical: v }) },
    sep,
    { type: "check", label: t.menu.enablePreview, checked: prefs.previewEnabled, onCheckedChange: (v) => prefs.set({ previewEnabled: v }) },
    { type: "check", label: t.menu.studioMode, checked: studio, onCheckedChange: () => toggleStudioMode() },
    sep,
    { type: "item", label: t.menu.fullscreen, onSelect: () => toggleFullscreen(), shortcut: "F11" },
  ];

  const collection: MenuNode[] = [
    { type: "item", label: t.menu.newCollection, onSelect: newCollection },
    { type: "item", label: t.menu.duplicateCollection, onSelect: duplicateCollection },
    { type: "item", label: t.menu.renameCollection, onSelect: renameCollection },
    { type: "item", label: t.menu.removeCollection, disabled: collections.length <= 1, onSelect: removeCollection },
    sep,
    {
      type: "radio",
      value: current,
      options: collections.map((c) => ({ value: c.name, label: c.name })),
      onValueChange: (v) => v !== current && act((c) => c.switchSceneCollection(v), fmt(t.collection.switched, { name: v })),
    },
    sep,
    { type: "item", label: t.menu.importObs, onSelect: () => openDialog("importObs", true) },
    { type: "item", label: t.menu.exportOverlay, disabled: !isTauri(), onSelect: () => void exportOverlay() },
  ];

  const tools: MenuNode[] = [
    { type: "item", label: t.menu.chat, onSelect: () => goTo("chat") },
    { type: "item", label: t.menu.alerts, onSelect: () => goTo("alerts") },
    { type: "item", label: t.menu.bot, onSelect: () => goTo("bot") },
    { type: "item", label: t.menu.ai, onSelect: () => goTo("ai") },
    sep,
    { type: "item", label: t.menu.remote, onSelect: () => goTo("remote") },
    { type: "item", label: t.menu.multistream, onSelect: () => goTo("destinations") },
    sep,
    { type: "item", label: t.menu.palette, onSelect: () => openDialog("palette", true), shortcut: "Ctrl+K" },
    { type: "item", label: t.menu.wizard, onSelect: () => openDialog("wizard", true) },
  ];

  const help: MenuNode[] = [
    { type: "item", label: t.menu.checkUpdates, onSelect: checkForUpdates },
    { type: "item", label: t.menu.releaseNotes, onSelect: () => openDialog("releaseNotes", true) },
    { type: "item", label: t.menu.github, onSelect: () => openExternal(GITHUB_URL) },
    sep,
    { type: "item", label: t.menu.about, onSelect: () => openDialog("about", true) },
    sep,
    { type: "item", label: t.menu.kofi, icon: Coffee, onSelect: () => openExternal(KOFI_URL) },
  ];

  return (
    <Menubar className="h-9 shrink-0 rounded-none border-x-0 border-t-0 px-1.5 shadow-none">
      <Menu label={t.menu.file} nodes={file} testId="menu-file" />
      <Menu label={t.menu.edit} nodes={edit} testId="menu-edit" />
      <Menu label={t.menu.view} nodes={view} testId="menu-view" />
      <Menu label={t.menu.sceneCollection} nodes={collection} testId="menu-collection" />
      <Menu label={t.menu.tools} nodes={tools} testId="menu-tools" />
      <Menu label={t.menu.help} nodes={help} testId="menu-help" />
    </Menubar>
  );
}
