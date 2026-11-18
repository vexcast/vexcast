/**
 * Small React Native counterparts of the desktop's shadcn/ui primitives
 * (Card, Button, Badge, Input…) so both apps share the same look.
 */
import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef, type ComponentProps, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";

import { colors, radius } from "@/theme";

export type IconName = ComponentProps<typeof Ionicons>["name"];

export function Card({
  children,
  style,
  padded = true,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
}) {
  return <View style={[styles.card, padded && styles.cardPad, style]}>{children}</View>;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {right}
    </View>
  );
}

export type ButtonVariant = "default" | "destructive" | "secondary" | "outline" | "ghost";

const buttonColors: Record<ButtonVariant, { bg: string; fg: string; border?: string }> = {
  default: { bg: colors.primary, fg: colors.primaryFg },
  destructive: { bg: colors.liveDeep, fg: "#FFFFFF" },
  secondary: { bg: colors.cardStrong, fg: colors.text },
  outline: { bg: colors.input, fg: colors.text, border: colors.borderStrong },
  ghost: { bg: "transparent", fg: colors.text },
};

export function Button({
  label,
  icon,
  onPress,
  onLongPress,
  variant = "default",
  loading = false,
  disabled = false,
  size = "md",
  style,
  testID,
}: {
  label: string;
  icon?: IconName;
  onPress?: () => void;
  onLongPress?: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const h = size === "lg" ? 52 : size === "sm" ? 38 : 46;
  const fs = size === "lg" ? 16 : size === "sm" ? 14 : 15;
  const c = buttonColors[variant];
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        { height: h, backgroundColor: c.bg },
        c.border ? { borderWidth: 1, borderColor: c.border } : null,
        pressed && (variant === "ghost" ? { backgroundColor: colors.accent } : { opacity: 0.88 }),
        disabled && { opacity: 0.5 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={c.fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={fs + 3} color={c.fg} /> : null}
          <Text style={[styles.btnLabel, { fontSize: fs, color: c.fg }]} numberOfLines={1}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  label,
  color = colors.text,
  size = 20,
  variant = "ghost",
  style,
  testID,
}: {
  icon: IconName;
  onPress: () => void;
  label: string;
  color?: string;
  size?: number;
  /** "outline" draws a bordered square button like the desktop's `size="icon"` buttons. */
  variant?: "ghost" | "outline";
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        styles.iconBtn,
        variant === "outline" && styles.iconBtnOutline,
        pressed && { backgroundColor: colors.accent },
        style,
      ]}
    >
      <Ionicons name={icon} size={size} color={color} />
    </Pressable>
  );
}

/** Pulsing dot used by the LIVE / REC badges. */
export function PulseDot({ color, active = true, size = 8 }: { color: string; active?: boolean; size?: number }) {
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!active) {
      v.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 0.35, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(v, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, v]);
  return <Animated.View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity: v }} />;
}

/** shadcn-style Badge. */
export function Pill({
  label,
  color = colors.muted,
  filled = false,
  pulse = false,
  icon,
  style,
}: {
  label: string;
  color?: string;
  filled?: boolean;
  pulse?: boolean;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}) {
  const fg = filled ? "#FFFFFF" : color;
  return (
    <View
      style={[
        styles.pill,
        filled ? { backgroundColor: color, borderColor: color } : { backgroundColor: `${color}1A`, borderColor: `${color}40` },
        style,
      ]}
    >
      {pulse ? <PulseDot color={fg} size={7} /> : null}
      {icon ? <Ionicons name={icon} size={12} color={fg} /> : null}
      <Text style={[styles.pillLabel, { color: fg }]}>{label}</Text>
    </View>
  );
}

export function Field({ label, hint, ...props }: TextInputProps & { label?: string; hint?: string }) {
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.faint}
        selectionColor={colors.primary}
        cursorColor={colors.text}
        autoCapitalize="none"
        autoCorrect={false}
        {...props}
        style={[styles.input, props.style]}
      />
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

export function EmptyState({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={24} color={colors.muted} />
      </View>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

/** Rounded square holding an icon (desktop: `size-9 rounded-md bg-muted`). */
export function IconTile({ icon, color = colors.text, bg = colors.cardStrong, size = 38 }: { icon: IconName; color?: string; bg?: string; size?: number }) {
  return (
    <View style={[styles.iconTile, { width: size, height: size, backgroundColor: bg }]}>
      <Ionicons name={icon} size={Math.round(size * 0.48)} color={color} />
    </View>
  );
}

export const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.xl,
    overflow: "hidden",
  },
  cardPad: { padding: 16 },
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
    paddingHorizontal: 2,
  },
  sectionTitle: { color: colors.muted, fontSize: 13, fontWeight: "600" },
  btn: {
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 16,
  },
  btnLabel: { fontWeight: "600" },
  iconBtn: { width: 38, height: 38, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  iconBtnOutline: { borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.input },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  pillLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.4 },
  fieldLabel: { color: colors.text, fontSize: 14, fontWeight: "500" },
  fieldHint: { color: colors.muted, fontSize: 12 },
  input: {
    backgroundColor: colors.input,
    borderColor: colors.borderStrong,
    borderWidth: 1,
    borderRadius: radius.md,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  empty: { alignItems: "center", justifyContent: "center", paddingVertical: 40, gap: 12 },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: colors.cardStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: { color: colors.muted, fontSize: 14, textAlign: "center", maxWidth: 280, lineHeight: 20 },
  iconTile: { borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
});
