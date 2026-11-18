import Ionicons from "@expo/vector-icons/Ionicons";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { useT } from "@/lib/i18n";
import { majorMinorDiffers } from "@/lib/semver";
import { appVersion, RELEASES_URL } from "@/lib/updates";
import { useRemote } from "@/state/remote";
import { useUpdates } from "@/state/updates";
import { colors, radius } from "@/theme";

export function openUrl(url: string) {
  WebBrowser.openBrowserAsync(url, { toolbarColor: colors.bg, controlsColor: colors.text }).catch(() => {});
}

/** Red-ish strip shown while the WebSocket is down; the client retries on its own. */
export function ConnectionBanner() {
  const t = useT();
  const { phase, session } = useRemote();
  if (phase !== "lost" || !session) return null;
  return (
    <View style={styles.lost} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <ActivityIndicator size="small" color="#fff" />
      <View style={{ flex: 1 }}>
        <Text style={styles.lostTitle}>{t("banner.lost")}</Text>
        <Text style={styles.lostSub} numberOfLines={1}>
          {session.conn.name} · {session.host}:{session.conn.port}
        </Text>
      </View>
      <Ionicons name="cloud-offline-outline" size={20} color="#fff" />
    </View>
  );
}

export function UpdateBanner() {
  const t = useT();
  const { status, showBanner, dismiss } = useUpdates();
  if (!showBanner || !status?.latestVersion) return null;
  return (
    <View style={styles.update}>
      <Ionicons name="arrow-down-circle-outline" size={18} color={colors.text} />
      <Text style={styles.updateText} numberOfLines={1}>
        {t("banner.update", { version: status.latestVersion })}
      </Text>
      <Pressable onPress={() => openUrl(status.releaseUrl ?? RELEASES_URL)} style={styles.updateBtn} accessibilityRole="link">
        <Text style={styles.updateBtnText}>{t("banner.updateAction")}</Text>
      </Pressable>
      <Pressable onPress={dismiss} hitSlop={10} accessibilityLabel={t("common.close")}>
        <Ionicons name="close" size={18} color={colors.textDim} />
      </Pressable>
    </View>
  );
}

/** Gentle notice when the desktop core and this app differ in major/minor version. */
export function CompatNotice() {
  const t = useT();
  const { session, state } = useRemote();
  const [hidden, setHidden] = useState(false);
  const core = session?.coreVersion || state?.version;
  if (hidden || !core || !majorMinorDiffers(core, appVersion())) return null;
  return (
    <View style={styles.compat}>
      <Ionicons name="information-circle-outline" size={18} color={colors.warning} />
      <Text style={styles.compatText}>{t("banner.compat", { core, app: appVersion() })}</Text>
      <Pressable onPress={() => setHidden(true)} hitSlop={10} accessibilityLabel={t("common.close")}>
        <Ionicons name="close" size={16} color={colors.muted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  lost: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.liveDeep,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  lostTitle: { color: "#fff", fontWeight: "600", fontSize: 14 },
  lostSub: { color: "rgba(255,255,255,0.8)", fontSize: 12 },
  update: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 16,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  updateText: { color: colors.text, fontWeight: "500", fontSize: 14, flex: 1 },
  updateBtn: { backgroundColor: colors.primary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.md },
  updateBtnText: { color: colors.primaryFg, fontWeight: "600", fontSize: 13 },
  compat: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderRadius: radius.xl,
    backgroundColor: "rgba(245,158,11,0.08)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.3)",
  },
  compatText: { color: colors.textDim, fontSize: 13, lineHeight: 18, flex: 1 },
});
