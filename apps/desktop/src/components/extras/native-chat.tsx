/**
 * The platform's own chat (Twitch / Kick) embedded in a dock, like OBS's
 * "Custom browser docks". Twitch only allows its chat inside pages whose host
 * is passed as `parent`; Kick's popout chat can be framed as is.
 */
import type { AccountPlatform } from "@vexcast/protocol";
import { ExternalLink, LogIn, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/i18n";
import { fmt } from "@/lib/format";
import { chatPlatformMeta } from "@/lib/platforms";
import { goTo } from "@/lib/prefs";
import { useStore } from "@/lib/store";
import { isTauri, openExternal } from "@/lib/tauri";

function useChannel(platform: AccountPlatform): string {
  return useStore((s) => {
    const conn = s.state?.chat.find((c) => c.platform === platform)?.channel?.trim();
    const acc = s.state?.accounts?.find((a) => a.platform === platform && a.connected)?.login;
    const ch = (conn || acc || "").replace(/^https?:\/\/(www\.)?(twitch\.tv|kick\.com)\//, "").replace(/\/.*$/, "").split(":")[0];
    // Kick's channel slugs use "-" where usernames have "_".
    return platform === "kick" ? ch.toLowerCase().replace(/_/g, "-") : ch.toLowerCase();
  });
}

const LOGIN_URL: Record<AccountPlatform, string> = {
  twitch: "https://www.twitch.tv/login",
  kick: "https://kick.com/login",
  youtube: "https://accounts.google.com/",
};

/** Open a URL in a separate app window (shares cookies with the embedded chat). */
async function openWindow(url: string, title: string) {
  if (!isTauri()) {
    window.open(url, "_blank", "width=420,height=720");
    return;
  }
  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const w = new WebviewWindow(`web-${Date.now()}`, { url, title, width: 460, height: 760 });
    w.once("tauri://error", () => void openExternal(url));
  } catch {
    void openExternal(url);
  }
}

function NativeChat({ platform }: { platform: AccountPlatform }) {
  const t = useT();
  const n = t.nativeChat;
  const meta = chatPlatformMeta(platform);
  const channel = useChannel(platform);
  const dark = useStore((s) => (s.state?.general.theme ?? "dark") !== "light");
  const [nonce, setNonce] = useState(0);

  if (!channel) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
        <p className="max-w-64 text-sm text-muted-foreground">{fmt(n.noChannel, { name: meta.name })}</p>
        <Button size="sm" variant="outline" onClick={() => goTo("chat")}>
          {n.goChat}
        </Button>
      </div>
    );
  }

  const src =
    platform === "twitch"
      ? `https://www.twitch.tv/embed/${encodeURIComponent(channel)}/chat?parent=${encodeURIComponent(location.hostname)}${dark ? "&darkpopout" : ""}`
      : `https://kick.com/popout/${encodeURIComponent(channel)}/chat`;
  const popout = platform === "twitch" ? `https://www.twitch.tv/popout/${encodeURIComponent(channel)}/chat?popout=` : src;

  const tool = (icon: React.ReactNode, label: string, onClick: () => void) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="size-6" aria-label={label} onClick={onClick}>
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid={`native-chat-${platform}`}>
      <div className="flex h-7 shrink-0 items-center gap-1 border-b px-2 text-xs text-muted-foreground">
        <span className="inline-flex" style={{ color: meta.color }}>
          <meta.icon size={12} />
        </span>
        <span className="min-w-0 flex-1 truncate">{channel}</span>
        {tool(<RefreshCw className="size-3.5" />, n.reload, () => setNonce((x) => x + 1))}
        {tool(<LogIn className="size-3.5" />, fmt(n.login, { name: meta.name }), () => void openWindow(LOGIN_URL[platform], fmt(n.login, { name: meta.name })))}
        {tool(<ExternalLink className="size-3.5" />, n.openWindow, () => void openWindow(popout, `${meta.name} · ${channel}`))}
      </div>
      <iframe key={`${src}#${nonce}`} src={src} title={`${meta.name} chat`} className="min-h-0 w-full flex-1 border-0 bg-background" allow="clipboard-write" />
    </div>
  );
}

export const TwitchChatPanel = () => <NativeChat platform="twitch" />;
export const KickChatPanel = () => <NativeChat platform="kick" />;
