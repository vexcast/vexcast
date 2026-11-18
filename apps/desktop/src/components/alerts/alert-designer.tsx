/**
 * Alert designer (StreamElements-style).
 *
 * Overview: alert types on the left; for the selected type, cards with a live
 * thumbnail of each of your alerts (edit / test / enable) and a "create" button
 * that opens a visual template gallery. Editor: the canvas with draggable
 * elements, a simple side panel in sections, layers and sample data.
 */
import type { AlertDesign, AlertLayer, AlertLayerKind, AlertType } from "@vexcast/protocol";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Copy,
  Download,
  Eye,
  EyeOff,
  Film,
  Gauge,
  Image as ImageIcon,
  Layers,
  Info,
  Lock,
  MoreHorizontal,
  MousePointerClick,
  Pencil,
  Play,
  Plus,
  Radio,
  Settings2,
  Sparkles,
  Square,
  SquareDashed,
  Trash2,
  Type,
  Unlock,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ALERT_META, ALERT_TYPES } from "@/components/extras/chat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/i18n";
import { confirmDialog } from "@/lib/dialogs";
import { fmt } from "@/lib/format";
import { act, api, errorMessage, useStore } from "@/lib/store";
import { isTauri, pickFile, pickSaveFile } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { AlertThumb, Canvas } from "./alert-canvas";
import { GroupPanel, newGroup, useGroups } from "./alert-groups";
import { AlertPlacement, AlertSourcesBanner } from "./alert-placement";
import { DesignPanel, LayerPanel } from "./alert-inspector";
import { createDesign, duplicateDesign, newLayer, normalizeDesign, TEMPLATES, type TemplateId, uid } from "./designs";

const NO_DESIGNS: AlertDesign[] = [];
const MONEY: AlertType[] = ["donation", "kofi", "superchat"];
const IMAGE_EXT = ["png", "gif", "webp", "apng", "jpg", "jpeg", "svg"];
const VIDEO_EXT = ["webm", "mp4", "mov"];
const SAMPLE_AMOUNT: Partial<Record<AlertType, string>> = { donation: "5", kofi: "3", superchat: "10", bits: "500", raid: "42", host: "12", gift_sub: "5", subscription: "6", member: "3" };

type Sample = { user: string; amount: string; message: string };

function sampleEvent(type: AlertType, s: Sample) {
  const amountStr = s.amount || SAMPLE_AMOUNT[type] || "";
  const amount = amountStr === "" ? null : Number(amountStr);
  return { type, platform: "twitch", user: s.user || "NovaCat", amount: Number.isFinite(amount) ? amount : null, currency: MONEY.includes(type) ? "USD" : null, message: s.message || null, test: true };
}

// ------------------------------------------------------------------ persistence

/** Local copy of the designs, autosaved (debounced); adopts server changes when nothing is pending. */
function useDesigns() {
  const saved = useStore((s) => s.state?.widgets.alertBox.designs ?? NO_DESIGNS);
  const [designs, setDesigns] = useState<AlertDesign[]>(() => saved.map(normalizeDesign));
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const pending = useRef<AlertDesign[] | null>(null);
  const lastSent = useRef(JSON.stringify(saved));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    setStatus("saving");
    lastSent.current = JSON.stringify(next);
    try {
      await api().setWidgets({ alertBox: { designs: next } });
      setStatus("saved");
    } catch (e) {
      toast.error(errorMessage(e));
      setStatus("idle");
    }
  }, []);
  const update = useCallback(
    (fn: (all: AlertDesign[]) => AlertDesign[]) => {
      setDesigns((all) => {
        const next = fn(all);
        pending.current = next;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(flush, 600);
        return next;
      });
    },
    [flush],
  );
  useEffect(() => {
    const json = JSON.stringify(saved);
    if (pending.current || json === lastSent.current) return;
    lastSent.current = json;
    setDesigns(saved.map(normalizeDesign));
  }, [saved]);
  useEffect(() => () => void flush(), [flush]);
  return { designs, update, flush, status };
}

// ------------------------------------------------------------------ template gallery

