import type { SceneItem } from "@vexcast/protocol";
import { ArrowDown, ArrowUp, ChevronRight, Eye, EyeOff, Filter, Lock, LockOpen, Minus, Plus, Search, Settings2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { MenuItems } from "@/components/menu";
import { useAddSourceNodes, useSourceMenu } from "@/components/source-menu";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useT } from "@/i18n";
import { duplicateItems, orderItems, removeItems, selectedItems, updateItem } from "@/lib/actions";
import { openDialog } from "@/lib/dialogs";
import { iconForKind } from "@/lib/obs";
import { act, useEditingScene, useStore } from "@/lib/store";
import { useReorder } from "@/lib/useReorder";
import { cn } from "@/lib/utils";
import { Dock, EmptyHint, InlineRename, ToolButton } from "./dock";
import { EditCanvasSwitch, MissingInVertical } from "@/components/preview/vertical-tools";

function ItemMenu({ item }: { item: SceneItem | null }) {
  return <MenuItems nodes={useSourceMenu(item)} kind="context" />;
}

function AddMenu() {
  return <MenuItems nodes={useAddSourceNodes()} kind="dropdown" />;
}

export function SourcesDock() {
  const t = useT();
  const scene = useEditingScene();
  const vertical = useStore((s) => s.canvas === "vertical" && !!s.state?.video.verticalEnabled);
  const sources = useStore((s) => s.state!.sources);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [query, setQuery] = useState("");

  const top = scene ? [...scene.items].reverse() : [];
  const { rowProps, indicator } = useReorder(
    top.map((i) => i.id),
    (ids) => scene && act((c) => c.reorderItems(scene.uuid, [...ids].reverse())),
  );

  // Visible rows in display order (top-most first, groups expanded).
  const q = query.trim().toLowerCase();
  const match = (it: SceneItem) => !q || it.name.toLowerCase().includes(q);
  const rows: { item: SceneItem; depth: number }[] = [];
  for (const it of top) {
    const kids = it.isGroup && it.items ? [...it.items].reverse() : [];
    const kidMatch = kids.filter(match);
    if (!match(it) && !kidMatch.length) continue;
    rows.push({ item: it, depth: 0 });
    if (kids.length && (q ? true : !collapsed.has(it.id))) for (const c of q ? kidMatch : kids) rows.push({ item: c, depth: 1 });
  }

  const onRowClick = (e: React.MouseEvent, it: SceneItem) => {
    if (e.ctrlKey || e.metaKey) {
      select(selection.includes(it.id) ? selection.filter((x) => x !== it.id) : [...selection, it.id]);
    } else if (e.shiftKey && anchor != null) {
      const ids = rows.map((r) => r.item.id);
      const a = ids.indexOf(anchor);
      const b = ids.indexOf(it.id);
      if (a >= 0 && b >= 0) select(ids.slice(Math.min(a, b), Math.max(a, b) + 1));
    } else {
      select([it.id]);
      setAnchor(it.id);
    }
  };

  const sel = selectedItems();
  const first = sel[0];

  return (
    <Dock
      title={vertical ? `${t.docks.sources} · 9:16` : t.docks.sources}
      testId="dock-sources"
      actions={<EditCanvasSwitch />}
      toolbar={
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <ToolButton icon={Plus} label={t.sources.add} disabled={!scene} testId="source-add" />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-56">
              <AddMenu />
            </DropdownMenuContent>
          </DropdownMenu>
          <ToolButton icon={Minus} label={t.sources.remove} disabled={!sel.length} onClick={() => removeItems(sel)} />
          <ToolButton icon={Settings2} label={t.sources.openProps} disabled={!first || first.isGroup} onClick={() => first && openDialog("properties", { type: "source", uuid: first.sourceUuid })} />
          <ToolButton icon={Filter} label={t.sources.openFilters} disabled={!first} onClick={() => first && openDialog("filters", first.sourceUuid)} />
          <span className="flex-1" />
          <ToolButton icon={ArrowUp} label={t.sources.moveUp} disabled={!sel.length} onClick={() => orderItems(sel, "up")} />
          <ToolButton icon={ArrowDown} label={t.sources.moveDown} disabled={!sel.length} onClick={() => orderItems(sel, "down")} />
        </>
      }
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="flex h-full min-h-0 flex-col">
          <div className="relative shrink-0 border-b p-1.5">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQuery("")}
              placeholder={t.sources.search}
              className="h-7 pl-7 text-xs"
              data-testid="sources-search"
            />
          </div>
          <ScrollArea className="min-h-0 flex-1" onClick={(e) => e.target === e.currentTarget && select([])}>
            {!scene ? (
              <EmptyHint title={t.sources.noScene} />
            ) : rows.length === 0 ? (
              <EmptyHint title={t.sources.empty} hint={t.sources.emptyHint} />
            ) : (
              <ul className="flex flex-col gap-px p-1" role="tree" aria-multiselectable>
                {rows.map(({ item: it, depth }) => {
                  const src = sources.find((s) => s.uuid === it.sourceUuid);
                  const Icon = iconForKind(it.isGroup ? "group" : (src?.kind ?? ""));
                  const isSel = selection.includes(it.id);
                  const ind = depth === 0 ? indicator(it.id) : null;
                  return (
                    <ContextMenu key={it.id}>
                      <ContextMenuTrigger asChild>
                        <li
                          {...(depth === 0 ? rowProps(it.id) : {})}
                          role="treeitem"
                          aria-selected={isSel}
                          tabIndex={0}
                          data-testid={`source-${it.name}`}
                          onClick={(e) => onRowClick(e, it)}
                          onContextMenu={(e) => {
                            e.stopPropagation();
                            if (!selection.includes(it.id)) select([it.id]);
                          }}
                          onDoubleClick={() => !it.isGroup && openDialog("properties", { type: "source", uuid: it.sourceUuid })}
                          onKeyDown={(e) => {
                            if (e.key === "F2") setRenaming(it.id);
                            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
                              e.preventDefault();
                              e.stopPropagation();
                              duplicateItems(selection.includes(it.id) ? selectedItems() : [it]);
                            }
                          }}
                          className={cn(
                            "group/row relative flex h-7 cursor-default items-center gap-1.5 rounded-sm pr-1 text-sm outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50",
                            isSel && "bg-accent text-accent-foreground hover:bg-accent",
                            !it.visible && "text-muted-foreground",
                            ind === "before" && "before:absolute before:inset-x-1 before:-top-px before:h-0.5 before:bg-primary",
                            ind === "after" && "after:absolute after:inset-x-1 after:-bottom-px after:h-0.5 after:bg-primary",
                          )}
                          style={{ paddingLeft: 6 + depth * 18 }}
                        >
                          {it.isGroup ? (
                            <button
                              className="grid size-4 place-items-center text-muted-foreground"
                              onClick={(e) => {
                                e.stopPropagation();
                                const n = new Set(collapsed);
                                if (n.has(it.id)) n.delete(it.id);
                                else n.add(it.id);
                                setCollapsed(n);
                              }}
                            >
                              <ChevronRight className={cn("size-3.5 transition-transform", !collapsed.has(it.id) && "rotate-90")} />
                            </button>
                          ) : null}
                          <Icon className="size-4 shrink-0 text-muted-foreground" />
                          {renaming === it.id ? (
                            <InlineRename
                              value={it.name}
                              onDone={(v) => {
                                setRenaming(null);
                                if (v && v !== it.name) act((c) => c.updateSource(it.sourceUuid, { name: v }));
                              }}
                            />
                          ) : (
                            <span className="min-w-0 flex-1 truncate" title={it.name}>
                              {it.name}
                            </span>
                          )}
                          <button
                            className={cn("grid size-6 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-background/60 hover:text-foreground", !it.locked && "opacity-0 group-hover/row:opacity-100 group-aria-selected/row:opacity-100")}
                            aria-label={t.sources.toggleLock}
                            data-testid={`lock-${it.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              scene && updateItem(scene.uuid, it.id, { locked: !it.locked });
                            }}
                          >
                            {it.locked ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />}
                          </button>
                          <button
                            className="grid size-6 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-background/60 hover:text-foreground"
                            aria-label={t.sources.toggleVisible}
                            data-testid={`eye-${it.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              scene && updateItem(scene.uuid, it.id, { visible: !it.visible });
                            }}
                          >
                            {it.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                          </button>
                        </li>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="w-60" data-testid="source-context-menu">
                        <RowMenu item={it} onRename={() => setRenaming(it.id)} />
                      </ContextMenuContent>
                    </ContextMenu>
                  );
                })}
              </ul>
            )}
          </ScrollArea>
          <MissingInVertical />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          <ItemMenu item={null} />
        </ContextMenuContent>
      </ContextMenu>
    </Dock>
  );
}

/** Row menu: same as the preview's, but "Rename" edits inline. */
function RowMenu({ item, onRename }: { item: SceneItem; onRename: () => void }) {
  const t = useT();
  const nodes = useSourceMenu(item).map((n) => (n.type === "item" && n.label === t.sources.rename ? { ...n, onSelect: onRename } : n));
  return <MenuItems nodes={nodes} kind="context" />;
}
