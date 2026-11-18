import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { colors } from "@/theme";
import { Wordmark } from "./Logo";

export function Splash({ message }: { message?: string }) {
  return (
    <View style={styles.root}>
      <Wordmark size={34} suffix="Remote" />
      <ActivityIndicator color={colors.muted} style={{ marginTop: 28 }} />
      {message ? <Text style={styles.msg}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  msg: { color: colors.muted, marginTop: 12, fontSize: 14 },
});
