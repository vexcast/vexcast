import { phoneCamSource, revealPlan, sourceInScene, type PhoneCam } from "@vexcast/protocol";
import { Smartphone, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { fmt } from "@/lib/format";
import { act, useStore } from "@/lib/store";

/** Names the core gives devices that don't say theirs (not worth showing). */
const GENERIC = new Set(["Dispositivo", "Móvil", "App móvil", "Android", "iPhone"]);

/**
 * A phone is sending its camera but the scene on air doesn't show it (not added, or hidden):
 * say so and offer to put it there. One card per phone; "Not now" hides it for that scene.
 */
export function PhoneCamAlert() {
  const t = useT();
  const p = t.phoneCam;
  const cams = useStore((s) => s.phoneCams);
  const state = useStore((s) => s.state);
  const client = useStore((s) => s.client);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  if (!state || !cams.length) return null;

  const scene = state.programSceneUuid;
  const sceneName = state.scenes.find((s) => s.uuid === scene)?.name ?? "";
  const rows = cams
    .map((cam) => {
      const src = phoneCamSource(state.sources, cam.room);
      return { cam, src, status: src ? sourceInScene(state, scene, src.uuid) : ("missing" as const) };
    })
    .filter((r) => r.status !== "visible" && !dismissed.has(`${r.cam.room}:${scene}`));
  if (!rows.length || !scene) return null;

  const fix = async (cam: PhoneCam, srcUuid: string | undefined) => {
    setBusy(cam.room);
    try {
      const cur = useStore.getState().state;
      // Turn on whatever hides it (its item, a hidden group or nested scene), or add it.
      const plan = cur && srcUuid ? revealPlan(cur, scene, srcUuid) : null;
      let ok: unknown;
      if (plan) {
        for (const step of plan) ok = await act((c) => c.updateItem(step.sceneUuid, step.itemId, { visible: true }));
      } else if (srcUuid) ok = await act((c) => c.addSourceToScene(scene, srcUuid));
      else
        ok = await act((c) =>
          c.createSource({
            name: p.sourceName,
            kind: "browser_source",
            settings: { url: `${client?.baseUrl ?? "http://127.0.0.1:7420"}/widgets/phonecam.html?id=${cam.room}`, width: 1280, height: 720, reroute_audio: true, fps_custom: false },
            sceneUuid: scene,
          }),
        );
      if (ok !== undefined) toast.success(fmt(plan ? p.shown : p.added, { scene: sceneName }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="pointer-events-none fixed right-4 bottom-12 z-50 flex w-[380px] max-w-[calc(100vw-2rem)] flex-col gap-2" data-testid="phone-cam-alert">
      {rows.map(({ cam, src, status }) => (
        <div key={cam.room} className="pointer-events-auto flex gap-3 rounded-lg border border-amber-500/40 bg-popover p-3 shadow-lg">
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <Smartphone className="size-4" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div>
              <p className="text-sm leading-snug">{fmt(status === "hidden" ? p.hidden : p.missing, { scene: sceneName })}</p>
              {!GENERIC.has(cam.device) && <p className="text-xs text-muted-foreground">{cam.device}</p>}
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="h-7" disabled={busy === cam.room} onClick={() => fix(cam, src?.uuid)}>
                {status === "hidden" ? p.show : p.add}
              </Button>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => setDismissed((d) => new Set(d).add(`${cam.room}:${scene}`))}>
                {p.dismiss}
              </Button>
            </div>
          </div>
          <button
            type="button"
            className="self-start text-muted-foreground hover:text-foreground"
            aria-label={p.dismiss}
            onClick={() => setDismissed((d) => new Set(d).add(`${cam.room}:${scene}`))}
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
