import { phoneCamSource } from "@vexcast/protocol";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { haptic } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { getJSON } from "@/lib/storage";
import { useRemote } from "@/state/remote";
import { colors } from "@/theme";
import { Button, Card, IconTile } from "./ui";


/** Dashboard entry to "use this phone as a camera", or to pick it up again once it's in a scene. */
export function PhoneCameraCard() {
  const t = useT();
  const { state } = useRemote();
  // This phone's own camera room (other phones' cameras don't count).
  const [room, setRoom] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      void getJSON<{ room?: string } | null>("vexcast.phoneCamera", null).then((p) => setRoom(p?.room ?? null));
    }, []),
  );
  const added = !!(room && state && phoneCamSource(state.sources, room));
  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <IconTile icon="videocam-outline" />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={styles.title}>{t("cam.title")}</Text>
          <Text style={styles.muted}>{added ? t("cam.cardAdded") : t("cam.card")}</Text>
        </View>
      </View>
      <View style={styles.buttons}>
        <Button
          label={added ? t("cam.open") : t("cam.cardButton")}
          icon="videocam"
          variant={added ? "default" : "outline"}
          size="sm"
          style={{ flex: 1 }}
          onPress={() => {
            haptic.tap();
            router.push(added ? { pathname: "/phone-camera", params: { start: "1" } } : "/phone-camera");
          }}
          testID="open-phone-camera"
        />
        {added ? (
          <Button
            label={t("cam.settings")}
            icon="options-outline"
            variant="outline"
            size="sm"
            onPress={() => {
              haptic.tap();
              router.push("/phone-camera");
            }}
          />
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  buttons: { flexDirection: "row", gap: 8 },
  title: { color: colors.text, fontSize: 15, fontWeight: "600" },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 18 },
});
