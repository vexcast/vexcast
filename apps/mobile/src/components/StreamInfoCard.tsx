import Ionicons from "@expo/vector-icons/Ionicons";
import type { AccountPlatform, StreamInfo } from "@vexcast/protocol";
import { Image } from "expo-image";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { haptic } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { useRemote } from "@/state/remote";
import { colors } from "@/theme";
import { PlatformIcon } from "./PlatformIcon";
import { Button, Card } from "./ui";

/** Platforms whose title/category the core can change (same list as the desktop). */
export const INFO_PLATFORMS: AccountPlatform[] = ["twitch", "kick"];

/** Current title and category per connected channel, with a button to edit them. */
export function StreamInfoCard() {
  const t = useT();
  const { session, state } = useRemote();
  const platforms = (state?.accounts ?? []).filter((a) => a.connected && INFO_PLATFORMS.includes(a.platform)).map((a) => a.platform);
  const key = platforms.join(",");
  const [info, setInfo] = useState<Partial<Record<AccountPlatform, StreamInfo | "error">>>({});

  // Refresh on focus (e.g. coming back from the editor).
  useFocusEffect(
    useCallback(() => {
      if (!session || !key) return;
      let cancelled = false;
      for (const p of key.split(",") as AccountPlatform[]) {
        session.client
          .getStreamInfo(p)
          .then((i) => !cancelled && setInfo((cur) => ({ ...cur, [p]: i })))
          .catch(() => !cancelled && setInfo((cur) => ({ ...cur, [p]: "error" })));
      }
      return () => {
        cancelled = true;
      };
    }, [session, key]),
  );

  return (
    <Card style={{ gap: 12 }}>
      <View style={styles.head}>
        <Text style={styles.title}>{t("info.title")}</Text>
        {platforms.length > 0 ? (
          <Button
            label={t("info.edit")}
            icon="create-outline"
            variant="outline"
            size="sm"
            onPress={() => {
              haptic.tap();
              router.push("/stream-info");
            }}
            testID="edit-stream-info"
          />
        ) : null}
      </View>
      {platforms.length === 0 ? (
        <Text style={styles.muted}>{t("info.none")}</Text>
      ) : (
        platforms.map((p) => {
          const i = info[p];
          return (
            <View key={p} style={styles.row}>
              <PlatformIcon platform={p} size={26} />
              <View style={{ flex: 1, minWidth: 0 }}>
                {i === undefined ? (
                  <ActivityIndicator size="small" color={colors.muted} style={{ alignSelf: "flex-start" }} />
                ) : i === "error" ? (
                  <Text style={styles.muted}>—</Text>
                ) : (
                  <>
                    <Text style={styles.streamTitle} numberOfLines={2}>
                      {i.title || t("info.noTitle")}
                    </Text>
                    <View style={styles.catRow}>
                      {i.category?.image ? (
                        <Image source={{ uri: i.category.image }} style={styles.catImg} contentFit="cover" />
                      ) : (
                        <Ionicons name="game-controller-outline" size={13} color={colors.muted} />
                      )}
                      <Text style={styles.cat} numberOfLines={1}>
                        {i.category?.name ?? t("info.noCategory")}
                      </Text>
                    </View>
                  </>
                )}
              </View>
            </View>
          );
        })
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { color: colors.text, fontSize: 15, fontWeight: "600", flex: 1 },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  row: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  streamTitle: { color: colors.text, fontSize: 14, lineHeight: 19, fontWeight: "500" },
  catRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  catImg: { width: 12, height: 16, borderRadius: 2 },
  cat: { color: colors.muted, fontSize: 12, flexShrink: 1 },
});
