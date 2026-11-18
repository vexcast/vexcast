import type { AccountPlatform, ConnectedAccount } from "@vexcast/protocol";
import { Loader2, LogOut, MessageSquare, Pencil, Radio } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useT } from "@/i18n";
import { confirmDialog, openDialog } from "@/lib/dialogs";
import { fmt } from "@/lib/format";
import { act, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { ACCOUNT_PLATFORMS, accountMeta, ConnectAccountButton, useAccount } from "./connect-button";

const NO_ACCOUNTS: ConnectedAccount[] = [];

/** Account avatar: picture when the platform gives one, otherwise initials. */
export function AccountAvatar({ account, className }: { account: ConnectedAccount; className?: string }) {
  const name = account.displayName || account.login || "?";
  const initials = name.replace(/^@/, "").slice(0, 2).toUpperCase();
  return account.avatarUrl ? (
    <img src={account.avatarUrl} alt="" className={cn("size-9 shrink-0 rounded-full border object-cover", className)} />
  ) : (
    <span className={cn("grid size-9 shrink-0 place-items-center rounded-full border bg-muted text-xs font-semibold text-muted-foreground", className)}>{initials}</span>
  );
}

function AccountRow({ platform }: { platform: AccountPlatform }) {
  const t = useT();
  const a = t.accounts;
  const account = useAccount(platform);
  const meta = accountMeta(platform);
  const Icon = meta.icon;
  const [busy, setBusy] = useState<"stream" | "chat" | null>(null);
  if (!account) return null;

  const applyDestination = async () => {
    setBusy("stream");
    const r = await act((c) => c.applyAccount(platform, { destination: true }));
    setBusy(null);
    if (!r) return;
    for (const w of r.warnings) toast.warning(w);
    toast.success(fmt(a.destinationApplied, { name: meta.name }));
  };
  const applyChat = async () => {
    setBusy("chat");
    const r = await act((c) => c.applyAccount(platform, { chat: true }));
    setBusy(null);
    if (!r) return;
    for (const w of r.warnings) toast.warning(w);
    const channel = useStore.getState().state?.chat.find((c) => c.platform === platform)?.channel || account.login || "";
    toast.success(fmt(a.chatApplied, { name: meta.name, channel }));
  };
  const disconnect = async () => {
    const ok = await confirmDialog({ title: fmt(a.disconnectConfirm, { name: meta.name }), description: a.disconnectDesc, confirmLabel: a.disconnect, destructive: true });
    if (ok) void act((c) => c.disconnectAccount(platform));
  };

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 py-3 first:pt-0 last:pb-0" data-testid={`account-${platform}`}>
      <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
        {account.connected ? (
          <div className="relative shrink-0">
            <AccountAvatar account={account} />
            <span className="absolute -right-1 -bottom-1 grid size-4.5 place-items-center rounded-full border bg-background" style={{ color: meta.color }}>
              <Icon size={10} />
            </span>
          </div>
        ) : (
          <span className="grid size-9 shrink-0 place-items-center rounded-md border bg-muted" style={{ color: account.available ? meta.color : undefined }}>
            <Icon size={16} />
          </span>
        )}
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{account.connected ? account.displayName || account.login : meta.name}</span>
            {account.pending && (
              <Badge variant="outline" className="gap-1">
                <Loader2 className="size-3 animate-spin" /> {a.connecting}
              </Badge>
            )}
          </div>
          <span className="truncate text-xs text-muted-foreground">
            {account.connected ? `${meta.name}${account.login ? ` · ${account.login}` : ""}` : account.available ? a.notConnected : a.unavailable}
          </span>
          {account.error && !account.pending && <span className="text-xs break-words text-destructive">{account.error}</span>}
        </div>
      </div>
      {account.connected ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={applyDestination} data-testid={`account-${platform}-stream`}>
            {busy === "stream" ? <Loader2 className="animate-spin" /> : <Radio />} {a.useForStream}
          </Button>
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={applyChat} data-testid={`account-${platform}-chat`}>
            {busy === "chat" ? <Loader2 className="animate-spin" /> : <MessageSquare />} {a.useForChat}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => openDialog("streamInfo", true)}>
            <Pencil /> {a.streamInfo}
          </Button>
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={disconnect}>
            <LogOut /> {a.disconnect}
          </Button>
        </div>
      ) : (
        <ConnectAccountButton platform={platform} size="sm" />
      )}
    </div>
  );
}

/** Creates (or refreshes) the destination of an account; returns true on success. */
export async function addAccountDestination(platform: AccountPlatform, toastText: string): Promise<boolean> {
  const r = await act((c) => c.applyAccount(platform, { destination: true }));
  if (!r) return false;
  for (const w of r.warnings) toast.warning(w);
  toast.success(toastText);
  return true;
}

/**
 * "Con tu cuenta" tab of the add-destination dialog: one row per platform with
 * the signed-in account and an "Añadir destino" button, or the login button.
 */
