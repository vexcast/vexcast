import type { ReactNode } from "react";
import { RefreshControl, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { useTabBarInset } from "@/state/prefs";
import { colors } from "@/theme";

export function Screen({
  children,
  scroll = true,
  contentStyle,
  refreshing,
  onRefresh,
}: {
  children: ReactNode;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  // Room for the floating tab bar (0 outside the tabs or with the docked bar).
  const inset = useTabBarInset();
  const pad = inset ? { paddingBottom: 32 + inset } : null;
  return (
    <View style={styles.root}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[styles.content, pad, contentStyle]}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={!!refreshing}
                onRefresh={onRefresh}
                tintColor={colors.muted}
                colors={[colors.primaryFg]}
                progressBackgroundColor={colors.primary}
              />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, { flex: 1 }, pad, contentStyle]}>{children}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12, paddingBottom: 32, width: "100%", maxWidth: 720, alignSelf: "center" },
});
