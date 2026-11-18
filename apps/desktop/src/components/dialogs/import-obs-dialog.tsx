import { FileJson, FolderOpen, Loader2, Package } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/i18n";
import { useDialogs } from "@/lib/dialogs";
import { fmt } from "@/lib/format";
import { act, useStore } from "@/lib/store";
import { isTauri, pickFile, pickFolder } from "@/lib/tauri";
import { cn } from "@/lib/utils";

type Found = { name: string; path: string; app: "obs" | "streamlabs" };

/** Import a scene collection (OBS Studio / Streamlabs Desktop) or install an overlay theme pack. */
export function ImportObsDialog() {
  const t = useT();
  const i = t.importObs;
  const open = useDialogs((d) => d.importObs);
  const close = useDialogs((d) => d.close);
  const client = useStore((s) => s.client);
  const [tab, setTab] = useState<"collection" | "theme">("collection");
  const [found, setFound] = useState<Found[] | null>(null);
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [themePath, setThemePath] = useState("");
  const [themeName, setThemeName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !client) return;
    setFound(null);
    setPath("");
    setName("");
    setThemePath("");
    setThemeName("");
    client
      .obsCollections()
      .then(setFound)
      .catch(() => setFound([]));
  }, [open, client]);

  const submit = async () => {
    setBusy(true);
    const r =
      tab === "collection"
        ? path.trim()
          ? await act((c) => c.importObsCollection(path.trim(), name.trim() || undefined))
          : undefined
        : themePath.trim()
          ? await act((c) => c.installTheme(themePath.trim(), themeName.trim() || undefined))
          : undefined;
    setBusy(false);
    if (r) {
      toast.success(fmt(tab === "collection" ? i.success : i.themeSuccess, { name: r.name }));
      close("importObs");
    }
  };

  const canSubmit = !busy && (tab === "collection" ? !!path.trim() : !!themePath.trim());

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close("importObs")}>
      <DialogContent className="sm:max-w-xl" data-testid="import-obs-dialog">
        <DialogHeader>
          <DialogTitle>{i.title}</DialogTitle>
          <DialogDescription>{tab === "collection" ? i.desc : i.themeDesc}</DialogDescription>
        </DialogHeader>
        <Tabs className="min-w-0" value={tab} onValueChange={(v) => setTab(v as "collection" | "theme")}>
          <TabsList className="w-full">
            <TabsTrigger value="collection">
              <FileJson /> {i.tabCollection}
            </TabsTrigger>
            <TabsTrigger value="theme" data-testid="import-tab-theme">
              <Package /> {i.tabTheme}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="collection" className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-4">
            <div className="grid gap-2">
              <Label>{i.found}</Label>
              <ScrollArea className="h-56 rounded-md border">
                <ul className="p-1">
                  {found == null && (
                    <li className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                    </li>
                  )}
                  {found?.length === 0 && <li className="py-6 text-center text-sm text-muted-foreground">{i.none}</li>}
                  {found?.map((c) => (
                    <li
                      key={c.path}
                      onClick={() => {
                        setPath(c.path);
                        setName(c.name);
                      }}
                      onDoubleClick={submit}
                      className={cn("flex cursor-default items-center gap-2.5 rounded-sm px-2 py-1.5 hover:bg-accent/60", path === c.path && "bg-accent")}
                    >
                      <FileJson className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{c.name}</span>
                          <Badge variant={c.app === "streamlabs" ? "secondary" : "outline"} className="shrink-0">
                            {i.apps[c.app]}
                          </Badge>
                        </div>
                        <div className="truncate font-mono text-[11px] text-muted-foreground">{c.path}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="obs-path">{i.path}</Label>
              <div className="flex gap-1.5">
                <Input id="obs-path" value={path} onChange={(e) => setPath(e.target.value)} className="font-mono text-xs" placeholder="C:\Users\…\obs-studio\basic\scenes\Untitled.json" />
                <Button
                  variant="outline"
                  disabled={!isTauri()}
                  onClick={async () => {
                    const p = await pickFile([{ name: i.jsonFilter, extensions: ["json"] }], found?.[0]?.path);
                    if (p) setPath(p);
                  }}
                >
                  <FolderOpen /> {t.props.browse}
                </Button>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="obs-name">{i.name}</Label>
              <Input id="obs-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          </TabsContent>

          <TabsContent value="theme" className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-4">
            <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{i.themeHint}</p>
            <div className="grid gap-2">
              <Label htmlFor="theme-path">{i.themePath}</Label>
              <Input id="theme-path" value={themePath} onChange={(e) => setThemePath(e.target.value)} className="font-mono text-xs" placeholder="E:\Descargas\Mi tema.overlay · https://…/overlay.vxoverlay" data-testid="theme-path" />
              <div className="flex flex-wrap gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!isTauri()}
                  onClick={async () => {
                    const p = await pickFile([{ name: i.themeFilter, extensions: ["vxoverlay", "overlay", "json", "zip"] }]);
                    if (p) setThemePath(p);
                  }}
                >
                  <FileJson /> {i.pickThemeFile}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!isTauri()}
                  onClick={async () => {
                    const p = await pickFolder();
                    if (p) setThemePath(p);
                  }}
                >
                  <FolderOpen /> {i.pickThemeFolder}
                </Button>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="theme-name">{i.name}</Label>
              <Input id="theme-name" value={themeName} onChange={(e) => setThemeName(e.target.value)} />
            </div>
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button variant="outline" onClick={() => close("importObs")}>
            {t.common.cancel}
          </Button>
          <Button onClick={submit} disabled={!canSubmit} data-testid="import-submit">
            {busy && <Loader2 className="animate-spin" />}
            {tab === "collection" ? i.import : i.install}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
