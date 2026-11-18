/**
 * Alert groups: one browser source that shows the specific alert variants you
 * pick (e.g. "normal bits" yes, "epic bits" no), from any alert types.
 */
import type { AlertDesign, AlertGroup, AlertType } from "@vexcast/protocol";
import { Layers, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ALERT_META, ALERT_TYPES } from "@/components/extras/chat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useT } from "@/i18n";
import { confirmDialog } from "@/lib/dialogs";
import { fmt } from "@/lib/format";
import { act, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { AlertThumb } from "./alert-canvas";
import { SourcePlacement, usePlacements } from "./alert-placement";
import { uid } from "./designs";

const NO_GROUPS: AlertGroup[] = [];

export function useGroups() {
  const groups = useStore((s) => s.state?.widgets.alertBox.groups ?? NO_GROUPS);
  const save = (next: AlertGroup[]) => act((c) => c.setWidgets({ alertBox: { groups: next } }));
  return { groups, save };
}

export function newGroup(name: string): AlertGroup {
  return { id: uid().replace(/-/g, "").slice(0, 12), name, designs: [], width: 1920, height: 1080 };
}

/** "Siempre", "Con 100 o más", "Entre 1 y 99"… */
export function variantCondition(x: AlertDesign, d: ReturnType<typeof useT>["designer"]) {
  if (x.minAmount > 0 && x.maxAmount > 0) return fmt(d.condBetween, { min: x.minAmount, max: x.maxAmount });
  if (x.minAmount > 0) return fmt(d.condFrom, { min: x.minAmount });
  if (x.maxAmount > 0) return fmt(d.condUpTo, { max: x.maxAmount });
  return d.condAlways;
}

/** A variant's own sources (to warn about alerts that would show twice). */
function OwnSourceWarning({ design }: { design: AlertDesign }) {
  const t = useT();
  const own = usePlacements((u) => u.includes("/widgets/alerts.html") && u.includes(`design=${encodeURIComponent(design.id)}`));
  if (!own.length) return null;
  return <span className="text-[10px] text-amber-600 dark:text-amber-400">{t.designer.groupAlsoOwn}</span>;
}

function sample(type: AlertType) {
  return { type, platform: "twitch", user: "NovaCat", amount: type === "bits" ? 500 : type === "raid" ? 42 : ["donation", "kofi", "superchat"].includes(type) ? 5 : null, currency: ["donation", "kofi", "superchat"].includes(type) ? "USD" : null, message: null, test: true };
}

export function GroupPanel({ group, designs, onDeleted }: { group: AlertGroup; designs: AlertDesign[]; onDeleted: () => void }) {
  const t = useT();
  const d = t.designer;
  const { groups, save } = useGroups();
  const [name, setName] = useState(group.name);
  useEffect(() => setName(group.name), [group.id, group.name]);
  const set = (p: Partial<AlertGroup>) => save(groups.map((g) => (g.id === group.id ? { ...g, ...p } : g)));
  const inGroup = useMemo(() => new Set(group.designs), [group.designs]);
  const setMany = (ids: string[], on: boolean) => set({ designs: on ? [...new Set([...group.designs, ...ids])] : group.designs.filter((x) => !ids.includes(x)) });
  const remove = async () => {
    if (!(await confirmDialog({ title: fmt(d.groupDeleteConfirm, { name: group.name }), destructive: true, confirmLabel: d.delete }))) return;
    await save(groups.filter((g) => g.id !== group.id));
    onDeleted();
  };

  return (
    <ScrollArea className="min-h-0">
      <div className="flex max-w-5xl flex-col gap-4 pr-3 pb-4">
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3">
          <span className="grid size-9 place-items-center rounded-md bg-primary/15 text-primary">
            <Layers className="size-5" />
          </span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name !== group.name && set({ name: name.trim() })}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="h-9 max-w-80 flex-1 text-sm font-semibold"
            data-testid="group-name"
          />
          <Badge variant="secondary">{fmt(d.groupCount, { n: group.designs.length })}</Badge>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" className="text-destructive" onClick={remove}>
            <Trash2 /> {d.groupDelete}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{d.groupDesc}</p>

        <div className="rounded-lg border bg-card p-4">
          <SourcePlacement target={{ id: group.id, name: group.name, width: group.width, height: group.height, param: "group" }} />
        </div>

        {!designs.length && <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{d.groupNoAlerts}</p>}
        {ALERT_TYPES.map((type) => {
          const list = designs.filter((x) => x.type === type);
          if (!list.length) return null;
          const Icon = ALERT_META[type].icon;
          const picked = list.filter((x) => inGroup.has(x.id)).length;
          return (
            <div key={type} className="rounded-lg border bg-card">
              <label className="flex cursor-pointer items-center gap-2.5 border-b px-4 py-2.5">
                <Checkbox
                  checked={picked === list.length ? true : picked ? "indeterminate" : false}
                  onCheckedChange={(v) =>
                    setMany(
                      list.map((x) => x.id),
                      v === true,
                    )
                  }
                />
                <Icon className="size-4 text-muted-foreground" />
                <span className="text-sm font-semibold">{t.alerts.types[type]}</span>
                <span className="text-xs text-muted-foreground">{fmt(d.variantsPicked, { n: picked, total: list.length })}</span>
              </label>
              <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
                {list.map((x) => {
                  const on = inGroup.has(x.id);
                  return (
                    <label
                      key={x.id}
                      className={cn("flex cursor-pointer items-center gap-3 rounded-md border p-2 transition-colors hover:bg-accent/40", on ? "border-primary/60 bg-primary/5" : "opacity-80")}
                      data-testid={`group-pick-${x.name}`}
                    >
                      <Checkbox checked={on} onCheckedChange={(v) => setMany([x.id], v === true)} />
                      <AlertThumb design={x} event={sample(type)} className="w-24 shrink-0 rounded" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium">{x.name}</span>
                        <span className="truncate text-[11px] text-muted-foreground">{variantCondition(x, d)}</span>
                        {!x.enabled && <span className="text-[10px] text-muted-foreground">{d.variantOff}</span>}
                        {on && <OwnSourceWarning design={x} />}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}

        <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-4">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {d.width}
            <Input type="number" value={group.width} onChange={(e) => set({ width: Math.max(100, Number(e.target.value) || 1920) })} className="h-8 w-24 text-xs" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {d.height}
            <Input type="number" value={group.height} onChange={(e) => set({ height: Math.max(100, Number(e.target.value) || 1080) })} className="h-8 w-24 text-xs" />
          </label>
          <span className="pb-2 text-[11px] text-muted-foreground">{d.groupSizeHint}</span>
        </div>
      </div>
    </ScrollArea>
  );
}
