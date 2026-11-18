import { LiveTextBinding, ThemeFontNotice } from "@/components/properties/live-text";
/** Live panels bound to the selected scene item: Properties and Filters (OBS 30-style docks). */
import { ExternalLink, Loader2, MousePointerClick } from "lucide-react";
import { FiltersEditor } from "@/components/dialogs/filters-dialog";
import { usePropertiesEditor } from "@/components/properties/properties-dialog";
import { PropertiesView } from "@/components/properties/properties-view";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/i18n";
import { openDialog } from "@/lib/dialogs";
import { iconForKind } from "@/lib/obs";
import { findItem, useEditingScene, useStore } from "@/lib/store";

function useSelectedSource() {
  const scene = useEditingScene();
  const first = useStore((s) => s.selection[0] ?? null);
  const item = first != null ? findItem(scene, first) : null;
  const source = useStore((s) => (item ? (s.state?.sources.find((x) => x.uuid === item.sourceUuid) ?? null) : null));
  return { item, source };
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
      <MousePointerClick className="size-6" />
      {text}
    </div>
  );
}

function Header({ name, kind, onOpen, label }: { name: string; kind: string; onOpen: () => void; label: string }) {
  const Icon = iconForKind(kind);
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium" title={name}>
        {name}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="size-7 text-muted-foreground" onClick={onOpen} aria-label={label}>
            <ExternalLink />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </div>
  );
}

export function SourcePropertiesPanel() {
  const t = useT();
  const client = useStore((s) => s.client);
  const { item, source } = useSelectedSource();
  const uuid = source?.uuid ?? null;
  const { props, onChange, onButton, reload } = usePropertiesEditor(
    uuid && client
      ? {
          load: () => client.sourceProperties(uuid),
          update: (s) => client.updateSourceSettings(uuid, s),
          click: (n) => client.clickSourceButton(uuid, n),
          reset: () => client.resetSourceSettings(uuid),
        }
      : null,
    uuid,
  );
  if (!item) return <Empty text={t.workspace.noSelection} />;
  if (item.isGroup || !source) return <Empty text={t.workspace.group} />;
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="panel-properties">
      <Header name={source.name} kind={source.kind} label={t.workspace.openDialog} onOpen={() => openDialog("properties", { type: "source", uuid: source.uuid })} />
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-3">
          <ThemeFontNotice source={source} onChanged={() => setTimeout(() => reload(), 800)} />
          <LiveTextBinding source={source} onChanged={() => setTimeout(() => reload(), 1500)} />
          {!props ? (
            <div className="grid gap-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-8 flex-1" />
                </div>
              ))}
              <span className="sr-only">
                <Loader2 /> {t.props.loading}
              </span>
            </div>
          ) : props.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t.props.noProps}</p>
          ) : (
            <PropertiesView properties={props} onChange={onChange} onButton={onButton} labelWidth="w-28" />
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export function FilterPanel() {
  const t = useT();
  const { item, source } = useSelectedSource();
  if (!item) return <Empty text={t.workspace.noSelection} />;
  const uuid = source?.uuid ?? item.sourceUuid;
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="panel-filters">
      <Header name={source?.name ?? item.name} kind={source?.kind ?? "group"} label={t.workspace.openDialog} onOpen={() => openDialog("filters", uuid)} />
      <div className="flex min-h-0 flex-1">
        <FiltersEditor uuid={uuid} compact />
      </div>
    </div>
  );
}
