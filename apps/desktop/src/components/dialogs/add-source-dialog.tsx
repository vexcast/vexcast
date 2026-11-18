import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useT } from "@/i18n";
import { useCatalogEntry } from "@/lib/catalog";
import { openDialog, useDialogs } from "@/lib/dialogs";
import { fmt } from "@/lib/format";
import { iconForKind, sourceIcon } from "@/lib/obs";
import { act, api, editingSceneUuid, findScene, flattenItems, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

/** OBS "Create new / Add existing" dialog for a source type. */
export function AddSourceDialog() {
  const t = useT();
  const kind = useDialogs((d) => d.addSource);
  const close = useDialogs((d) => d.close);
  const types = useCatalogEntry("sourceTypes");
  const state = useStore((s) => s.state);
  const type = types?.find((x) => x.id === kind) ?? null;
  const isScene = type?.kind === "scene";
  const sceneUuid = state ? editingSceneUuid(state) : null;

  const existing = useMemo(() => {
    if (!state || !kind) return [] as { uuid: string; name: string; kind: string }[];
    if (isScene) return state.scenes.filter((s) => s.uuid !== sceneUuid).map((s) => ({ uuid: s.uuid, name: s.name, kind: "scene" }));
    return state.sources.filter((s) => s.kind === kind).map((s) => ({ uuid: s.uuid, name: s.name, kind: s.kind }));
  }, [state, kind, isScene, sceneUuid]);

  const [mode, setMode] = useState<"new" | "existing">("new");
  const [name, setName] = useState("");
  const [visible, setVisible] = useState(true);
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!kind || !state) return;
    const taken = new Set([...state.sources.map((s) => s.name), ...state.scenes.map((s) => s.name)]);
    const base = type?.name ?? kind;
    let n = base;
    for (let i = 2; taken.has(n); i++) n = `${base} ${i}`;
    setName(n);
    setMode("new");
    setPick(null);
    setVisible(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, type?.name]);

  const taken = !!state && mode === "new" && [...state.sources.map((s) => s.name), ...state.scenes.map((s) => s.name)].includes(name.trim());

  const hideNewItem = async (sourceUuid: string) => {
    if (visible || !sceneUuid) return;
    let st = useStore.getState().state!;
    let item = flattenItems(findScene(st, sceneUuid)?.items ?? []).filter((i) => i.sourceUuid === sourceUuid).pop();
    if (!item) {
      st = await api().getState();
      item = flattenItems(findScene(st, sceneUuid)?.items ?? []).filter((i) => i.sourceUuid === sourceUuid).pop();
    }
    if (item) await act((c) => c.updateItem(sceneUuid, item.id, { visible: false }));
  };

  const submit = async () => {
    if (!kind || !sceneUuid) return;
    setBusy(true);
    try {
      if (mode === "existing") {
        if (!pick) return;
        const r = await act((c) => c.addSourceToScene(sceneUuid, pick));
        if (r && !visible) await act((c) => c.updateItem(sceneUuid, r.id, { visible: false }));
        close("addSource");
        return;
      }
      if (isScene) {
        const sc = await act((c) => c.createScene(name.trim()));
        if (sc) await act((c) => c.addSourceToScene(sceneUuid, sc.uuid));
        close("addSource");
        return;
      }
      const src = await act((c) => c.createSource({ name: name.trim(), kind, sceneUuid }));
      if (!src) return;
      await hideNewItem(src.uuid);
      close("addSource");
      openDialog("properties", { type: "source", uuid: src.uuid });
    } finally {
      setBusy(false);
    }
  };

  const TypeIcon = sourceIcon(type?.icon);
  return (
    <Dialog open={!!kind} onOpenChange={(o) => !o && close("addSource")}>
      <DialogContent className="sm:max-w-md" data-testid="add-source-dialog">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TypeIcon className="size-4 text-muted-foreground" />
              {fmt(t.sources.addTitle, { type: type?.name ?? kind ?? "" })}
            </DialogTitle>
            <DialogDescription className="sr-only">{t.sources.createNew}</DialogDescription>
          </DialogHeader>
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as "new" | "existing")} className="gap-3">
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="new" id="as-new" />
                <Label htmlFor="as-new">{t.sources.createNew}</Label>
              </div>
              <Input value={name} onChange={(e) => setName(e.target.value)} disabled={mode !== "new"} autoFocus aria-invalid={taken} className="ml-6 w-[calc(100%-1.5rem)]" data-testid="add-source-name" />
              {taken && <p className="ml-6 text-xs text-destructive">{t.sources.nameExists}</p>}
            </div>
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="existing" id="as-existing" disabled={!existing.length} />
                <Label htmlFor="as-existing" className={cn(!existing.length && "text-muted-foreground")}>
                  {t.sources.addExisting}
                </Label>
              </div>
              <ScrollArea className="ml-6 h-36 rounded-md border">
                <ul className="p-1">
                  {existing.length === 0 && <li className="px-2 py-3 text-center text-xs text-muted-foreground">{t.sources.noExisting}</li>}
                  {existing.map((s) => {
                    const Icon = iconForKind(s.kind);
                    return (
                      <li
                        key={s.uuid}
                        onClick={() => {
                          setMode("existing");
                          setPick(s.uuid);
                        }}
                        className={cn("flex h-7 cursor-default items-center gap-2 rounded-sm px-2 text-sm hover:bg-accent/60", mode === "existing" && pick === s.uuid && "bg-accent")}
                      >
                        <Icon className="size-3.5 text-muted-foreground" />
                        <span className="truncate">{s.name}</span>
                      </li>
                    );
                  })}
                </ul>
              </ScrollArea>
            </div>
          </RadioGroup>
          <div className="flex items-center gap-2">
            <Checkbox id="as-visible" checked={visible} onCheckedChange={(v) => setVisible(!!v)} />
            <Label htmlFor="as-visible" className="font-normal">
              {t.sources.makeVisible}
            </Label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close("addSource")}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={busy || (mode === "new" ? !name.trim() || taken : !pick)} data-testid="add-source-ok">
              {t.ok}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