export function AccountDestinationPicker({ onDone }: { onDone: () => void }) {
  const t = useT();
  const a = t.accounts;
  return (
    <div className="flex flex-col gap-2" data-testid="account-destination-picker">
      <p className="text-sm text-muted-foreground">{a.methodAccountDesc}</p>
      {ACCOUNT_PLATFORMS.map((p) => (
        <PickerRow key={p} platform={p} onDone={onDone} />
      ))}
    </div>
  );
}

function PickerRow({ platform, onDone }: { platform: AccountPlatform; onDone: () => void }) {
  const t = useT();
  const a = t.accounts;
  const account = useAccount(platform);
  const meta = accountMeta(platform);
  const Icon = meta.icon;
  const exists = useStore((s) => s.state?.destinations.some((d) => d.name.startsWith(`${meta.name} · `)) ?? false);
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    const ok = await addAccountDestination(platform, fmt(a.destinationApplied, { name: meta.name }));
    setBusy(false);
    if (ok) onDone();
  };
  return (
    <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
      {account?.connected ? (
        <div className="relative shrink-0">
          <AccountAvatar account={account} />
          <span className="absolute -right-1 -bottom-1 grid size-4.5 place-items-center rounded-full border bg-background" style={{ color: meta.color }}>
            <Icon size={10} />
          </span>
        </div>
      ) : (
        <span className="grid size-9 shrink-0 place-items-center rounded-md border bg-muted" style={{ color: meta.color }}>
          <Icon size={16} />
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{meta.name}</span>
        <span className="truncate text-xs text-muted-foreground">
          {account?.connected ? fmt(a.connectedAs, { name: account.displayName || account.login || "" }) : a.notConnected}
        </span>
      </div>
      {account?.connected ? (
        <Button size="sm" disabled={busy} onClick={add} data-testid={`picker-add-${platform}`}>
          {busy ? <Loader2 className="animate-spin" /> : <Radio />} {exists ? a.refreshKey : a.addWithAccount}
        </Button>
      ) : (
        <ConnectAccountButton platform={platform} size="sm" />
      )}
    </div>
  );
}

/** Rail button + popover listing the linked accounts, with sign-out. */
export function AccountsMenuContent({ onManage }: { onManage: () => void }) {
  const t = useT();
  const a = t.accounts;
  const accounts = useStore((s) => s.state?.accounts ?? NO_ACCOUNTS);
  const connected = accounts.filter((x) => x.connected && ACCOUNT_PLATFORMS.includes(x.platform));
  const disconnect = async (platform: AccountPlatform) => {
    const meta = accountMeta(platform);
    const ok = await confirmDialog({ title: fmt(a.disconnectConfirm, { name: meta.name }), description: a.disconnectDesc, confirmLabel: a.disconnect, destructive: true });
    if (ok) void act((c) => c.disconnectAccount(platform));
  };
  return (
    <div className="flex flex-col gap-1" data-testid="accounts-menu">
      <div className="px-2 pt-1 pb-2 text-sm font-semibold">{a.menuTitle}</div>
      {connected.length === 0 && <p className="px-2 pb-2 text-sm text-muted-foreground">{a.menuNone}</p>}
      {connected.map((acc) => {
        const meta = accountMeta(acc.platform);
        const Icon = meta.icon;
        return (
          <div key={acc.platform} className="flex items-center gap-3 rounded-md px-2 py-1.5">
            <div className="relative shrink-0">
              <AccountAvatar account={acc} className="size-8" />
              <span className="absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full border bg-background" style={{ color: meta.color }}>
                <Icon size={9} />
              </span>
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">{acc.displayName || acc.login}</span>
              <span className="truncate text-xs text-muted-foreground">{meta.name}</span>
            </div>
            <Button size="icon-sm" variant="ghost" aria-label={a.disconnect} title={a.disconnect} onClick={() => disconnect(acc.platform)} data-testid={`menu-disconnect-${acc.platform}`}>
              <LogOut />
            </Button>
          </div>
        );
      })}
      {ACCOUNT_PLATFORMS.filter((p) => !connected.some((c) => c.platform === p)).map((p) => (
        <div key={p} className="px-2 py-1">
          <ConnectAccountButton platform={p} size="sm" className="w-full" />
        </div>
      ))}
      <div className="mt-1 flex flex-col border-t pt-1">
        {connected.length > 0 && (
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => openDialog("streamInfo", true)} data-testid="menu-stream-info">
            <Pencil /> {a.info.open}
          </Button>
        )}
        <Button variant="ghost" size="sm" className="w-full justify-start" onClick={onManage}>
          {a.manage}
        </Button>
      </div>
    </div>
  );
}

/** "Cuentas" card: sign in with Twitch/Kick and use the account for streaming, chat and stream info. */
export function AccountsCard({ className }: { className?: string }) {
  const t = useT();
  const hasAccounts = useStore((s) => (s.state?.accounts?.length ?? 0) > 0);
  if (!hasAccounts) return null;
  return (
    <Card className={cn("gap-4", className)} data-testid="accounts-card">
      <CardHeader>
        <CardTitle>{t.accounts.title}</CardTitle>
        <CardDescription>{t.accounts.desc}</CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        {ACCOUNT_PLATFORMS.map((p) => (
          <AccountRow key={p} platform={p} />
        ))}
      </CardContent>
    </Card>
  );
}
