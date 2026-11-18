import type { ChatPlatform } from "@vexcast/protocol";

export type Platform = "twitch" | "youtube" | "kick" | "tiktok" | "facebook" | "x" | "trovo" | "custom";
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const base = ({ size = 16, ...p }: IconProps) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "currentColor",
  "aria-hidden": true,
  ...p,
});

export const TwitchIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4.3 2 3 5.5V20h4.8v2.5h2.7l2.5-2.5h3.8L22 14.8V2H4.3Zm15.7 11.8-3 3h-4.8L9.7 19.3V16.8H5.8V4H20v9.8ZM16.2 7.4h-2v5.4h2V7.4Zm-5.3 0h-2v5.4h2V7.4Z" />
  </svg>
);
export const YouTubeIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M22.5 7.2a3 3 0 0 0-2.1-2.1C18.6 4.6 12 4.6 12 4.6s-6.6 0-8.4.5a3 3 0 0 0-2.1 2.1C1 9 1 12 1 12s0 3 .5 4.8a3 3 0 0 0 2.1 2.1c1.8.5 8.4.5 8.4.5s6.6 0 8.4-.5a3 3 0 0 0 2.1-2.1C23 15 23 12 23 12s0-3-.5-4.8ZM9.8 15.3V8.7l5.7 3.3-5.7 3.3Z" />
  </svg>
);
export const KickIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 3h6v4h2V5h2V3h8v6h-2v2h-2v2h2v2h2v6h-8v-2h-2v-2H9v4H3V3Z" />
  </svg>
);
export const TikTokIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M16.6 2h-3.4v13.4a2.9 2.9 0 1 1-2-2.8V9.1a6.4 6.4 0 1 0 5.4 6.3V8.6a8 8 0 0 0 4.4 1.4V6.6a4.5 4.5 0 0 1-4.4-4.6Z" />
  </svg>
);
export const FacebookIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M13.5 22v-8.2h2.8l.4-3.3h-3.2V8.4c0-.9.3-1.6 1.6-1.6h1.7V3.9c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3v2.4H7.3v3.3h2.8V22h3.4Z" />
  </svg>
);
export const XIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M17.8 3h3.1l-6.8 7.7L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.2-8.3L1.8 3h6.4l4.4 5.8L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5Z" />
  </svg>
);
export const TrovoIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.6 7.3h-3.2v8.2h-2.8V9.3H7.4V6.8h9.2v2.5Z" />
  </svg>
);
export const CustomIcon = (p: IconProps) => (
  <svg {...base(p)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="2" />
    <path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19.1 4.9a10 10 0 0 1 0 14.2M4.9 19.1a10 10 0 0 1 0-14.2" />
  </svg>
);
export const KofiIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 5h14.5a4.5 4.5 0 0 1 0 9H17a6 6 0 0 1-6 5H8a5 5 0 0 1-5-5V5Zm14 2v5h.5a2.5 2.5 0 0 0 0-5H17Zm-6.7 1.4c-.8-.8-2.3-.6-2.7.6-.3 1 .4 1.8 1.2 2.5L10 12.6l1.2-1.1c.8-.7 1.5-1.5 1.2-2.5-.4-1.2-1.9-1.4-2.7-.6h.6Z" />
  </svg>
);

export const GitHubIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.4-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.4 9.4 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.9V21c0 .3.2.6.7.5A10 10 0 0 0 12 2Z" />
  </svg>
);

