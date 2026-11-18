import { EMPTY } from "@/lib/store";
import type { BlendMethod, BlendMode, SceneItem, ScaleFilter } from "@vexcast/protocol";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  Camera,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Eye,
  EyeOff,
  Filter,
  Group,
  MousePointerClick,
  Move,
  Pencil,
  Plus,
  Settings2,
  Trash2,
  Ungroup,
} from "lucide-react";
import { useT } from "@/i18n";
import {
  copySource,
  duplicateItems,
  groupSelected,
  orderItems,
  pasteSource,
  removeItems,
  renameSource,
  screenshotSource,
  transformItems,
  updateItem,
} from "@/lib/actions";
import { useCatalogEntry } from "@/lib/catalog";
import { openDialog, promptDialog } from "@/lib/dialogs";
import { sourceIcon } from "@/lib/obs";
import { act, findItem, useEditingScene, useStore } from "@/lib/store";
import type { MenuNode } from "./menu";
import { sep } from "./menu";

/** "Add ▸" submenu: input source types. */
export function useAddSourceNodes(): MenuNode[] {
  const types = useCatalogEntry("sourceTypes");
  if (!types) return [];
  const list = types.filter((t) => (t.kind === "input" || t.kind === "scene") && !t.deprecated);
  const inputs = list.filter((t) => t.kind === "input").sort((a, b) => a.name.localeCompare(b.name));
  const scene = list.find((t) => t.kind === "scene");
  const nodes: MenuNode[] = inputs.map((t) => ({ type: "item", label: t.name, icon: sourceIcon(t.icon), onSelect: () => openDialog("addSource", t.id) }));
  if (scene) nodes.push(sep, { type: "item", label: scene.name, icon: sourceIcon("scene"), onSelect: () => openDialog("addSource", scene.id) });
  nodes.push({ type: "item", label: useT().sources.group, icon: sourceIcon("group"), onSelect: () => groupSelected() });
  return nodes;
}

/**
 * Full OBS source context menu for the given item (or empty-area menu when
 * null). Acts on the whole selection when the item is part of it.
 */
export function useSourceMenu(item: SceneItem | null): MenuNode[] {
  const t = useT();
  const scene = useEditingScene();
  const selection = useStore((s) => s.selection);
  const clipboard = useStore((s) => s.clipboard);
  const sources = useStore((s) => s.state?.sources ?? EMPTY);
  const transitionTypes = useCatalogEntry("transitionTypes");
  const addNodes = useAddSourceNodes();

  const paste: MenuNode[] = [
    { type: "item", label: t.sources.pasteRef, icon: ClipboardPaste, disabled: !clipboard, onSelect: () => pasteSource(false), shortcut: "Ctrl+V" },
    { type: "item", label: t.sources.pasteDup, disabled: !clipboard, onSelect: () => pasteSource(true) },
  ];
  const add: MenuNode = { type: "sub", label: t.sources.add, icon: Plus, children: addNodes };
  if (!item || !scene) return [add, sep, ...paste];

  const targets = selection.includes(item.id) ? selection.map((id) => findItem(scene, id)).filter((x): x is SceneItem => !!x) : [item];
  const src = sources.find((s) => s.uuid === item.sourceUuid);
  const sceneId = scene.uuid;
  const each = (patch: Partial<SceneItem>) => targets.forEach((it) => updateItem(sceneId, it.id, patch));
  const multi = targets.length > 1;

  const transitionSub = (which: "show" | "hide"): MenuNode => {
    const cur = which === "show" ? item.showTransition : item.hideTransition;
    const key = which === "show" ? "showTransition" : "hideTransition";
    return {
      type: "sub",
      label: which === "show" ? t.sources.showTransition : t.sources.hideTransition,
      children: [
        {
          type: "radio",
          value: cur.kind ?? "",
          options: [{ value: "", label: t.sources.transitionNone }, ...(transitionTypes ?? []).filter((x) => x.id !== "cut_transition").map((x) => ({ value: x.id, label: x.name }))],
          onValueChange: (v) => each({ [key]: { kind: v || null, durationMs: cur.durationMs || 300 } } as Partial<SceneItem>),
        },
        sep,
        {
          type: "item",
          label: `${t.sources.transitionDuration}: ${cur.durationMs} ms`,
          disabled: !cur.kind,
          onSelect: async () => {
            const v = await promptDialog({ title: t.sources.transitionDuration, label: "ms", defaultValue: String(cur.durationMs || 300) });
            const ms = Math.max(50, Math.min(20000, Math.round(Number(v))));
            if (v != null && Number.isFinite(ms)) each({ [key]: { kind: cur.kind, durationMs: ms } } as Partial<SceneItem>);
          },
        },
      ],
    };
  };

  const scaleFilters: ScaleFilter[] = ["disable", "point", "bicubic", "bilinear", "lanczos", "area"];
  const blendModes: BlendMode[] = ["normal", "additive", "subtract", "screen", "multiply", "lighten", "darken"];
  const blendMethods: BlendMethod[] = ["default", "srgb_off"];

  return [
    add,
    sep,
    { type: "item", label: t.sources.copy, icon: Copy, onSelect: () => copySource(item.sourceUuid), shortcut: "Ctrl+C" },
    ...paste,
    { type: "item", label: t.sources.duplicate, icon: CopyPlus, disabled: item.isGroup, onSelect: () => duplicateItems(targets), shortcut: "Ctrl+D" },
    sep,
    { type: "item", label: t.sources.rename, icon: Pencil, disabled: multi, onSelect: () => renameSource(item.sourceUuid), shortcut: "F2" },
    { type: "item", label: t.common.delete, icon: Trash2, destructive: true, onSelect: () => removeItems(targets), shortcut: "Supr" },
    sep,
    {
      type: "sub",
      label: t.sources.order,
      children: [
        { type: "item", label: t.sources.orderUp, icon: ArrowUp, onSelect: () => orderItems(targets, "up"), shortcut: "Ctrl+↑" },
        { type: "item", label: t.sources.orderDown, icon: ArrowDown, onSelect: () => orderItems(targets, "down"), shortcut: "Ctrl+↓" },
        sep,
        { type: "item", label: t.sources.orderTop, icon: ArrowUpToLine, onSelect: () => orderItems(targets, "top"), shortcut: "Ctrl+Home" },
        { type: "item", label: t.sources.orderBottom, icon: ArrowDownToLine, onSelect: () => orderItems(targets, "bottom"), shortcut: "Ctrl+End" },
      ],
    },
    { type: "sub", label: t.sources.transform, icon: Move, children: useTransformNodes(targets) },
    sep,
    item.isGroup
      ? { type: "item", label: t.sources.ungroup, icon: Ungroup, onSelect: () => act((c) => c.ungroupItem(sceneId, item.id)) }
      : { type: "item", label: t.sources.groupSelected, icon: Group, disabled: !multi, onSelect: () => groupSelected() },
    sep,
    { type: "sub", label: t.sources.scaleFiltering, children: [{ type: "radio", value: item.scaleFilter, options: scaleFilters.map((v) => ({ value: v, label: t.sources.scaleFilters[v] })), onValueChange: (v) => each({ scaleFilter: v as ScaleFilter }) }] },
    { type: "sub", label: t.sources.blendMode, children: [{ type: "radio", value: item.blendMode, options: blendModes.map((v) => ({ value: v, label: t.sources.blendModes[v] })), onValueChange: (v) => each({ blendMode: v as BlendMode }) }] },
    { type: "sub", label: t.sources.blendMethod, children: [{ type: "radio", value: item.blendMethod, options: blendMethods.map((v) => ({ value: v, label: t.sources.blendMethods[v] })), onValueChange: (v) => each({ blendMethod: v as BlendMethod }) }] },
    sep,
    transitionSub("show"),
    transitionSub("hide"),
    sep,
    { type: "check", label: t.sources.lock, checked: item.locked, onCheckedChange: (v) => each({ locked: v }) },
    item.visible
      ? { type: "item", label: t.sources.hide, icon: EyeOff, onSelect: () => each({ visible: false }) }
      : { type: "item", label: t.sources.show, icon: Eye, onSelect: () => each({ visible: true }) },
    sep,
    ...(src?.interactive ? [{ type: "item", label: t.sources.interact, icon: MousePointerClick, onSelect: () => openDialog("interact", item.sourceUuid) } as MenuNode] : []),
    { type: "item", label: t.sources.filters, icon: Filter, onSelect: () => openDialog("filters", item.sourceUuid) },
    { type: "item", label: t.sources.properties, icon: Settings2, disabled: item.isGroup, onSelect: () => openDialog("properties", { type: "source", uuid: item.sourceUuid }) },
    sep,
    { type: "item", label: t.sources.screenshot, icon: Camera, onSelect: () => screenshotSource(item.sourceUuid) },
  ];
}

