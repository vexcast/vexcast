import { Coffee, Download, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useT } from "@/i18n";
import { useDialogs } from "@/lib/dialogs";
import { fmt } from "@/lib/format";
import { renderMarkdown } from "@/lib/markdown";
import { GitHubIcon, VexcastMark } from "@/lib/platforms";
import { useStore } from "@/lib/store";
import { canSelfUpdate, GITHUB_URL, isTauri, KOFI_URL, openExternal, RELEASES_URL } from "@/lib/tauri";
import { installTauriUpdate } from "@/lib/updater";

type Phase = "download" | "install" | "restart";

/** Shared "install update" flow: Tauri updater with progress, else open the release page. */
export function useUpdateInstaller() {
  const t = useT();
  const releaseUrl = useStore((s) => s.state?.update.releaseUrl ?? null);
  const [progress, setProgress] = useState<{ p: number | null; phase: Phase } | null>(null);
  const install = async () => {
    if (!isTauri() || !(await canSelfUpdate())) {
      openExternal(releaseUrl ?? RELEASES_URL);
      return;
    }
    try {
      setProgress({ p: 0, phase: "download" });
      const ok = await installTauriUpdate((p, phase) => setProgress({ p, phase }));
      if (!ok) {
        setProgress(null);
        toast(t.update.upToDate);
      }
    } catch (e) {
      setProgress(null);
      toast.error(fmt(t.update.failed, { error: e instanceof Error ? e.message : String(e) }));
    }
  };
  return { install, progress };
}

function UpdateProgress({ progress }: { progress: { p: number | null; phase: Phase } }) {
  const t = useT();
  const label = progress.phase === "download" ? t.update.downloading : progress.phase === "install" ? t.update.installing : t.update.restarting;
  return (
    <div className="flex min-w-56 items-center gap-3">
      <Progress value={progress.p == null ? 50 : Math.round(progress.p * 100)} className="h-1.5 flex-1" />
      <span className="text-xs whitespace-nowrap text-muted-foreground">
        {label} {progress.p != null && progress.phase === "download" ? `${Math.round(progress.p * 100)}%` : ""}
      </span>
    </div>
  );
}

export function UpdateBanner() {
  const t = useT();
  const update = useStore((s) => s.state?.update);
  const dismissed = useStore((s) => s.updateDismissed);
  const dismiss = useStore((s) => s.dismissUpdate);
  const open = useDialogs((d) => d.open);
  const { install, progress } = useUpdateInstaller();
  if (!update?.updateAvailable || dismissed) return null;
  return (
    <div className="flex h-10 shrink-0 items-center gap-3 border-b bg-muted/50 px-3 text-sm" data-testid="update-banner">
      <Download className="size-4 text-muted-foreground" />
      <span className="font-medium">{fmt(t.update.available, { version: update.latestVersion ?? "" })}</span>
      <span className="hidden text-muted-foreground lg:inline">{t.update.desc}</span>
      <div className="ml-auto flex items-center gap-1.5">
        {progress ? (
          <UpdateProgress progress={progress} />
        ) : (
          <>
            <Button size="sm" variant="ghost" className="h-7" onClick={() => open("releaseNotes", true)}>
              {t.update.notes}
            </Button>
            <Button size="sm" className="h-7" onClick={install}>
              {t.update.install}
            </Button>
          </>
        )}
        <Button size="icon-sm" variant="ghost" className="size-7" onClick={dismiss} aria-label={t.common.close}>
          <X />
        </Button>
      </div>
    </div>
  );
}

export function ReleaseNotesDialog() {
  const t = useT();
  const open = useDialogs((d) => d.releaseNotes);
  const close = useDialogs((d) => d.close);
  const update = useStore((s) => s.state?.update);
  const { install, progress } = useUpdateInstaller();
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
          {progress ? (
            <UpdateProgress progress={progress} />
          ) : (
            <>
              <Button variant="outline" onClick={() => close("releaseNotes")}>
                {t.common.close}
              </Button>
              {update.updateAvailable && <Button onClick={install}>{t.update.install}</Button>}
            </>
          )}
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
