import { Loader2, RotateCw } from "lucide-react";
import { useState } from "react";
import { create } from "zustand";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/i18n";
import { isTauri, restartApp } from "@/lib/tauri";

const useRestart = create<{ reason: string | null }>(() => ({ reason: null }));

/** Ask to restart Vexcast now (e.g. a newly installed font needs it). */
export function requestRestart(reason: string) {
  useRestart.setState({ reason });
}

export function RestartDialog() {
  const t = useT();
  const r = t.restart;
  const reason = useRestart((s) => s.reason);
  const [busy, setBusy] = useState(false);
  const close = () => useRestart.setState({ reason: null });
  return (
    <Dialog open={!!reason} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCw className="size-5 text-primary" /> {r.title}
          </DialogTitle>
          <DialogDescription>{reason}</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{isTauri() ? r.hint : r.browserHint}</p>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            {r.later}
          </Button>
          {isTauri() && (
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await restartApp();
                setBusy(false);
              }}
            >
              {busy ? <Loader2 className="animate-spin" /> : <RotateCw />}
              {r.now}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
