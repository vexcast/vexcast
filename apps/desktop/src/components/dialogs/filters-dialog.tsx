import type { FilterInfo, SourceType } from "@vexcast/protocol";
import { ArrowDown, ArrowUp, Eye, EyeOff, Loader2, Minus, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { PropertiesView } from "@/components/properties/properties-view";
import { usePropertiesEditor } from "@/components/properties/properties-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { InlineRename } from "@/components/docks/dock";
import { useT } from "@/i18n";
import { confirmDialog, promptDialog, useDialogs } from "@/lib/dialogs";
import { fmt } from "@/lib/format";
import { act, findScene, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

type Section = "av" | "effect";
const sectionOf = (ty: SourceType | undefined): Section => (!ty ? "effect" : ty.audio || ty.async ? "av" : "effect");

export function FiltersDialog() {
  const t = useT();
  const uuid = useDialogs((d) => d.filters);
  const close = useDialogs((d) => d.close);
  const name = useStore((s) => (uuid && s.state ? (s.state.sources.find((x) => x.uuid === uuid)?.name ?? findScene(s.state, uuid)?.name ?? "") : ""));
  return (
    <Dialog open={!!uuid} onOpenChange={(o) => !o && close("filters")}>
      <DialogContent className="flex h-[85vh] max-h-[760px] flex-col gap-0 p-0 sm:max-w-5xl" data-testid="filters-dialog">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>{fmt(t.filters.title, { name })}</DialogTitle>
          <DialogDescription className="sr-only">{t.filters.select}</DialogDescription>
        </DialogHeader>
        <FiltersEditor uuid={uuid} />
        <DialogFooter className="border-t px-6 py-3">
          <Button onClick={() => close("filters")}>{t.common.close}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Filters list + properties of the selected filter (dialog and dock panel). */
export function FiltersEditor({ uuid, compact }: { uuid: string | null; compact?: boolean }) {
  const t = useT();
  const client = useStore((s) => s.client);
  const source = useStore((s) => (uuid ? (s.state?.sources.find((x) => x.uuid === uuid) ?? null) : null));
  const scene = useStore((s) => (uuid && s.state ? findScene(s.state, uuid) : null));
  const filters: FilterInfo[] = source?.filters ?? scene?.filters ?? [];
  const [types, setTypes] = useState<SourceType[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  useEffect(() => {
    setSelected(null);
    if (!uuid || !client) return;
    client
      .filterTypes(uuid)
      .then(setTypes)
      .catch(() => setTypes([]));
  }, [uuid, client]);
  useEffect(() => {
    if (selected && !filters.some((f) => f.uuid === selected)) setSelected(null);
    if (!selected && filters.length) setSelected(filters[0].uuid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.map((f) => f.uuid).join()]);

  const typeOf = (kind: string) => types.find((x) => x.id === kind);
  const sel = filters.find((f) => f.uuid === selected) ?? null;
  const { props, onChange, onButton } = usePropertiesEditor(
    uuid && sel && client
      ? {
          load: () => client.filterProperties(uuid, sel.uuid),
          update: (s) => client.updateFilterSettings(uuid, sel.uuid, s),
          click: (n) => client.clickFilterButton(uuid, sel.uuid, n),
        }
      : null,
    sel ? sel.uuid : null,
  );

  const add = async (ty: SourceType) => {
    if (!uuid) return;
    const taken = filters.map((f) => f.name);
    let def = ty.name;
    for (let i = 2; taken.includes(def); i++) def = `${ty.name} ${i}`;
    const name = await promptDialog({ title: t.filters.nameTitle, label: t.sources.name, defaultValue: def });
    if (!name?.trim()) return;
    const r = await act((c) => c.addFilter(uuid, ty.id, name.trim()));
    if (r) setSelected(r.uuid);
  };

  const move = (f: FilterInfo, dir: -1 | 1) => {
    if (!uuid) return;
    const sec = sectionOf(typeOf(f.kind));
    const ids = filters.map((x) => x.uuid);
    const i = ids.indexOf(f.uuid);
    let j = i + dir;
    while (j >= 0 && j < filters.length && sectionOf(typeOf(filters[j].kind)) !== sec) j += dir;
    if (j < 0 || j >= filters.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    act((c) => c.reorderFilters(uuid, ids));
  };

  const showPreview = !!source?.video && source.width > 0;

  const list = (section: Section) => {
    const items = filters.filter((f) => sectionOf(typeOf(f.kind)) === section);
    const addable = types.filter((ty) => !ty.deprecated && sectionOf(ty) === section);
    const selInSection = sel && sectionOf(typeOf(sel.kind)) === section ? sel : null;
    if (section === "av" && !addable.length && !items.length) return null;
    if (section === "effect" && !addable.length && !items.length) return null;
    return (
      <div className="flex min-h-0 flex-1 flex-col rounded-md border">
        <div className="border-b px-2.5 py-1.5 text-xs font-medium text-muted-foreground">{section === "av" ? t.filters.avFilters : t.filters.effectFilters}</div>
        <ScrollArea className="min-h-0 flex-1">
          <ul className="flex flex-col gap-px p-1">
            {items.length === 0 && <li className="px-2 py-3 text-center text-xs text-muted-foreground">{t.filters.empty}</li>}
            {items.map((f) => (
              <li
                key={f.uuid}
                onClick={() => setSelected(f.uuid)}
                onDoubleClick={() => setRenaming(f.uuid)}
                className={cn("flex h-7 cursor-default items-center gap-1.5 rounded-sm pr-1 pl-1 text-sm hover:bg-accent/60", selected === f.uuid && "bg-accent", !f.enabled && "text-muted-foreground")}
                data-testid={`filter-${f.name}`}
              >
                <button
                  className="grid size-6 shrink-0 place-items-center rounded-sm text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    uuid && act((c) => c.updateFilter(uuid, f.uuid, { enabled: !f.enabled }));
                  }}
                  aria-label={t.sources.toggleVisible}
                >
                  {f.enabled ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                </button>
                {renaming === f.uuid ? (
                  <InlineRename
                    value={f.name}
                    onDone={(v) => {
                      setRenaming(null);
                      if (v && v !== f.name && uuid) act((c) => c.updateFilter(uuid, f.uuid, { name: v }));
                    }}
                  />
                ) : (
                  <span className="truncate">{f.name}</span>
                )}
              </li>
            ))}
          </ul>
        </ScrollArea>
        <div className="flex items-center gap-0.5 border-t p-1">
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={t.filters.add} disabled={!addable.length} data-testid={`filter-add-${section}`}>
                    <Plus />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>{t.filters.add}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-y-auto">
              {addable.map((ty) => (
                <DropdownMenuItem key={ty.id} onSelect={() => add(ty)}>
                  {ty.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t.filters.remove}
            disabled={!selInSection}
            onClick={async () => {
              if (selInSection && uuid && (await confirmDialog({ title: fmt(t.filters.removeConfirm, { name: selInSection.name }), confirmLabel: t.common.delete, destructive: true })))
                act((c) => c.removeFilter(uuid, selInSection.uuid));
            }}
          >
            <Minus />
          </Button>
          <span className="flex-1" />
          <Button variant="ghost" size="icon-sm" aria-label={t.sources.moveUp} disabled={!selInSection} onClick={() => selInSection && move(selInSection, -1)}>
            <ArrowUp />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={t.sources.moveDown} disabled={!selInSection} onClick={() => selInSection && move(selInSection, 1)}>
            <ArrowDown />
          </Button>
        </div>
      </div>
    );
  };

  return (
        <div className="flex min-h-0 flex-1">
          <div className={cn("flex shrink-0 flex-col gap-3 border-r p-3", compact ? "w-44" : "w-64")}>
            {list("av")}
            {list("effect")}
            {!types.length && !filters.length && <p className="p-2 text-sm text-muted-foreground">{t.filters.none}</p>}
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            {showPreview && !compact && client && uuid && (
              <div className="flex h-60 shrink-0 items-center justify-center border-b bg-muted/40 p-3">
                <div className="checkerboard relative h-full overflow-hidden rounded-sm ring-1 ring-border" style={{ aspectRatio: `${source!.width} / ${source!.height}`, maxWidth: "100%" }}>
                  <img src={client.previewUrl({ source: uuid })} alt="" className="absolute inset-0 size-full object-contain" />
                </div>
              </div>
            )}
            <ScrollArea className="min-h-0 flex-1">
              <div className={compact ? "p-3" : "p-5"}>
                {!sel ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">{t.filters.select}</p>
                ) : !props ? (
                  <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> {t.props.loading}
                  </div>
                ) : props.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">{t.props.noProps}</p>
                ) : (
                  <PropertiesView properties={props} onChange={onChange} onButton={onButton} labelWidth={compact ? "w-28" : "w-40"} />
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
  );
}
