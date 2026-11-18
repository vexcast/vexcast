import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, Defs, G, LinearGradient, Path, Stop } from "react-native-svg";

import { colors } from "@/theme";

/** The Vexcast mark, drawn exactly like the desktop's `VexcastMark` (apps/desktop/src/lib/platforms.tsx). */
export function VexcastMark({ size = 24 }: { size?: number }) {
  return (
    // Decorative: hidden from screen readers (aria-hidden works on iOS, Android and web).
    <View aria-hidden style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="200 140 700 720">
        <Defs>
          <LinearGradient id="vxm" x1="230" y1="380" x2="720" y2="560" gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#8B5CF6" />
            <Stop offset="0.5" stopColor="#7C6CF7" />
            <Stop offset="1" stopColor="#22D3EE" />
          </LinearGradient>
        </Defs>
        <G transform="translate(-10 30)" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <Path d="M230 350 L450 760 L580 505" stroke="url(#vxm)" strokeWidth={120} />
          <Path d="M703.6 224.4 A130 130 0 0 1 795.6 383.6" stroke="url(#vxm)" strokeWidth={54} />
          <Path d="M725.6 142.3 A215 215 0 0 1 877.7 405.6" stroke="url(#vxm)" strokeWidth={54} strokeOpacity={0.55} />
          <Circle cx={670} cy={350} r={60} fill="#22D3EE" />
        </G>
      </Svg>
    </View>
  );
}

/** Mark + "Vexcast" wordmark, optionally with a small product suffix ("Remote"). */
export function Wordmark({ size = 22, suffix, style }: { size?: number; suffix?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.row, style]}>
      <VexcastMark size={size} />
      <Text style={[styles.name, { fontSize: Math.round(size * 0.72) }]}>
        Vexcast
        {suffix ? <Text style={styles.suffix}> {suffix}</Text> : null}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { color: colors.text, fontWeight: "700", letterSpacing: -0.3 },
  suffix: { color: colors.muted, fontWeight: "500" },
});