function TemplateGallery({ type, open, onClose, onPick }: { type: AlertType; open: boolean; onClose: () => void; onPick: (tpl: TemplateId) => void }) {
  const t = useT();
  const d = t.designer;
  const typeText = useStore((s) => s.state?.widgets.alertBox.templates?.[type]) || "{user}";
  const previews = useMemo(() => TEMPLATES.map((tpl) => ({ tpl, design: createDesign(type, tpl, "", typeText) })), [type, typeText]);
  const ev = sampleEvent(type, { user: "NovaCat", amount: "", message: "¡Me encanta el stream!" });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{fmt(d.createFor, { type: t.alerts.types[type] })}</DialogTitle>
          <DialogDescription>{d.galleryDesc}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {previews.map(({ tpl, design }) => (
            <button key={tpl} type="button" onClick={() => onPick(tpl)} className="group flex flex-col gap-1.5 rounded-lg border p-2 text-left transition-colors hover:border-primary hover:bg-accent/40" data-testid={`template-${tpl}`}>
              {tpl === "blank" ? (
                <div className="flex aspect-video items-center justify-center rounded-md border border-dashed text-muted-foreground">
                  <Plus className="size-6" />
                </div>
              ) : (
                <AlertThumb design={design} event={ev} />
              )}
              <span className="text-sm font-medium">{d.templates[tpl]}</span>
              <span className="text-[11px] leading-snug text-muted-foreground">{d.templateDesc[tpl]}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ overview

function conditionText(x: AlertDesign, d: ReturnType<typeof useT>["designer"]) {
  if (x.minAmount > 0 && x.maxAmount > 0) return fmt(d.condBetween, { min: x.minAmount, max: x.maxAmount });
  if (x.minAmount > 0) return fmt(d.condFrom, { min: x.minAmount });
  if (x.maxAmount > 0) return fmt(d.condUpTo, { max: x.maxAmount });
  return d.condAlways;
}

function Overview({
  type,
  setType,
  designs,
  update,
  onEdit,
  onCreate,
  flush,
  groupId,
  setGroupId,
}: {
  groupId: string | null;
  setGroupId: (id: string | null) => void;
  type: AlertType;
  setType: (t: AlertType) => void;
  designs: AlertDesign[];
  update: (fn: (all: AlertDesign[]) => AlertDesign[]) => void;
  onEdit: (id: string) => void;
  onCreate: () => void;
  flush: () => Promise<void>;
}) {
  const t = useT();
  const d = t.designer;
  const typeOff = useStore((s) => s.state?.widgets.alertBox.variations?.[type]?.enabled === false);
  const offTypes = useStore((s) => s.state?.widgets.alertBox.variations);
  const mine = designs.filter((x) => x.type === type);
  const active = mine.filter((x) => x.enabled);
  const ev = sampleEvent(type, { user: "NovaCat", amount: "", message: "¡Me encanta el stream!" });
  const Icon = ALERT_META[type].icon;
  const { groups, save: saveGroups } = useGroups();
  const group = groups.find((g) => g.id === groupId) ?? null;
  const addGroup = async () => {
    const g = newGroup(fmt(d.groupDefaultName, { n: groups.length + 1 }));
    await saveGroups([...groups, g]);
    setGroupId(g.id);
  };

  const setTypeEnabled = (enabled: boolean) => act((c) => c.setWidgets({ alertBox: { variations: { [type]: { ...(offTypes?.[type] ?? {}), enabled } } } }));
  const test = async (id?: string) => {
    await flush();
    void act((c) => c.testAlert(type, id), d.testSent);
  };
  const remove = async (x: AlertDesign) => {
    if (await confirmDialog({ title: fmt(d.deleteConfirm, { name: x.name }), destructive: true, confirmLabel: d.delete })) update((all) => all.filter((y) => y.id !== x.id));
  };
  const exportPack = async (ids: string[]) => {
    const p = await pickSaveFile([{ name: d.packFilter, extensions: ["vxalert"] }], "alertas.vxalert");
    if (!p) return;
    await flush();
    const r = await act((c) => c.exportAlerts(p, ids));
    if (r) toast.success(fmt(d.exported, { n: r.count }));
  };
  const importPack = async () => {
    const p = await pickFile([{ name: d.packFilter, extensions: ["vxalert", "json"] }]);
    if (!p) return;
    await flush();
    const r = await act((c) => c.importAlerts(p));
    if (r) toast.success(fmt(d.imported, { n: r.count }));
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-[210px_minmax(0,1fr)] gap-4">
      {/* Types */}
      <div className="flex min-h-0 flex-col gap-1">
        <span className="px-2 pb-1 text-xs font-semibold text-muted-foreground">{d.typesTitle}</span>
        {ALERT_TYPES.map((a) => {
          const TIcon = ALERT_META[a].icon;
          const n = designs.filter((x) => x.type === a && x.enabled).length;
          const off = offTypes?.[a]?.enabled === false;
          return (
            <button
              key={a}
              type="button"
              onClick={() => {
                setType(a);
                setGroupId(null);
              }}
              className={cn("flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent/60", !group && type === a && "bg-accent font-medium")}
              data-testid={`designer-type-${a}`}
            >
              <TIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{t.alerts.types[a]}</span>
              {off ? (
                <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-muted-foreground">
                  {d.off}
                </Badge>
              ) : n > 0 ? (
                <Badge className="h-5 px-1.5 text-[10px]">{n}</Badge>
              ) : (
                <span className="text-[10px] text-muted-foreground">{d.builtInShort}</span>
              )}
            </button>
          );
        })}
        <span className="mt-4 px-2 pb-1 text-xs font-semibold text-muted-foreground">{d.groupsTitle}</span>
        {groups.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => setGroupId(g.id)}
            className={cn("flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent/60", group?.id === g.id && "bg-accent font-medium")}
            data-testid={`designer-group-${g.name}`}
          >
            <Layers className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{g.name}</span>
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
              {g.designs.length}
            </Badge>
          </button>
        ))}
        <Button variant="ghost" size="sm" className="justify-start text-muted-foreground" onClick={addGroup} data-testid="designer-new-group">
          <Plus /> {d.newGroup}
        </Button>
        <div className="mt-auto flex flex-col gap-1 pt-3">
          <Button variant="ghost" size="sm" className="justify-start" onClick={importPack} disabled={!isTauri()}>
            <Upload /> {d.import}
          </Button>
          <Button variant="ghost" size="sm" className="justify-start" onClick={() => exportPack([])} disabled={!isTauri() || !designs.length}>
            <Download /> {d.exportAll}
          </Button>
        </div>
      </div>

      {/* Selected group, or the alerts of the selected type */}
      {group ? (
        <GroupPanel group={group} designs={designs} onDeleted={() => setGroupId(null)} />
      ) : (
      <ScrollArea className="min-h-0">
        <div className="flex flex-col gap-4 pr-3 pb-4">
          <AlertSourcesBanner designs={designs} />
          <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3">
            <span className="grid size-9 place-items-center rounded-md bg-primary/15 text-primary">
              <Icon className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{t.alerts.types[type]}</div>
              <div className="text-xs text-muted-foreground">
                {typeOff ? d.typeOffDesc : active.length === 1 ? fmt(d.usesOne, { name: active[0].name }) : active.length > 1 ? d.usesMine : d.usesBuiltIn}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              {d.showType}
              <Switch checked={!typeOff} onCheckedChange={setTypeEnabled} data-testid="designer-type-enabled" />
            </label>
            <Button variant="outline" onClick={() => test()} disabled={typeOff}>
              <Radio /> {d.testLive}
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {mine.map((x) => (
              <div key={x.id} className={cn("group flex flex-col overflow-hidden rounded-lg border bg-card transition-colors hover:border-primary/60", !x.enabled && "opacity-60")} data-testid={`designer-card-${x.name}`}>
                <button type="button" onClick={() => onEdit(x.id)} className="relative block" title={d.edit}>
                  <AlertThumb design={x} event={ev} className="rounded-none" />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-sm font-medium text-white opacity-0 transition-all group-hover:bg-black/45 group-hover:opacity-100">
                    <Pencil className="mr-1.5 size-4" /> {d.edit}
                  </span>
                </button>
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{x.name}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{conditionText(x, d)}</div>
                  </div>
                  <Switch checked={x.enabled} onCheckedChange={(enabled) => update((all) => all.map((y) => (y.id === x.id ? { ...y, enabled } : y)))} aria-label={d.enabled} />
                </div>
                <div className="flex flex-col gap-2 border-t px-3 py-2.5">
                  {(() => {
                    const mine = groups.filter((g) => g.designs.includes(x.id));
                    return mine.length ? (
                      <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                        <Layers className="size-3.5" />
                        {d.inGroups}
                        {mine.map((g) => (
                          <Badge key={g.id} variant="secondary" className="h-5 cursor-pointer px-1.5 text-[10px]" onClick={() => setGroupId(g.id)}>
                            {g.name}
                          </Badge>
                        ))}
                      </div>
                    ) : null;
                  })()}
                  <AlertPlacement design={x} compact />
                </div>
                <div className="flex items-center gap-1 border-t px-2 py-1.5">
                  <Button size="sm" className="h-7 flex-1" onClick={() => onEdit(x.id)} data-testid={`designer-edit-${x.name}`}>
                    <Pencil /> {d.edit}
                  </Button>
                  <Button size="sm" variant="outline" className="h-7" onClick={() => test(x.id)}>
                    <Play /> {d.test}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon-sm" variant="ghost" className="size-7" aria-label="…">
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => update((all) => [...all, duplicateDesign(x, d.copySuffix)])}>
                        <Copy /> {d.duplicate}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => exportPack([x.id])} disabled={!isTauri()}>
                        <Download /> {d.export}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-[11px] text-muted-foreground">{d.groupsMenu}</DropdownMenuLabel>
                      {groups.map((g) => (
                        <DropdownMenuCheckboxItem
                          key={g.id}
                          checked={g.designs.includes(x.id)}
                          onSelect={(e) => e.preventDefault()}
                          onCheckedChange={(on) => saveGroups(groups.map((y) => (y.id === g.id ? { ...y, designs: on ? [...new Set([...y.designs, x.id])] : y.designs.filter((z) => z !== x.id) } : y)))}
                        >
                          {g.name}
                        </DropdownMenuCheckboxItem>
                      ))}
                      <DropdownMenuItem
                        onSelect={async () => {
                          const g = newGroup(fmt(d.groupDefaultName, { n: groups.length + 1 }));
                          g.designs = [x.id];
                          await saveGroups([...groups, g]);
                          setGroupId(g.id);
                        }}
                      >
                        <Plus /> {d.newGroupWith}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => remove(x)}>
                        <Trash2 /> {d.delete}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={onCreate}
              className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-4 text-center text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
              data-testid="designer-new"
            >
              <Plus className="size-7" />
              <span className="text-sm font-medium">{fmt(d.createFor, { type: t.alerts.types[type] })}</span>
              <span className="max-w-60 text-[11px]">{mine.length ? d.createMoreHint : d.createFirstHint}</span>
            </button>
          </div>
          {active.length > 1 && (
            <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <span>{active.every((x) => x.minAmount === 0 && x.maxAmount === 0 && x.priority === active[0].priority) ? fmt(d.manyRandom, { n: active.length }) : d.manyConditions}</span>
            </div>
          )}
        </div>
      </ScrollArea>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ editor

/** Goal editor mode: sample values and labels instead of the alert ones. */
export type GoalEditing = { title: string; currency: string; backLabel: string };

export function Editor({
  design,
  update,
  onBack,
  flush,
  status,
  goal,
}: {
  design: AlertDesign;
  update: (fn: (all: AlertDesign[]) => AlertDesign[]) => void;
  onBack: () => void;
  flush: () => Promise<void>;
  status: string;
  goal?: GoalEditing;
}) {
  const t = useT();
  const d = t.designer;
  const alertText = useStore((s) => s.state?.widgets.alertBox.templates?.[design.type]) || "{user}";
  const typeText = goal ? "{title}" : alertText;
  const [goalSample, setGoalSample] = useState({ current: "42", target: "100" });
  const [layerId, setLayerId] = useState<string | null>(null);
  const [playKey, setPlayKey] = useState(0);
  const [sample, setSample] = useState<Sample>({ user: "NovaCat", amount: "", message: "¡Me encanta el stream!" });
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const layer = design.layers.find((l) => l.id === layerId) ?? null;
  const event = useMemo(() => {
    if (!goal) return sampleEvent(design.type, sample);
    const current = Math.max(0, Number(goalSample.current) || 0);
    const target = Math.max(0, Number(goalSample.target) || 0);
    return { goal: true, title: goal.title, currency: goal.currency, current, target, reached: target > 0 && current >= target };
  }, [design.type, sample, goal, goalSample]);

  const setDesign = (p: Partial<AlertDesign>) => update((all) => all.map((x) => (x.id === design.id ? { ...x, ...p } : x)));
  const setLayer = useCallback((id: string, p: Partial<AlertLayer>) => update((all) => all.map((x) => (x.id === design.id ? { ...x, layers: x.layers.map((l) => (l.id === id ? { ...l, ...p } : l)) } : x))), [update, design.id]);
  const setLayers = (layers: AlertLayer[]) => setDesign({ layers });

  const addLayer = (kind: AlertLayerKind, patch: Partial<AlertLayer> = {}) => {
    const W = design.width;
    const H = design.height;
    const size = kind === "text" ? { w: Math.round(Math.min(1200, W * 0.7)), h: 140 } : kind === "shape" ? { w: 600, h: 200 } : kind === "progress" ? { w: Math.round(W * 0.8), h: Math.max(24, Math.round(H * 0.18)) } : { w: Math.round(Math.min(600, W * 0.4)), h: Math.round(Math.min(600, H * 0.5)) };
    const l = newLayer(kind, { name: d.kinds[kind], x: Math.round((W - size.w) / 2), y: Math.round((H - size.h) / 2), ...size, text: kind === "text" ? typeText : "", animIn: kind === "text" ? "pop" : "fadeIn", ...patch });
    setLayers([...design.layers, l]);
    setLayerId(l.id);
  };
  const addMedia = async (kind: "image" | "video") => {
    if (!isTauri()) return addLayer(kind);
    const p = await pickFile([{ name: d.kinds[kind], extensions: kind === "video" ? VIDEO_EXT : [...IMAGE_EXT, ...VIDEO_EXT] }]);
    if (!p) return;
    const r = await act((c) => c.importMedia(p));
    if (r) addLayer(/\.(webm|mp4|mov)$/i.test(p) ? "video" : kind, { src: r.path.replace(/\\/g, "/") });
  };
  const dropFiles = async (files: File[], x: number, y: number) => {
    for (const f of files) {
      const isVideo = f.type.startsWith("video/");
      if (!isVideo && !f.type.startsWith("image/")) continue;
      try {
        const r = await api().uploadFile(f, f.name);
        addLayer(isVideo ? "video" : "image", { src: r.path.replace(/\\/g, "/"), x: Math.round(x - 300), y: Math.round(y - 200), w: 600, h: 400 });
      } catch (e) {
        toast.error(errorMessage(e));
      }
    }
  };
  const moveLayer = (id: string, dir: 1 | -1) => {
    const i = design.layers.findIndex((l) => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= design.layers.length) return;
    const ls = [...design.layers];
    [ls[i], ls[j]] = [ls[j], ls[i]];
    setLayers(ls);
  };
  const deleteLayer = (id: string) => {
    setLayers(design.layers.filter((l) => l.id !== id));
    setLayerId(null);
  };
  const duplicateLayer = (id: string) => {
    const l = design.layers.find((x) => x.id === id);
    if (!l) return;
    const c = { ...structuredClone(l), id: uid(), x: l.x + 30, y: l.y + 30 };
    setLayers([...design.layers, c]);
    setLayerId(c.id);
  };
  const editLayer = (id: string) => {
    setLayerId(id);
    setTimeout(() => {
      textRef.current?.focus();
      textRef.current?.select();
    }, 50);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (!layer || (e.target as HTMLElement).closest("input,textarea,[contenteditable],[role=combobox]")) return;
    const step = e.shiftKey ? 10 : 1;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key] && !layer.locked) {
      e.preventDefault();
      setLayer(layer.id, { x: layer.x + moves[e.key][0], y: layer.y + moves[e.key][1] });
    } else if (e.key === "Delete") {
      e.preventDefault();
      deleteLayer(layer.id);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
      e.preventDefault();
      duplicateLayer(layer.id);
    } else if (e.key === "Escape") {
      setLayerId(null);
    }
  };

  const addBtn = (icon: React.ReactNode, label: string, onClick: () => void, testId?: string) => (
    <Button size="sm" variant="outline" className="h-8" onClick={onClick} disabled={design.customEnabled} data-testid={testId}>
      {icon} {label}
    </Button>
  );

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_320px] gap-4" data-testid="alert-editor">
      <div className="flex min-h-0 min-w-0 flex-col gap-2 outline-none" tabIndex={0} onKeyDown={onKey}>
        {/* Header */}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" className="h-8" onClick={onBack} data-testid="designer-back">
            <ArrowLeft /> {goal ? goal.backLabel : fmt(d.backTo, { type: t.alerts.types[design.type] })}
          </Button>
          <span className="min-w-0 truncate text-sm font-semibold">{design.name}</span>
          <span className="text-[11px] text-muted-foreground">{status === "saving" ? d.saving : status === "saved" ? `✓ ${d.saved}` : ""}</span>
          <div className="flex-1" />
          {playKey ? (
            <Button size="sm" variant="secondary" className="h-8" onClick={() => setPlayKey(0)}>
              <SquareDashed /> {d.stop}
            </Button>
          ) : (
            <Button size="sm" variant="secondary" className="h-8" onClick={() => setPlayKey(Date.now())} data-testid="designer-play">
              <Play /> {d.play}
            </Button>
          )}
          {!goal && (
            <Button
              size="sm"
              className="h-8"
              onClick={async () => {
                await flush();
                void act((c) => c.testAlert(design.type, design.id), d.testSent);
              }}
              data-testid="designer-test"
            >
              <Radio /> {d.testLive}
            </Button>
          )}
        </div>
        {/* Add elements */}
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-card px-2 py-1.5">
          <span className="px-1 text-xs text-muted-foreground">{d.addLabel}</span>
          {addBtn(<Type />, d.addText, () => addLayer("text"), "designer-add-text")}
          {addBtn(<ImageIcon />, d.addImage, () => addMedia("image"))}
          {addBtn(<Film />, d.addVideo, () => addMedia("video"))}
          {addBtn(<Square />, d.addShape, () => addLayer("shape"))}
          {goal && addBtn(<Gauge />, d.addProgress, () => addLayer("progress", { fill: "#7c5cff", radius: 24, animIn: "fadeIn" }))}
          {addBtn(<Sparkles />, d.addParticles, () => addLayer("particles", { name: d.kinds.particles, x: 0, y: 0, w: design.width || 1920, h: design.height || 1080, animIn: "none", animOut: "fadeOut" }))}
          <span className="ml-auto hidden items-center gap-1 text-[11px] text-muted-foreground lg:flex">
            <MousePointerClick className="size-3.5" /> {d.canvasHelp}
          </span>
        </div>

        <Canvas design={design} selected={layerId} onSelect={setLayerId} onLayer={setLayer} onEditLayer={editLayer} event={event} playKey={playKey} onPlayEnd={() => setPlayKey(0)} onDropFiles={dropFiles} />

        {/* Layers + sample */}
        <div className="grid shrink-0 grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-2">
          <div className="flex min-h-0 flex-col rounded-lg border bg-card">
            <span className="border-b px-3 py-1.5 text-xs font-semibold">{d.layers}</span>
            <ScrollArea className="h-28">
              <div className="p-1">
                {!design.layers.length && <p className="p-2 text-[11px] text-muted-foreground">{design.customEnabled ? d.codeActive : d.noLayers}</p>}
                {[...design.layers].reverse().map((l) => {
                  const LIcon = l.kind === "text" ? Type : l.kind === "image" ? ImageIcon : l.kind === "video" ? Film : l.kind === "particles" ? Sparkles : l.kind === "progress" ? Gauge : Square;
                  const tip = (label: string, icon: React.ReactNode, onClick: () => void) => (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          className="size-6"
                          aria-label={label}
                          onClick={(e) => {
                            e.stopPropagation();
                            onClick();
                          }}
                        >
                          {icon}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{label}</TooltipContent>
                    </Tooltip>
                  );
                  return (
                    <div
                      key={l.id}
                      onClick={() => setLayerId(l.id)}
                      onDoubleClick={() => editLayer(l.id)}
                      className={cn("flex cursor-default items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-accent/60 [&_svg]:size-3.5", layerId === l.id && "bg-accent", !l.visible && "opacity-50")}
                    >
                      <LIcon className="shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{l.name || (l.kind === "text" ? l.text : d.kinds[l.kind])}</span>
                      {tip(d.up, <ArrowUp />, () => moveLayer(l.id, 1))}
                      {tip(d.down, <ArrowDown />, () => moveLayer(l.id, -1))}
                      {tip(l.visible ? d.hide : d.show, l.visible ? <Eye /> : <EyeOff />, () => setLayer(l.id, { visible: !l.visible }))}
                      {tip(l.locked ? d.unlock : d.lock, l.locked ? <Lock /> : <Unlock />, () => setLayer(l.id, { locked: !l.locked }))}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
          {goal ? (
            <div className="flex flex-col gap-1.5 rounded-lg border bg-card p-2.5">
              <span className="text-xs font-semibold">{d.sample}</span>
              <div className="grid grid-cols-2 gap-1.5">
                <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
                  {d.goalCurrent}
                  <Input type="number" min={0} value={goalSample.current} onChange={(e) => setGoalSample({ ...goalSample, current: e.target.value })} className="h-7 text-xs" />
                </label>
                <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
                  {d.goalTarget}
                  <Input type="number" min={0} value={goalSample.target} onChange={(e) => setGoalSample({ ...goalSample, target: e.target.value })} className="h-7 text-xs" />
                </label>
              </div>
              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setGoalSample((g) => ({ ...g, current: Number(g.current) >= Number(g.target) ? String(Math.round(Number(g.target) * 0.42)) : g.target }))}>
                {Number(goalSample.current) >= Number(goalSample.target) ? d.goalUnreach : d.goalReach}
              </Button>
            </div>
          ) : (
          <div className="flex flex-col gap-1.5 rounded-lg border bg-card p-2.5">
            <span className="text-xs font-semibold">{d.sample}</span>
            <div className="grid grid-cols-[1fr_84px] gap-1.5">
              <Input value={sample.user} onChange={(e) => setSample({ ...sample, user: e.target.value })} placeholder={d.sampleUser} className="h-7 text-xs" />
              <Input value={sample.amount} onChange={(e) => setSample({ ...sample, amount: e.target.value })} placeholder={SAMPLE_AMOUNT[design.type] ?? d.sampleAmount} className="h-7 text-xs" />
            </div>
            <Input value={sample.message} onChange={(e) => setSample({ ...sample, message: e.target.value })} placeholder={d.sampleMessage} className="h-7 text-xs" />
          </div>
          )}
        </div>
      </div>

      {/* Side panel */}
      <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card">
        <div className="flex border-b">
          <button type="button" onClick={() => setLayerId(null)} className={cn("flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-medium", !layer ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground")}>
            <Settings2 className="size-3.5" /> {goal ? d.goalSettings : d.alertSettings}
          </button>
          <button type="button" disabled={!layer} className={cn("flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-medium", layer ? "border-b-2 border-primary text-foreground" : "text-muted-foreground/60")}>
            <Pencil className="size-3.5" /> {layer ? layer.name || d.kinds[layer.kind] : d.elementNone}
          </button>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          {layer ? (
            <LayerPanel ref={textRef} key={layer.id} layer={layer} design={design} goal={!!goal} set={(p) => setLayer(layer.id, p)} onDelete={() => deleteLayer(layer.id)} onDuplicate={() => duplicateLayer(layer.id)} />
          ) : (
            <>
              {!design.customEnabled && (
                <div className="m-4 mb-0 rounded-md border border-dashed bg-muted/30 p-3 text-[11px] leading-relaxed text-muted-foreground">{goal ? d.goalHint : d.selectHint}</div>
              )}
              <DesignPanel design={design} set={setDesign} goal={!!goal} />
            </>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ main

export function AlertDesigner() {
  const t = useT();
  const { designs, update, flush, status } = useDesigns();
  const [type, setType] = useState<AlertType>(() => designs[0]?.type ?? "follow");
  const [editing, setEditing] = useState<string | null>(null);
  const [gallery, setGallery] = useState(false);
  const [groupId, setGroupId] = useState<string | null>(null);
  const typeText = useStore((s) => s.state?.widgets.alertBox.templates?.[type]) || "{user}";
  const design = designs.find((x) => x.id === editing) ?? null;

  const create = (tpl: TemplateId) => {
    const n = designs.filter((x) => x.type === type).length + 1;
    const nd = createDesign(type, tpl, `${t.alerts.types[type]} ${n}`, typeText);
    update((all) => [...all, nd]);
    setGallery(false);
    setEditing(nd.id);
  };

  return (
    <div className="h-[calc(100vh-10.5rem)] min-h-140" data-testid="alert-designer">
      {design ? (
        <Editor design={design} update={update} onBack={() => setEditing(null)} flush={flush} status={status} />
      ) : (
        <Overview groupId={groupId} setGroupId={setGroupId} type={type} setType={setType} designs={designs} update={update} onEdit={setEditing} onCreate={() => setGallery(true)} flush={flush} />
      )}
      <TemplateGallery type={type} open={gallery} onClose={() => setGallery(false)} onPick={create} />
    </div>
  );
}
