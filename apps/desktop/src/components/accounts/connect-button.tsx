import type { AccountPlatform, ConnectedAccount, OAuthStart } from "@vexcast/protocol";
import { Copy, ExternalLink, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/i18n";
import { fmt } from "@/lib/format";
import { chatPlatformMeta } from "@/lib/platforms";
import { act, useStore } from "@/lib/store";
import { copyText, openExternal } from "@/lib/tauri";
import { cn } from "@/lib/utils";

// YouTube login is supported by the core but hidden for now (Google requires app verification).
export const ACCOUNT_PLATFORMS: AccountPlatform[] = ["twitch", "kick"];

/** Name, brand color and icon of an account platform. */
export const accountMeta = (p: AccountPlatform) => chatPlatformMeta(p);

/** Live account from the core state (undefined until the core reports it). */
export function useAccount(platform: AccountPlatform): ConnectedAccount | undefined {
  return useStore((s) => s.state?.accounts?.find((a) => a.platform === platform));
}

/**
 * Platform whose account created this destination. The core names account
 * destinations "Twitch · user" / "Kick · user" (see oauth.rs `apply`).
 */
export function linkedPlatform(name: string): AccountPlatform | null {
  for (const p of ACCOUNT_PLATFORMS) if (name.startsWith(`${accountMeta(p).name} · `)) return p;
  return null;
}

/** "https://www.twitch.tv/activate" → "twitch.tv/activate". */
const shortUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

/**
 * "Conectar con Twitch" button. Starts the OAuth login in the core and shows a
 * waiting dialog (device code for Twitch, browser login for Kick/YouTube) until
 * the core reports the account as connected.
 */
export function ConnectAccountButton({ platform, size = "default", className }: { platform: AccountPlatform; size?: "default" | "sm"; className?: string }) {
  const t = useT();
  const a = t.accounts;
  const account = useAccount(platform);
  const meta = accountMeta(platform);
  const Icon = meta.icon;
  const [flow, setFlow] = useState<OAuthStart | null>(null);
  const [starting, setStarting] = useState(false);
  const available = account?.available ?? false;

  const start = async () => {
    setStarting(true);
    const r = await act((c) => c.startLogin(platform));
    setStarting(false);
    if (!r) return;
    setFlow(r);
    if (r.mode === "browser") void openExternal(r.url);
  };

  const button = (
    <Button
      variant="outline"
      size={size}
      className={className}
      disabled={!available || starting}
      onClick={start}
      data-testid={`connect-${platform}`}
    >
      {starting ? (
        <Loader2 className="animate-spin" />
      ) : (
        <span className="inline-flex" style={{ color: available ? meta.color : undefined }}>
          <Icon size={size === "sm" ? 14 : 16} />
        </span>
      )}
      {fmt(a.connectWith, { name: meta.name })}
    </Button>
  );

  return (
    <>
      {available ? (
        button
      ) : (
        // Disabled buttons swallow pointer events: the wrapper carries the hint.
        <span className={cn("inline-flex", className)} title={a.unavailable}>
          {button}
        </span>
      )}
      <ConnectDialog platform={platform} flow={flow} onClose={() => setFlow(null)} />
    </>
  );
}

function ConnectDialog({ platform, flow, onClose }: { platform: AccountPlatform; flow: OAuthStart | null; onClose: () => void }) {
  const t = useT();
  const a = t.accounts;
  const account = useAccount(platform);
  const meta = accountMeta(platform);
  const Icon = meta.icon;
  const open = flow !== null;
  // Only react to a connection that happens while this dialog is open.
  const wasConnected = useRef(false);
  useEffect(() => {
    if (open) wasConnected.current = !!account?.connected;
  }, [open]);
  useEffect(() => {
    if (!open || wasConnected.current || !account?.connected) return;
    toast.success(fmt(a.connectedToast, { name: meta.name, user: account.displayName ?? account.login ?? "" }));
    onClose();
  }, [open, account?.connected, account?.displayName, account?.login, a.connectedToast, meta.name, onClose]);

  const cancel = () => {
    void act((c) => c.cancelLogin(platform));
    onClose();
  };
  const copy = async (code: string) => {
    if (await copyText(code)) toast.success(a.copied);
    else toast.error(t.common.copyFailed);
  };
  const failed = !!account?.error && !account.pending;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && cancel()}>
      <DialogContent className="sm:max-w-md" data-testid={`connect-dialog-${platform}`}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="inline-flex" style={{ color: meta.color }}>
              <Icon size={18} />
            </span>
            {fmt(a.waitTitle, { name: meta.name })}
          </DialogTitle>
          <DialogDescription>{flow?.mode === "device" ? a.deviceDesc : a.browserDesc}</DialogDescription>
        </DialogHeader>

        {flow?.mode === "device" && (
          <div className="flex flex-col items-center gap-3">
            <div className="flex w-full items-center justify-center gap-2 rounded-lg border bg-muted/50 px-4 py-5">
              <span className="font-mono text-3xl font-semibold tracking-[0.2em] select-all" data-testid="device-code">
                {flow.userCode}
              </span>
              <Button variant="ghost" size="icon-sm" aria-label={a.copyCode} title={a.copyCode} onClick={() => copy(flow.userCode)}>
                <Copy />
              </Button>
            </div>
            <Button className="w-full" onClick={() => openExternal(flow.verificationUri)}>
              <ExternalLink /> {fmt(a.openUrl, { url: shortUrl(flow.verificationUri) })}
            </Button>
            <p className="text-xs text-muted-foreground">{fmt(a.expiresIn, { min: Math.round(flow.expiresIn / 60) })}</p>
          </div>
        )}
        {flow?.mode === "browser" && (
          <Button variant="outline" onClick={() => openExternal(flow.url)}>
            <ExternalLink /> {a.openAgain}
          </Button>
        )}

        {failed ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm break-words text-destructive">{account?.error}</p>
        ) : (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" /> {a.waiting}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={cancel}>
            {a.cancel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
