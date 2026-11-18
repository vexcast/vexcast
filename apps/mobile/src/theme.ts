import { Platform } from "react-native";

/**
 * Mirrors the desktop app's shadcn "neutral" dark theme (apps/desktop/src/index.css,
 * `.dark`), so the phone and the studio look like the same product: neutral greys,
 * a near-white primary and red reserved for live/recording.
 */
export const colors = {
  bg: "#0A0A0A", // --background oklch(0.145 0 0)
  bgElevated: "#171717", // --card / --popover oklch(0.205 0 0)
  card: "#171717",
  cardStrong: "#262626", // --muted / --accent / --secondary oklch(0.269 0 0)
  accent: "#262626",
  border: "rgba(255,255,255,0.10)", // --border
  borderStrong: "rgba(255,255,255,0.15)", // --input
  input: "rgba(255,255,255,0.045)", // dark:bg-input/30
  text: "#FAFAFA", // --foreground
  textDim: "#D4D4D4",
  muted: "#A1A1A1", // --muted-foreground oklch(0.708 0 0)
  faint: "#737373", // --ring oklch(0.556 0 0)
  primary: "#E5E5E5", // --primary oklch(0.922 0 0)
  primaryFg: "#171717", // --primary-foreground
  ring: "#737373",
  live: "#EF4444", // red-500, the desktop's live/program dot
  liveDeep: "#DC2626",
  success: "#10B981", // emerald-500
  warning: "#F59E0B", // amber-500
  danger: "#FF6467", // --destructive (dark)
  info: "#38BDF8",
} as const;

/** shadcn radius scale (--radius: 0.625rem). */
export const radius = { sm: 6, md: 8, lg: 10, xl: 14, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

export const font = {
  mono: Platform.select({ ios: "Menlo", android: "monospace", default: "ui-monospace, Menlo, monospace" }),
};

export const platformColors: Record<string, string> = {
  twitch: "#9146FF",
  youtube: "#FF0033",
  kick: "#53FC18",
  tiktok: "#FE2C55",
  facebook: "#1877F2",
  x: "#E7E9EA",
  trovo: "#19D66B",
  custom: "#A1A1A1",
  vexcast: colors.primary,
  kofi: "#FF5E5B",
};
