import type { Property } from "@vexcast/protocol";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/i18n";
import { confirmDialog, useDialogs } from "@/lib/dialogs";
import { fmt } from "@/lib/format";
import { errorMessage, useStore } from "@/lib/store";
import { toast } from "sonner";
import { LiveTextBinding, ThemeFontNotice } from "./live-text";
import { PropertiesView } from "./properties-view";

export interface PropsBackend {
  load: () => Promise<Property[]>;
  update: (settings: Record<string, unknown>) => Promise<Property[]>;
  click?: (name: string) => Promise<Property[]>;
  reset?: () => Promise<Property[]>;
}

/** Loads a property schema and keeps it in sync after every change. */
export function usePropertiesEditor(backend: PropsBackend | null, key: string | null) {
  const [props, setProps] = useState<Property[] | null>(null);
  const seq = useRef(0);
  const ref = useRef(backend);
  ref.current = backend;
  useEffect(() => {
    setProps(null);
    if (!ref.current) return;
    const s = ++seq.current;
    ref.current
      .load()
      .then((p) => s === seq.current && setProps(p))
      .catch((e) => toast.error(errorMessage(e)));
  }, [key]);
  const run = useCallback(async (fn: () => Promise<Property[]>) => {
    const s = ++seq.current;
    try {
      const p = await fn();
      if (s === seq.current && Array.isArray(p)) setProps(p);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }, []);
  const onChange = useCallback(
    (name: string, value: unknown) => {
      // Optimistic value so controlled inputs don't jump back.
      setProps((cur) => (cur ? patchValue(cur, name, value) : cur));
      if (ref.current) run(() => ref.current!.update({ [name]: value }));
    },
    [run],
  );
  const onButton = useCallback((name: string) => ref.current?.click && run(() => ref.current!.click!(name)), [run]);
  const reset = useCallback(() => ref.current?.reset && run(() => ref.current!.reset!()), [run]);
  return { props, onChange, onButton, reset, reload: () => ref.current && run(() => ref.current!.load()) };
}

function patchValue(list: Property[], name: string, value: unknown): Property[] {
  return list.map((p) => (p.name === name ? { ...p, value } : p.properties ? { ...p, properties: patchValue(p.properties, name, value) } : p));
}

export function PropertiesDialog() {
  const t = useT();
  const target = useDialogs((d) => d.properties);
  const close = useDialogs((d) => d.close);
  const client = useStore((s) => s.client);
  const source = useStore((s) => (target?.type === "source" ? (s.state?.sources.find((x) => x.uuid === target.uuid) ?? null) : null));
  const sceneSrc = useStore((s) => (target?.type === "source" ? (s.state?.scenes.find((x) => x.uuid === target.uuid) ?? null) : null));
  const transition = useStore((s) => (target?.type === "transition" ? (s.state?.transitions.find((x) => x.uuid === target.uuid) ?? null) : null));
  const snapshot = useRef<Record<string, unknown> | null>(null);

  const backend: PropsBackend | null =
    !target || !client
      ? null
      : target.type === "source"
        ? {
            load: () => client.sourceProperties(target.uuid),
            update: (s) => client.updateSourceSettings(target.uuid, s),
            click: (n) => client.clickSourceButton(target.uuid, n),
            reset: () => client.resetSourceSettings(target.uuid),
          }
        : {
            load: () => client.transitionProperties(target.uuid),
            update: (s) => client.updateTransitionSettings(target.uuid, s),
          };
  const key = target ? `${target.type}:${target.uuid}` : null;
  const { props, onChange, onButton, reset, reload } = usePropertiesEditor(backend, key);

  useEffect(() => {
    snapshot.current = target ? structuredClone((source ?? transition)?.settings ?? {}) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const name = source?.name ?? sceneSrc?.name ?? transition?.name ?? "";
  const cancel = async () => {
    if (target && client && snapshot.current) {
      const snap = snapshot.current;
      try {
        if (target.type === "source") await client.updateSourceSettings(target.uuid, snap);
        else await client.updateTransitionSettings(target.uuid, snap);
      } catch {
        /* ignore */
      }
    }
    close("properties");
  };
  const showPreview = target?.type === "source" && source?.video && source.width > 0;

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && cancel()}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-3xl" data-testid="properties-dialog">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>{fmt(t.props.title, { name })}</DialogTitle>
          <DialogDescription className="sr-only">{source?.kindName ?? transition?.kindName ?? ""}</DialogDescription>
        </DialogHeader>
        {showPreview && client && (
          <div className="flex h-56 shrink-0 items-center justify-center border-b bg-muted/40 p-3">
            <div className="checkerboard relative h-full overflow-hidden rounded-sm ring-1 ring-border" style={{ aspectRatio: `${source!.width} / ${source!.height}`, maxWidth: "100%" }}>
              <img src={client.previewUrl({ source: source!.uuid })} alt="" className="absolute inset-0 size-full object-contain" />
            </div>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="px-6 py-5">
            {source && <ThemeFontNotice source={source} onChanged={() => setTimeout(() => reload(), 800)} />}
            {source && <LiveTextBinding source={source} onChanged={() => setTimeout(() => reload(), 1500)} />}
            {!props ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> {t.props.loading}
              </div>
            ) : props.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">{t.props.noProps}</p>
            ) : (
              <PropertiesView properties={props} onChange={onChange} onButton={onButton} />
            )}
          </div>
        </div>
        <DialogFooter className="border-t px-6 py-3 sm:justify-between">
          <Button
            variant="outline"
            disabled={target?.type !== "source"}
            onClick={async () => {
              if (await confirmDialog({ title: t.props.defaultsConfirm, confirmLabel: t.props.defaults })) reset();
            }}
          >
            {t.props.defaults}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={cancel}>
              {t.common.cancel}
            </Button>
            <Button onClick={() => close("properties")} data-testid="properties-ok">
              {t.ok}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
