import { useEffect, useState } from "react";
import { AlertTriangle, Info, X } from "lucide-react";
import { toast } from "sonner";
import type { SystemCheck } from "@vexcast/protocol";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { errorMessage, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const KEY = "vexcast.dismissedChecks";

function dismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

/** Things about the system to act on (macOS screen permission, Wayland, engine errors). */
export function SystemChecksBanner() {
  const t = useT();
  const client = useStore((s) => s.client);
  const ready = useStore((s) => !!s.state?.status.ready);
  const error = useStore((s) => s.state?.status.error ?? null);
  const [checks, setChecks] = useState<SystemCheck[]>([]);
  const [hidden, setHidden] = useState<string[]>(dismissed);
  const load = () => client?.systemChecks().then(setChecks).catch(() => setChecks([]));
  useEffect(() => {
    load();
    // Re-check when the engine comes up or fails.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, ready, error]);
  const hide = (id: string) => {
    const next = [...hidden, id];
    setHidden(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* private mode */
    }
  };
  // Errors can't be dismissed for good: they come back until fixed.
  const visible = checks.filter((c) => c.level === "error" || !hidden.includes(c.id));
  if (!visible.length) return null;
  return (
    <div className="grid shrink-0 border-b" data-testid="system-checks">
      {visible.map((c) => (
        <div key={c.id} className={cn("flex items-start gap-3 px-3 py-2 text-sm", c.level === "error" ? "bg-destructive/10" : c.level === "warn" ? "bg-amber-500/10" : "bg-muted/50")}>
          {c.level === "info" ? <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> : <AlertTriangle className={cn("mt-0.5 size-4 shrink-0", c.level === "error" ? "text-destructive" : "text-amber-500")} />}
          <div className="min-w-0 flex-1">
            <span className="font-medium">{c.title}</span>
            <span className="ml-2 text-muted-foreground">{c.detail}</span>
          </div>
          {c.fix && (
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              onClick={() =>
                client
                  ?.fixSystemCheck(c.id)
                  .then(() => setTimeout(load, 1500))
                  .catch((e) => toast.error(errorMessage(e)))
              }
            >
              {c.fix}
            </Button>
          )}
          {c.level !== "error" && (
            <Button size="icon" variant="ghost" className="size-7" onClick={() => hide(c.id)} aria-label={t.common.close}>
              <X className="size-4" />
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
