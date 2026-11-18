import { Minus, Plus, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/i18n";
import { useCatalogEntry } from "@/lib/catalog";
import { confirmDialog, openDialog, promptDialog } from "@/lib/dialogs";
import { fmt } from "@/lib/format";
import { act, useAppState } from "@/lib/store";
import { Dock, ToolButton } from "./dock";

export function TransitionsDock() {
  const t = useT();
  const transitions = useAppState((s) => s.transitions);
  const currentId = useAppState((s) => s.currentTransitionUuid);
  const duration = useAppState((s) => s.transitionDurationMs);
  const types = useCatalogEntry("transitionTypes");
  const current = transitions.find((x) => x.uuid === currentId) ?? null;
  const [dur, setDur] = useState(String(duration));
  useEffect(() => setDur(String(duration)), [duration]);

  const add = async (kind: string, name: string) => {
    const n = await promptDialog({ title: t.transitions.add, label: t.transitions.name, defaultValue: name });
    if (!n?.trim()) return;
    const tr = await act((c) => c.addTransition(kind, n.trim()));
    if (tr) {
      await act((c) => c.setCurrentTransition(tr.uuid));
      openDialog("properties", { type: "transition", uuid: tr.uuid });
    }
  };

  const commitDur = () => {
    const ms = Math.max(50, Math.min(20000, Math.round(Number(dur))));
    if (Number.isFinite(ms) && ms !== duration) act((c) => c.setTransitionDuration(ms));
    else setDur(String(duration));
  };

  return (
    <Dock title={t.docks.transitions} testId="dock-transitions">
      <div className="flex flex-col gap-3 p-2.5">
        <div className="flex flex-wrap items-center gap-1">
          <Select value={currentId ?? undefined} onValueChange={(v) => act((c) => c.setCurrentTransition(v))}>
            <SelectTrigger size="sm" className="min-w-28 flex-1" data-testid="transition-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {transitions.map((tr) => (
                <SelectItem key={tr.uuid} value={tr.uuid}>
                  {tr.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <ToolButton icon={Plus} label={t.transitions.add} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {(types ?? [])
                .filter((x) => x.id !== "cut_transition" && x.id !== "fade_transition")
                .map((ty) => (
                  <DropdownMenuItem key={ty.id} onSelect={() => add(ty.id, ty.name)}>
                    {ty.name}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <ToolButton
            icon={Minus}
            label={t.transitions.remove}
            disabled={!current || current.fixed}
            onClick={async () => {
              if (current && (await confirmDialog({ title: fmt(t.transitions.removeConfirm, { name: current.name }), destructive: true, confirmLabel: t.common.delete })))
                act((c) => c.removeTransition(current.uuid));
            }}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <ToolButton icon={Settings} label={t.transitions.config} disabled={!current} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={!current || current.fixed} onSelect={() => current && openDialog("properties", { type: "transition", uuid: current.uuid })}>
                {t.transitions.properties}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!current || current.fixed}
                onSelect={async () => {
                  if (!current) return;
                  const n = await promptDialog({ title: t.transitions.rename, label: t.transitions.name, defaultValue: current.name });
                  if (n?.trim()) act((c) => c.renameTransition(current.uuid, n.trim()));
                }}
              >
                {t.transitions.rename}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="tr-duration" className="text-xs text-muted-foreground">
            {t.transitions.duration}
          </Label>
          <div className="relative ml-auto w-28">
            <Input
              id="tr-duration"
              type="number"
              min={50}
              max={20000}
              step={50}
              value={dur}
              disabled={current?.kind === "cut_transition"}
              onChange={(e) => setDur(e.target.value)}
              onBlur={commitDur}
              onKeyDown={(e) => e.key === "Enter" && commitDur()}
              className="h-8 pr-9 text-right tabular-nums"
            />
            <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">ms</span>
          </div>
        </div>
      </div>
    </Dock>
  );
}
