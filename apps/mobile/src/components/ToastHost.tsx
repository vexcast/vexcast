import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useToast, type ToastLevel } from "@/state/toasts";
import { colors, radius } from "@/theme";
import type { IconName } from "./ui";

const levelStyle: Record<ToastLevel, { color: string; icon: IconName }> = {
  info: { color: colors.info, icon: "information-circle" },
  success: { color: colors.success, icon: "checkmark-circle" },
  warning: { color: colors.warning, icon: "warning" },
  error: { color: colors.danger, icon: "alert-circle" },
};

export function ToastHost() {
  const { toasts, dismiss } = useToast();
  const insets = useSafeAreaInsets();
  if (toasts.length === 0) return null;
  return (
    <View pointerEvents="box-none" style={[styles.host, { top: insets.top + 8 }]}>
      {toasts.map((tst) => {
        const ls = levelStyle[tst.level];
        return (
          <Pressable key={tst.id} onPress={() => dismiss(tst.id)} style={styles.toast}>
            <Ionicons name={ls.icon} size={20} color={ls.color} />
            <Text style={styles.text} numberOfLines={3}>
              {tst.message}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: "absolute", left: 12, right: 12, gap: 8, zIndex: 1000, elevation: 1000 },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.xl,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  text: { color: colors.text, fontSize: 14, flex: 1, fontWeight: "500" },
});
