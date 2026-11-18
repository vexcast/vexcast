/**
 * Streamlabs-style navigation rail: a slim fixed icon column on the far left
 * with tooltips. Pages at the top; remote, update, Ko-fi and settings at the bottom.
 */
import { ArrowDownCircle, Bell, Bot, ChartNoAxesCombined, Clapperboard, Coffee, type LucideIcon, MessagesSquare, Radio, Settings, Smartphone, Sparkles, UserRound } from "lucide-react";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { AccountAvatar, AccountsMenuContent } from "@/components/accounts/accounts-card";
import { ACCOUNT_PLATFORMS } from "@/components/accounts/connect-button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/i18n";
import { openDialog } from "@/lib/dialogs";
import { fmt } from "@/lib/format";
import { VexcastMark } from "@/lib/platforms";
import { goTo, type Page, usePrefs } from "@/lib/prefs";
import { useAppState, useStore } from "@/lib/store";
import { KOFI_URL, openExternal } from "@/lib/tauri";
import { cn } from "@/lib/utils";

function RailButton({ icon: Icon, label, active, onClick, dot, live, testId }: { icon: LucideIcon; label: string; active?: boolean; onClick: () => void; dot?: boolean; live?: boolean; testId?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          aria-current={active ? "page" : undefined}
          data-testid={testId}
          className={cn(
            "relative grid size-11 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
            active && "bg-accent text-foreground hover:bg-accent",
          )}
        >
          {/* Accent bar on the rail's left edge for the active page. */}
          {active && <span className="absolute top-2 bottom-2 -left-1.5 w-[3px] rounded-r-full bg-primary" />}
          <Icon className="size-5" />
          {dot && <span className="absolute top-2 right-2 size-2 rounded-full bg-primary ring-2 ring-sidebar" />}
          {live && <span className="absolute top-2 right-2 size-2 rounded-full bg-red-500 ring-2 ring-sidebar" />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/** Linked accounts: stacked avatars in the rail, popover with sign-out. */
function AccountsRailButton() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const connected = useStore(useShallow((s) => (s.state?.accounts ?? []).filter((a) => a.connected && ACCOUNT_PLATFORMS.includes(a.platform))));
  // Keep the popover open while one of its dialogs (login code, confirm) is on top.
  const keepOpen = (e: Event) => {
    if (document.querySelector("[role=dialog], [role=alertdialog]")) e.preventDefault();
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={t.accounts.accountsLabel}
              data-testid="nav-accounts"
              className="relative grid size-11 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:bg-accent"
            >
              {connected.length === 0 ? (
                <UserRound className="size-5" />
              ) : (
                <span className="flex -space-x-2.5">
                  {connected.slice(0, 2).map((a) => (
                    <AccountAvatar key={a.platform} account={a} className="size-6 ring-2 ring-sidebar" />
                  ))}
                </span>
              )}
              {connected.length > 0 && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-emerald-500 ring-2 ring-sidebar" />}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          {t.accounts.accountsLabel}
        </TooltipContent>
      </Tooltip>
      <PopoverContent side="right" align="end" sideOffset={10} className="w-72 p-2" onInteractOutside={keepOpen} onFocusOutside={keepOpen}>
        <AccountsMenuContent
          onManage={() => {
            setOpen(false);
            goTo("destinations");
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export function NavRail() {
  const t = useT();
  const page = usePrefs((p) => p.page);
  const update = useAppState((s) => s.update);
  const streaming = useAppState((s) => s.status.streaming);
  const top: { id: Page; label: string; icon: LucideIcon }[] = [
    { id: "studio", label: t.nav.studio, icon: Clapperboard },
    { id: "destinations", label: t.nav.destinations, icon: Radio },
    { id: "chat", label: t.nav.chat, icon: MessagesSquare },
    { id: "alerts", label: t.nav.alerts, icon: Bell },
    { id: "bot", label: t.nav.bot, icon: Bot },
    { id: "ai", label: t.nav.ai, icon: Sparkles },
    { id: "reports", label: t.reports.nav, icon: ChartNoAxesCombined },
  ];
  return (
    <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r bg-sidebar py-2.5" data-testid="nav-rail" aria-label="Vexcast">
      <button type="button" onClick={() => goTo("studio")} className="mb-2 grid size-11 place-items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50" aria-label="Vexcast">
        <VexcastMark size={28} />
      </button>
      {top.map((it) => (
        <RailButton key={it.id} icon={it.icon} label={it.label} active={page === it.id} onClick={() => goTo(it.id)} live={it.id === "destinations" && streaming} testId={`nav-${it.id}`} />
      ))}
      <div className="flex-1" />
      <AccountsRailButton />
      <RailButton icon={Smartphone} label={t.nav.remote} active={page === "remote"} onClick={() => goTo("remote")} testId="nav-remote" />
      {update.updateAvailable && (
        <RailButton icon={ArrowDownCircle} label={fmt(t.nav.update, { version: update.latestVersion ?? "" })} onClick={() => openDialog("releaseNotes", true)} dot testId="nav-update" />
      )}
      <RailButton icon={Coffee} label={t.nav.supportTitle} onClick={() => openExternal(KOFI_URL)} testId="nav-kofi" />
      <RailButton icon={Settings} label={t.nav.settings} onClick={() => openDialog("settings", "general")} testId="nav-settings" />
    </nav>
  );
}