/** Transform ▸ submenu (also used by Edit ▸ Transform). */
export function useTransformNodes(targets: SceneItem[]): MenuNode[] {
  const t = useT();
  const scene = useEditingScene();
  const none = targets.length === 0 || !scene;
  const first = targets[0];
  const tr = (a: Parameters<typeof transformItems>[1]) => () => transformItems(targets, a);
  return [
    { type: "item", label: t.sources.editTransform, disabled: none, onSelect: () => scene && first && openDialog("transform", { scene: scene.uuid, item: first.id }), shortcut: "Ctrl+E" },
    { type: "item", label: t.sources.copyTransform, disabled: none, onSelect: () => scene && first && act((c) => c.copyTransform(scene.uuid, first.id)) },
    { type: "item", label: t.sources.pasteTransform, disabled: none, onSelect: () => scene && targets.forEach((it) => act((c) => c.pasteTransform(scene.uuid, it.id))) },
    { type: "item", label: t.sources.resetTransform, disabled: none, onSelect: tr("reset"), shortcut: "Ctrl+R" },
    sep,
    { type: "item", label: t.sources.rotateCw, disabled: none, onSelect: tr("rotate_cw") },
    { type: "item", label: t.sources.rotateCcw, disabled: none, onSelect: tr("rotate_ccw") },
    { type: "item", label: t.sources.rotate180, disabled: none, onSelect: tr("rotate_180") },
    sep,
    { type: "item", label: t.sources.flipH, disabled: none, onSelect: tr("flip_h") },
    { type: "item", label: t.sources.flipV, disabled: none, onSelect: tr("flip_v") },
    sep,
    { type: "item", label: t.sources.fit, disabled: none, onSelect: tr("fit"), shortcut: "Ctrl+F" },
    { type: "item", label: t.sources.stretch, disabled: none, onSelect: tr("stretch"), shortcut: "Ctrl+S" },
    { type: "item", label: t.sources.center, disabled: none, onSelect: tr("center") },
    { type: "item", label: t.sources.centerV, disabled: none, onSelect: tr("center_v") },
    { type: "item", label: t.sources.centerH, disabled: none, onSelect: tr("center_h") },
  ];
}

