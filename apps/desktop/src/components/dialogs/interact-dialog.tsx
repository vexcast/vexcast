import { useRef } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/i18n";
import { useDialogs } from "@/lib/dialogs";
import { useStore } from "@/lib/store";

/** OBS "Interact" window: forwards mouse/keyboard to an interactive source. */
export function InteractDialog() {
  const t = useT();
  const uuid = useDialogs((d) => d.interact);
  const close = useDialogs((d) => d.close);
  const client = useStore((s) => s.client);
  const source = useStore((s) => (uuid ? (s.state?.sources.find((x) => x.uuid === uuid) ?? null) : null));
  const ref = useRef<HTMLDivElement>(null);
  if (!uuid || !client || !source) return <Dialog open={false} />;
  const pos = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: Math.round(((e.clientX - r.left) / r.width) * source.width), y: Math.round(((e.clientY - r.top) / r.height) * source.height) };
  };
  const send = (ev: Record<string, unknown>) => client.interact(uuid, ev).catch(() => {});
  const mods = (e: React.MouseEvent | React.KeyboardEvent) => ({ ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey });
  return (
    <Dialog open onOpenChange={(o) => !o && close("interact")}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {t.sources.interact}: {source.name}
          </DialogTitle>
          <DialogDescription className="sr-only">{t.sources.interact}</DialogDescription>
        </DialogHeader>
        <div
          ref={ref}
          tabIndex={0}
          className="checkerboard relative w-full overflow-hidden rounded-md outline-none ring-1 ring-border focus:ring-2 focus:ring-ring"
          style={{ aspectRatio: `${source.width || 16} / ${source.height || 9}` }}
          onMouseMove={(e) => send({ type: "mouse_move", ...pos(e), ...mods(e) })}
          onMouseDown={(e) => {
            ref.current?.focus();
            send({ type: "mouse_down", button: e.button, ...pos(e), ...mods(e) });
          }}
          onMouseUp={(e) => send({ type: "mouse_up", button: e.button, ...pos(e), ...mods(e) })}
          onWheel={(e) => send({ type: "wheel", dx: Math.round(e.deltaX), dy: Math.round(e.deltaY), ...pos(e), ...mods(e) })}
          onKeyDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            send({ type: "key_down", key: e.key, code: e.code, ...mods(e) });
          }}
          onKeyUp={(e) => send({ type: "key_up", key: e.key, code: e.code, ...mods(e) })}
        >
          <img src={client.previewUrl({ source: uuid })} alt="" draggable={false} className="pointer-events-none absolute inset-0 size-full object-contain" />
        </div>
      </DialogContent>
    </Dialog>
  );
}
