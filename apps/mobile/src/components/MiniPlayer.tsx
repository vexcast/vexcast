import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { haptic } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { useRemote } from "@/state/remote";
import { colors, radius } from "@/theme";
import { PreviewImage } from "./PreviewImage";

const THUMB_W = 168;
const STUDIO_THUMB_W = 142;
/** Height the mini player takes (thumbnail + frame), for the screens to clear it. */
export const MINI_PLAYER_HEIGHT = Math.round(THUMB_W / (16 / 9)) + 8;

/**
 * Floating picture-in-picture of the program output, shown on every tab but
 * Home. In studio mode it shows the preview scene and the program side by side.
 * Tapping it opens Home; the × tucks it into a small button.
 */
export function MiniPlayer({ bottom }: { bottom: number }) {
  const t = useT();
  const { state, phase } = useRemote();
  const [collapsed, setCollapsed] = useState(false);
  if (!state || phase === "idle") return null;

  const studio = state.status.studioMode && !!state.previewSceneUuid;
  const live = state.status.streaming;
  const aspect = state.video.baseWidth / state.video.baseHeight || 16 / 9;

  if (collapsed) {
    return (
      <Pressable
        onPress={() => {
          haptic.tap();
          setCollapsed(false);
        }}
        style={({ pressed }) => [styles.pill, { bottom }, pressed && { opacity: 0.85 }]}
        accessibilityRole="button"
        accessibilityLabel={t("mini.show")}
        testID="mini-player-show"
      >
        <Ionicons name="tv-outline" size={18} color={colors.text} />
        {live ? <View style={styles.pillLive} /> : null}
      </Pressable>
    );
  }

  const open = () => {
    haptic.tap();
    router.navigate("/dashboard");
  };

  return (
    <View style={[styles.wrap, { bottom }]} testID="mini-player">
      <View style={styles.row}>
        {studio ? (
          <Thumb width={STUDIO_THUMB_W} aspect={aspect} scene={state.previewSceneUuid} label={t("mini.preview")} onPress={open} openLabel={t("mini.open")} />
        ) : null}
        <Thumb
          width={studio ? STUDIO_THUMB_W : THUMB_W}
          aspect={aspect}
          label={live ? t("dash.live") : t("mini.program")}
          live={live}
          onPress={open}
          openLabel={t("mini.open")}
        />
      </View>
      <Pressable
        onPress={() => {
          haptic.tap();
          setCollapsed(true);
        }}
        hitSlop={8}
        style={({ pressed }) => [styles.close, pressed && { backgroundColor: colors.cardStrong }]}
        accessibilityRole="button"
        accessibilityLabel={t("mini.hide")}
        testID="mini-player-hide"
      >
        <Ionicons name="close" size={13} color={colors.text} />
      </Pressable>
    </View>
  );
}

function Thumb({
  width,
  aspect,
  scene,
  label,
  live,
  onPress,
  openLabel,
}: {
  width: number;
  aspect: number;
  scene?: string | null;
  label: string;
  live?: boolean;
  onPress: () => void;
  openLabel: string;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}. ${openLabel}`} style={{ width }}>
      <PreviewImage aspect={aspect} scene={scene} intervalMs={1000} compact style={styles.thumb} />
      <View style={[styles.tag, live && styles.tagLive]} pointerEvents="none">
        {live ? <View style={styles.liveDot} /> : null}
        <Text style={styles.tagText} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    right: 12,
    padding: 4,
    borderRadius: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  row: { flexDirection: "row", gap: 4 },
  thumb: { borderWidth: 0 },
  tag: {
    position: "absolute",
    left: 5,
    bottom: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: "rgba(0,0,0,0.7)",
  },
  tagLive: { backgroundColor: colors.liveDeep },
  liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "#fff" },
  tagText: { color: "#fff", fontSize: 10, fontWeight: "600" },
  close: {
    position: "absolute",
    top: -8,
    right: -8,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  pill: {
    position: "absolute",
    right: 12,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  pillLive: {
    position: "absolute",
    top: 9,
    right: 9,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.live,
    borderWidth: 1.5,
    borderColor: colors.card,
  },
});
