import { Coffee } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useT } from "@/i18n";
import { useDialogs } from "@/lib/dialogs";
import { fmt } from "@/lib/format";
import { renderMarkdown } from "@/lib/markdown";
import { GitHubIcon, VexcastMark } from "@/lib/platforms";
import { useStore } from "@/lib/store";
import { GITHUB_URL, isTauri, KOFI_URL, openExternal, RELEASES_URL } from "@/lib/tauri";
import { openUpdateWindow } from "@/lib/updater";

/** "Install update": the desktop app's update window, or the release page in a browser. */
export function useUpdateInstaller() {
  const t = useT();
  const releaseUrl = useStore((s) => s.state?.update.releaseUrl ?? null);
  return async () => {
    if (!isTauri()) {
      openExternal(releaseUrl ?? RELEASES_URL);
      return;
    }
    try {
      // The desktop app shows its own update window (download, install and restart happen there).
      if (!(await openUpdateWindow())) toast(t.update.upToDate);
    } catch (e) {
      toast.error(fmt(t.update.failed, { error: e instanceof Error ? e.message : String(e) }));
    }
  };
}

export function ReleaseNotesDialog() {
  const t = useT();
  const open = useDialogs((d) => d.releaseNotes);
  const close = useDialogs((d) => d.close);
  const update = useStore((s) => s.state?.update);
  const install = useUpdateInstaller();
  if (!update) return null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close("releaseNotes")}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{fmt(t.update.notesTitle, { version: update.latestVersion ?? update.currentVersion })}</DialogTitle>
          <DialogDescription>
            {update.currentVersion} → {update.latestVersion ?? "?"}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[50vh] pr-3">
          <div className="prose-notes selectable text-sm" dangerouslySetInnerHTML={{ __html: renderMarkdown(update.releaseNotes || "—") }} />
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={() => close("releaseNotes")}>
            {t.common.close}
          </Button>
          {update.updateAvailable && <Button onClick={() => { close("releaseNotes"); install(); }}>{t.update.install}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AboutDialog() {
  const t = useT();
  const open = useDialogs((d) => d.about);
  const close = useDialogs((d) => d.close);
  const version = useStore((s) => s.state?.version ?? "");
  const obs = useStore((s) => s.state?.status.obsVersion ?? null);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close("about")}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="items-center text-center sm:text-center">
          <VexcastMark size={48} />
          <DialogTitle className="mt-2 text-lg">Vexcast</DialogTitle>
          <DialogDescription>
            {t.about.version} {version}
            {obs ? ` · libobs ${obs}` : ""}
          </DialogDescription>
        </DialogHeader>
        <p className="text-center text-sm text-muted-foreground">{t.about.licenseDesc}</p>
        <Separator />
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="text-sm font-medium">{t.about.supportTitle}</p>
          <p className="text-sm text-muted-foreground">{t.about.supportDesc}</p>
        </div>
        <DialogFooter className="sm:justify-center">
          <Button variant="outline" onClick={() => openExternal(GITHUB_URL)}>
            <GitHubIcon className="size-4" /> {t.about.sourceCode}
          </Button>
          <Button onClick={() => openExternal(KOFI_URL)}>
            <Coffee /> {t.about.supportButton}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
