import { useEffect, useRef } from "react";
import { Animated, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useT } from "@/lib/i18n";
import { colors, radius } from "@/theme";
import { Button, IconTile, type IconName } from "./ui";

/** Bottom confirmation sheet (works the same on Android, iOS and web). */
export function ConfirmSheet({
  visible,
  title,
  body,
  confirmLabel,
  icon,
  destructive = false,
  onConfirm,
  onCancel,
  extra,
}: {
  visible: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  icon?: IconName;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Another action shown above cancel / confirm. */
  extra?: { label: string; icon?: IconName; onPress: () => void };
}) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      slide.setValue(0);
      Animated.spring(slide, { toValue: 1, useNativeDriver: true, bounciness: 4, speed: 16 }).start();
    }
  }, [visible, slide]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onCancel} accessibilityLabel={t("common.cancel")} />
      <Animated.View
        style={[
          styles.sheet,
          { paddingBottom: 20 + insets.bottom },
          { transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [320, 0] }) }] },
        ]}
      >
        <View style={styles.grabber} />
        {icon ? (
          <View style={{ marginTop: 4 }}>
            <IconTile
              icon={icon}
              size={48}
              color={destructive ? colors.danger : colors.text}
              bg={destructive ? "rgba(255,100,103,0.12)" : colors.cardStrong}
            />
          </View>
        ) : null}
        <Text style={styles.title}>{title}</Text>
        {body ? <Text style={styles.body}>{body}</Text> : null}
        {extra ? <Button label={extra.label} icon={extra.icon} variant="outline" onPress={extra.onPress} style={{ alignSelf: "stretch", marginTop: 12 }} testID="confirm-sheet-extra" /> : null}
        <View style={[styles.actions, extra && { marginTop: 0 }]}>
          <Button label={t("common.cancel")} variant="outline" onPress={onCancel} style={{ flex: 1 }} />
          <Button
            label={confirmLabel}
            variant={destructive ? "destructive" : "default"}
            onPress={onConfirm}
            style={{ flex: 1 }}
            testID="confirm-sheet-confirm"
          />
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderColor: colors.border,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 10,
    alignItems: "center",
    gap: 10,
  },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginBottom: 8 },
  title: { color: colors.text, fontSize: 18, fontWeight: "600", textAlign: "center" },
  body: { color: colors.muted, fontSize: 14, textAlign: "center", lineHeight: 21, maxWidth: 340 },
  actions: { flexDirection: "row", gap: 12, marginTop: 12, alignSelf: "stretch" },
});
