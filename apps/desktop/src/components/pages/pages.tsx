import type { ConnectedAccount, Destination, OutputStatus } from "@vexcast/protocol";
import { Link2, Pencil, Plus, Radio, Trash2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { AccountAvatar, AccountsCard } from "@/components/accounts/accounts-card";
import { linkedPlatform } from "@/components/accounts/connect-button";
import { AiPanel } from "@/components/extras/ai-panel";
import { AlertsPanel } from "@/components/extras/alerts-panel";
import { BotPanel } from "@/components/extras/bot-panel";
import { ChatPanel } from "@/components/extras/chat-panel";
import { RemotePanel } from "@/components/extras/remote-panel";
import { DestinationDialog, type Draft, emptyDestination, tiktokDraft } from "@/components/settings/stream-tab";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/i18n";
import { confirmDialog, openDialog } from "@/lib/dialogs";
import { fmt, formatDuration } from "@/lib/format";
import { act, EMPTY, useAppState, useStore } from "@/lib/store";
import { PLATFORMS, PlatformBadge } from "@/lib/platforms";
import { cn } from "@/lib/utils";

/**
 * Full-page frame. No title header (the navigation rail already says where
 * you are); optional actions sit in a slim toolbar above the content.
 */
export function PageShell({ actions, children, scroll, testId }: { title?: string; description?: string; actions?: React.ReactNode; children: React.ReactNode; scroll?: boolean; testId?: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid={testId}>
      {scroll ? (
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-6">
            {actions && <div className="mx-auto mb-4 flex max-w-4xl items-center justify-end gap-2">{actions}</div>}
            {children}
          </div>
        </ScrollArea>
      ) : (
        <div className="min-h-0 flex-1">{children}</div>
      )}
    </div>
  );
}

export function ChatPage() {
  const t = useT();
  return (
    <PageShell title={t.nav.chat} description={t.chat.desc} testId="page-chat">
      <ChatPanel />
    </PageShell>
  );
}

export function AlertsPage() {
  const t = useT();
  return (
    <PageShell title={t.nav.alerts} description={t.alerts.desc} testId="page-alerts">
      <AlertsPanel />
    </PageShell>
  );
}

export function BotPage() {
  const t = useT();
  return (
    <PageShell title={t.nav.bot} description={t.bot.desc} testId="page-bot">
      <BotPanel />
    </PageShell>
  );
}

export function AiPage() {
  const t = useT();
  return (
    <PageShell title={t.nav.ai} description={t.ai.desc} testId="page-ai">
      <AiPanel />
    </PageShell>
  );
}

export function RemotePage() {
  const t = useT();
  return (
    <PageShell title={t.nav.remote} description={t.about.pairDesc} scroll testId="page-remote">
      <div className="mx-auto max-w-3xl">
        <RemotePanel />
      </div>
    </PageShell>
  );
}

function StateDot({ state }: { state: OutputStatus["state"] | "idle" }) {
  return (
    <span
      className={cn(
        "size-2 shrink-0 rounded-full",
        state === "active" ? "bg-emerald-500" : state === "error" ? "bg-red-500" : state === "idle" ? "bg-muted-foreground/40" : "bg-amber-400",
      )}
    />
  );
}

/** Platform of a destination, from its service or its name (TikTok uses a custom server). */
const platformOf = (d: Destination) =>
  (PLATFORMS.find((p) => p.id !== "custom" && (d.service === p.name || (p.name.length > 2 && d.name.toLowerCase().includes(p.name.toLowerCase()))))?.id ?? (d.server.includes("tiktok") ? "tiktok" : "custom"));

/** Destinations + linked accounts (Destinations page and Settings → Stream). */
export function DestinationsView() {
  const t = useT();
  const d = t.destinations;
  const s = t.settings.stream;
  const destinations = useAppState((x) => x.destinations);
  const verticalEnabled = useAppState((x) => x.video.verticalEnabled);
  const streaming = useAppState((x) => x.status.streaming);
  const outputs = useStore((x) => x.stats?.outputs ?? EMPTY) as OutputStatus[];
  const [editing, setEditing] = useState<Draft | null>(null);
  const accounts = useStore((x) => x.state?.accounts ?? EMPTY) as ConnectedAccount[];
  const out =(id: string) => outputs.find((o) => o.id === id);
  const active = destinations.filter((x) => out(x.id)?.state === "active");
  const total = active.reduce((a, x) => a + (out(x.id)?.kbps ?? 0), 0);
  const hasVertical = destinations.some((x) => x.enabled && x.canvas === "vertical");

  const card = (dst: Destination) => {
    const o = out(dst.id);
    const state = o?.state ?? "idle";
    const lp = linkedPlatform(dst.name);
    const acc = lp ? accounts.find((x) => x.platform === lp && x.connected) : undefined;
    return (
      <Card key={dst.id} className="gap-0 py-0" data-testid={`destination-${dst.name}`}>
        <CardContent className="flex items-center gap-4 px-5 py-4">
          <Switch checked={dst.enabled} onCheckedChange={(v) => act((c) => c.updateDestination(dst.id, { enabled: v }))} aria-label={s.enabled} />
          {acc ? <AccountAvatar account={acc} className="size-8" /> : <PlatformBadge platform={platformOf(dst)} size={32} />}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{dst.name}</span>
              {acc && (
                <Badge variant="secondary" className="gap-1" title={fmt(t.accounts.linkedTo, { user: acc.displayName || acc.login || "" })}>
                  <Link2 className="size-3" /> {t.accounts.linked}
                </Badge>
              )}
              <Badge variant="outline">{dst.canvas === "vertical" ? "9:16" : "16:9"}</Badge>
              {dst.encoderOverride && <Badge variant="secondary">{dst.encoderOverride.encoder}</Badge>}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
              <span>{dst.service}</span>
              <span className="truncate font-mono">{dst.server}</span>
            </div>
          </div>
          <div className="flex w-40 shrink-0 flex-col items-end gap-1 text-xs sm:w-56">
            <span className="flex items-center gap-1.5 font-medium">
              <StateDot state={state} />
              {state === "idle" ? d.idle : state === "active" ? d.live : t.stats.states[state]}
            </span>
            {o && state !== "idle" && (
              <span className="font-mono text-muted-foreground tabular-nums">
                {Math.round(o.kbps)} kb/s · {d.dropped} {o.droppedFrames} · {formatDuration(o.durationMs)}
              </span>
            )}
            {o?.error && <span className="max-w-full truncate text-destructive">{o.error}</span>}
          </div>
          <div className="flex shrink-0 gap-0.5">
            <Button variant="ghost" size="icon-sm" aria-label={s.edit} onClick={() => setEditing({ ...dst, streamKey: "" })}>
              <Pencil />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={s.remove}
              onClick={async () => {
                if (await confirmDialog({ title: fmt(s.removeConfirm, { name: dst.name }), destructive: true, confirmLabel: t.common.delete })) act((c) => c.deleteDestination(dst.id));
              }}
            >
              <Trash2 />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <>
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <AccountsCard />
        <div className="flex items-center gap-3 text-sm">
          <span className="flex items-center gap-2 font-medium">
            <Radio className={cn("size-4", streaming ? "text-red-500" : "text-muted-foreground")} />
            {streaming ? d.live : d.idle}
          </span>
          <span className="text-muted-foreground">{fmt(d.activeCount, { n: active.length })}</span>
          {streaming && (
            <span className="font-mono text-muted-foreground tabular-nums">
              {d.totalBitrate}: {Math.round(total)} kb/s
            </span>
          )}
          <Button className="ml-auto" onClick={() => setEditing(emptyDestination())} data-testid="dest-add">
            <Plus /> {s.add}
          </Button>
        </div>
        {!destinations.some((x) => x.canvas === "vertical") && (
          <div className="flex flex-wrap items-center gap-4 rounded-xl border border-[#FE2C55]/30 bg-gradient-to-r from-[#FE2C55]/10 via-transparent to-[#25F4EE]/10 px-5 py-4" data-testid="vertical-callout">
            <PlatformBadge platform="tiktok" size={40} />
            <div className="min-w-0 flex-1 basis-56">
              <div className="font-medium">{t.vertical.calloutTitle}</div>
              <div className="text-sm text-muted-foreground">{t.vertical.calloutDesc}</div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" onClick={() => setEditing({ ...tiktokDraft(), name: "" })}>
                {t.vertical.calloutOther}
              </Button>
              <Button onClick={() => setEditing(tiktokDraft())} data-testid="add-tiktok">
                <Plus /> {t.vertical.calloutAdd}
              </Button>
            </div>
          </div>
        )}
        {hasVertical && !verticalEnabled && (
          <div className="flex items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
            <TriangleAlert className="size-4 shrink-0" />
            <span className="flex-1">{d.verticalOff}</span>
            <Button variant="outline" size="sm" onClick={() => openDialog("settings", "video")}>
              {d.openVideo}
            </Button>
          </div>
        )}
        {destinations.length === 0 ? <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">{s.none}</p> : destinations.map(card)}
      </div>
      <DestinationDialog draft={editing} onClose={() => setEditing(null)} />
    </>
  );
}

export function DestinationsPage() {
  const t = useT();
  return (
    <PageShell title={t.destinations.title} description={t.destinations.desc} scroll testId="page-destinations">
      <DestinationsView />
    </PageShell>
  );
}
