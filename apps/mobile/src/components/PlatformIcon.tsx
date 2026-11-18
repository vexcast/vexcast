import Ionicons from "@expo/vector-icons/Ionicons";
import { StyleSheet, Text, View } from "react-native";

import { platformColors } from "@/theme";
import type { IconName } from "./ui";

const icons: Record<string, IconName | undefined> = {
  twitch: "logo-twitch",
  youtube: "logo-youtube",
  tiktok: "logo-tiktok",
  facebook: "logo-facebook",
  x: "logo-x",
  vexcast: "radio",
  kofi: "cafe",
  custom: "globe-outline",
};

/** Maps an OBS stream service name ("Twitch", "YouTube - RTMPS", "Custom"…) to a platform id. */
export function serviceToPlatform(service: string): string {
  const s = service.toLowerCase();
  for (const p of ["twitch", "youtube", "kick", "tiktok", "facebook", "trovo"]) if (s.includes(p)) return p;
  if (s === "x" || s.includes("twitter")) return "x";
  return "custom";
}

/**
 * Platform glyph on a tinted rounded square. Kick/Trovo have no glyph, so they get a letter.
 * `icon` overrides the glyph (e.g. for the recording / virtual camera outputs).
 */
export function PlatformIcon({ platform, size = 22, icon: iconOverride }: { platform: string; size?: number; icon?: IconName }) {
  const color = platformColors[platform] ?? platformColors.custom!;
  const icon = iconOverride ?? icons[platform];
  return (
    <View
      style={[
        styles.box,
        { width: size, height: size, borderRadius: size * 0.3, backgroundColor: `${color}26`, borderColor: `${color}55` },
      ]}
    >
      {icon ? (
        <Ionicons name={icon} size={size * 0.62} color={color} />
      ) : (
        <Text style={{ color, fontWeight: "900", fontSize: size * 0.55 }}>{platform.slice(0, 1).toUpperCase()}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: "center", justifyContent: "center", borderWidth: 1 },
});
