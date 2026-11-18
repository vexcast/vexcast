/**
 * Every alert is its own browser source (alerts.html?design=<id>): place it in
 * any scene, at any position and size. This file shows where an alert is and
 * adds/removes it from scenes.
 */
import type { AlertDesign, SceneItem } from "@vexcast/protocol";
import { Check, ChevronDown, Link2, MonitorPlay, Minus, Plus } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useT } from "@/i18n";
import { fmt } from "@/lib/format";
import { act, editingSceneUuid, useStore } from "@/lib/store";
import { copyText } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { designUrl } from "./designs";

type Placement = { scene: string; sceneName: string; item: number };

/** Scene items (top level and in groups) of browser sources whose URL matches `test`. */
export function usePlacements(test: (url: string) => boolean): Placement[] {
  // Selected as a JSON string: new objects every render would make zustand loop forever.
  const json = useStore((s) => {
      const st = s.state;
      if (!st) return "[]";
      const ids = new Set(st.sources.filter((x) => x.kind.startsWith("browser_source") && test(String(x.settings?.url ?? ""))).map((x) => x.uuid));
      const out: Placement[] = [];
      const walk = (scene: string, sceneName: string, items: SceneItem[]) => {
        for (const it of items) {
          if (ids.has(it.sourceUuid)) out.push({ scene, sceneName, item: it.id });
          if (it.items) walk(it.sourceUuid, sceneName, it.items);
        }
      };
      for (const sc of st.scenes) walk(sc.uuid, sc.name, sc.items);
      return JSON.stringify(out);
  });
  return useMemo(() => JSON.parse(json) as Placement[], [json]);
}

/** What gets its own browser source: one alert (?design=) or a group of alerts (?group=). */
export type Target = { id: string; name: string; width: number; height: number; param: "design" | "group" };
export const designTarget = (d: AlertDesign): Target => ({ id: d.id, name: d.name, width: d.width, height: d.height, param: "design" });

export const targetUrl = (widgetUrl: string, t: Target) => (t.param === "design" ? designUrl(widgetUrl, t.id) : `${widgetUrl}${widgetUrl.includes("?") ? "&" : "?"}group=${encodeURIComponent(t.id)}`);
const isTargetUrl = (t: Target) => (u: string) => u.includes("/widgets/alerts.html") && u.includes(`${t.param}=${encodeURIComponent(t.id)}`);
/** The old browser source that showed every alert together (no ?design= / ?group=). */
export const isLegacyAlertUrl = (u: string) => u.includes("/widgets/alerts.html") && !u.includes("design=") && !u.includes("group=");

/** Add a target's browser source to a scene (sized like its canvas). done: success message. */
export function addTargetToScene(t: Target, sceneUuid: string, done: string) {
  const c = useStore.getState().client;
  if (!c) return;
  const url = targetUrl(c.widgetUrl("alerts"), t);
  return act((cl) => cl.createSource({ name: t.name, kind: "browser_source", settings: { url, width: t.width, height: t.height }, sceneUuid }), done);
}
export const addAlertToScene = (d: AlertDesign, sceneUuid: string, done: string) => addTargetToScene(designTarget(d), sceneUuid, done);

/** Ids of the variants shown by some browser source (their own, or a group's). */
function usePlacedIds(): Set<string> {
  const urls = useStore(useShallow((s) => (s.state?.sources ?? []).filter((x) => x.kind.startsWith("browser_source")).map((x) => String(x.settings?.url ?? ""))));
  const groupsJson = useStore((s) => JSON.stringify(s.state?.widgets.alertBox.groups ?? []));
  return useMemo(() => {
    const groups = JSON.parse(groupsJson) as { id: string; designs: string[] }[];
    const ids = new Set(urls.map((u) => /[?&]design=([^&]+)/.exec(u)?.[1]).filter((x): x is string => !!x).map(decodeURIComponent));
    for (const u of urls) {
      const g = /[?&]group=([^&]+)/.exec(u)?.[1];
      if (g) groups.find((x) => x.id === decodeURIComponent(g))?.designs.forEach((d) => ids.add(d));
    }
    return ids;
  }, [urls, groupsJson]);
}

/** Names of the placed groups that contain this variant. */
function useViaGroups(designId: string): string[] {
  const json = useStore((s) => {
    const st = s.state;
    if (!st) return "[]";
    const urls = st.sources.filter((x) => x.kind.startsWith("browser_source")).map((x) => String(x.settings?.url ?? ""));
    return JSON.stringify((st.widgets.alertBox.groups ?? []).filter((g) => g.designs.includes(designId) && urls.some((u) => u.includes(`group=${encodeURIComponent(g.id)}`))).map((g) => g.name));
  });
  return useMemo(() => JSON.parse(json) as string[], [json]);
}