export const VexcastMark = ({ size = 16, ...p }: IconProps) => (
  <svg width={size} height={size} viewBox="200 140 700 720" aria-hidden {...p}>
    <defs>
      <linearGradient id="vxm" x1="230" y1="380" x2="720" y2="560" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#8B5CF6" />
        <stop offset="0.5" stopColor="#7C6CF7" />
        <stop offset="1" stopColor="#22D3EE" />
      </linearGradient>
    </defs>
    <g transform="translate(-10 30)" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M230 350 L450 760 L580 505" stroke="url(#vxm)" strokeWidth="120" />
      <path d="M703.6 224.4 A130 130 0 0 1 795.6 383.6" stroke="url(#vxm)" strokeWidth="54" />
      <path d="M725.6 142.3 A215 215 0 0 1 877.7 405.6" stroke="url(#vxm)" strokeWidth="54" strokeOpacity="0.55" />
      <circle cx="670" cy="350" r="60" fill="#22D3EE" stroke="none" />
    </g>
  </svg>
);

export interface PlatformMeta {
  id: Platform;
  name: string;
  color: string;
  icon: (p: IconProps) => React.ReactElement;
  /** Default ingest URL. */
  url: string;
  /** Default canvas. */
  canvas: "horizontal" | "vertical";
  /** Where to get the stream key. */
  keyHelp?: string;
}

export const PLATFORMS: PlatformMeta[] = [
  { id: "twitch", name: "Twitch", color: "#9146FF", icon: TwitchIcon, url: "rtmp://live.twitch.tv/app", canvas: "horizontal", keyHelp: "https://dashboard.twitch.tv/settings/stream" },
  { id: "youtube", name: "YouTube", color: "#FF0033", icon: YouTubeIcon, url: "rtmp://a.rtmp.youtube.com/live2", canvas: "horizontal", keyHelp: "https://studio.youtube.com/channel/UC/livestreaming" },
  { id: "kick", name: "Kick", color: "#53FC18", icon: KickIcon, url: "rtmps://fa723fc1b171.global-contribute.live-video.net/app", canvas: "horizontal", keyHelp: "https://kick.com/dashboard/settings/stream" },
  { id: "tiktok", name: "TikTok", color: "#FE2C55", icon: TikTokIcon, url: "", canvas: "vertical", keyHelp: "https://livecenter.tiktok.com/producer" },
  { id: "facebook", name: "Facebook", color: "#1877F2", icon: FacebookIcon, url: "rtmps://live-api-s.facebook.com:443/rtmp/", canvas: "horizontal", keyHelp: "https://www.facebook.com/live/producer" },
  { id: "x", name: "X", color: "#E7E9EA", icon: XIcon, url: "rtmps://va.pscp.tv:443/x", canvas: "horizontal", keyHelp: "https://studio.x.com/producer" },
  { id: "trovo", name: "Trovo", color: "#19D66B", icon: TrovoIcon, url: "rtmp://livepush.trovo.live/live/", canvas: "horizontal", keyHelp: "https://studio.trovo.live/" },
  { id: "custom", name: "Custom", color: "#94A3B8", icon: CustomIcon, url: "", canvas: "horizontal" },
];

export const platformMeta = (p: Platform): PlatformMeta => PLATFORMS.find((x) => x.id === p) ?? PLATFORMS[PLATFORMS.length - 1];

export const CHAT_PLATFORMS: { id: ChatPlatform; name: string; color: string; icon: (p: IconProps) => React.ReactElement }[] = [
  { id: "twitch", name: "Twitch", color: "#9146FF", icon: TwitchIcon },
  { id: "youtube", name: "YouTube", color: "#FF0033", icon: YouTubeIcon },
  { id: "kick", name: "Kick", color: "#53FC18", icon: KickIcon },
  { id: "tiktok", name: "TikTok", color: "#FE2C55", icon: TikTokIcon },
  { id: "vexcast", name: "Vexcast", color: "#8B5CF6", icon: VexcastMark },
];

export const chatPlatformMeta = (p: ChatPlatform | "kofi") =>
  p === "kofi" ? { id: "kofi" as const, name: "Ko-fi", color: "#FF5E5B", icon: KofiIcon } : (CHAT_PLATFORMS.find((x) => x.id === p) ?? CHAT_PLATFORMS[4]);

export function PlatformBadge({ platform, size = 32 }: { platform: Platform; size?: number }) {
  const m = platformMeta(platform);
  const Icon = m.icon;
  return (
    <div
      className="grid shrink-0 place-items-center rounded-xl"
      style={{ width: size, height: size, background: `${m.color}22`, color: m.color, boxShadow: `inset 0 0 0 1px ${m.color}40` }}
    >
      <Icon size={Math.round(size * 0.55)} />
    </div>
  );
}