export function AlertPlacement({ design, compact }: { design: AlertDesign; compact?: boolean }) {
  const t = useT();
  const via = useViaGroups(design.id);
  if (via.length) {
    // Already on stream through a group: no own source needed.
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
        <MonitorPlay className="size-3.5 shrink-0" />
        <span className="truncate">{fmt(t.designer.viaGroup, { groups: via.join(", ") })}</span>
      </div>
    );
  }
  return <SourcePlacement target={designTarget(design)} compact={compact} />;
}

export function SourcePlacement({ target, compact }: { target: Target; compact?: boolean }) {
  const t = useT();
  const d = t.designer;
  const client = useStore((s) => s.client);
  const scenesJson = useStore((s) => JSON.stringify((s.state?.scenes ?? []).map((x) => ({ uuid: x.uuid, name: x.name }))));
  const scenes = useMemo(() => JSON.parse(scenesJson) as { uuid: string; name: string }[], [scenesJson]);
  const current = useStore((s) => (s.state ? editingSceneUuid(s.state) : null));
  const placed = usePlacements(isTargetUrl(target));
  const placedScenes = [...new Set(placed.map((p) => p.sceneName))];
  const url = client ? targetUrl(client.widgetUrl("alerts"), target) : "";
  const currentName = scenes.find((s) => s.uuid === current)?.name ?? "";
  const inCurrent = placed.some((p) => p.sceneName === currentName);

  return (
    <div className="flex flex-col gap-2">
      <div className={cn("flex items-center gap-1.5 text-[11px]", placedScenes.length ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>
        <MonitorPlay className="size-3.5 shrink-0" />
        <span className="truncate">{placedScenes.length ? fmt(d.placedIn, { scenes: placedScenes.join(", ") }) : d.notPlaced}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {current && !inCurrent && (
          <Button size="sm" className={cn("h-7", compact && "flex-1")} onClick={() => addTargetToScene(target, current, fmt(d.addedTo, { name: target.name, scene: currentName }))} data-testid="alert-add-current">
            <Plus /> {fmt(d.addToScene, { scene: currentName })}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="h-7">
              {d.scenesMenu} <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-56">
            <DropdownMenuLabel className="text-xs">{d.scenesMenuTitle}</DropdownMenuLabel>
            {scenes.map((sc) => {
              const here = placed.filter((p) => p.sceneName === sc.name);
              return here.length ? (
                <DropdownMenuItem key={sc.uuid} onSelect={() => here.forEach((p) => act((c) => c.removeItem(p.scene, p.item), fmt(d.removedFrom, { name: target.name, scene: sc.name })))}>
                  <Check className="text-emerald-500" /> <span className="flex-1">{sc.name}</span>
                  <span className="text-[10px] text-muted-foreground">
                    <Minus className="inline size-3" /> {d.remove}
                  </span>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem key={sc.uuid} onSelect={() => addTargetToScene(target, sc.uuid, fmt(d.addedTo, { name: target.name, scene: sc.name }))}>
                  <Plus /> <span className="flex-1">{sc.name}</span>
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={async () => {
                if (await copyText(url)) toast.success(d.urlCopied);
              }}
            >
              <Link2 /> {d.copyUrl}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/** Banner: old "all alerts together" sources → offer to split them; otherwise a short how-to. */
export function AlertSourcesBanner({ designs }: { designs: AlertDesign[] }) {
  const t = useT();
  const d = t.designer;
  const legacy = usePlacements(isLegacyAlertUrl);
  const current = useStore((s) => (s.state ? editingSceneUuid(s.state) : null));
  const currentName = useStore((s) => s.state?.scenes.find((x) => x.uuid === (s.state ? editingSceneUuid(s.state) : null))?.name ?? "");
  const enabled = designs.filter((x) => x.enabled);
  const placedIds = usePlacedIds();
  const missing = enabled.filter((x) => !placedIds.has(x.id));

  if (legacy.length) {
    const scenes = [...new Set(legacy.map((p) => p.sceneName))].join(", ");
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3">
        <MonitorPlay className="size-5 shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-medium">{fmt(d.legacyTitle, { scenes })}</div>
          <div className="text-xs text-muted-foreground">{d.legacyDesc}</div>
        </div>
        <Button size="sm" disabled={!enabled.length} onClick={() => act((c) => c.splitAlertSources().then((r) => r), d.legacyDone)} data-testid="alert-split">
          {d.legacySplit}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3">
      <MonitorPlay className="size-5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1 text-xs text-muted-foreground">{d.howSeparate}</div>
      {current && missing.length > 0 && (
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            for (const x of missing) await addAlertToScene(x, current, fmt(d.addedTo, { name: x.name, scene: currentName }));
          }}
        >
          <Plus /> {fmt(d.addMissing, { n: missing.length, scene: currentName })}
        </Button>
      )}
    </div>
  );
}
