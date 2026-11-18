import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { LinearGradient } from "expo-linear-gradient";
import type { BottomTabBarProps } from "expo-router/tabs";
import { useEffect, useRef, useState } from "react";
import { Animated, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { haptic } from "@/lib/haptics";
import type { TabBarStyle } from "@/state/prefs";
import { colors, radius } from "@/theme";

/** Gap between a floating bar and the bottom safe-area edge. */
const FLOAT_GAP = 10;
const FLOAT_SIDE = 16;

export function floatingBarHeight(labels: boolean) {
  return labels ? 64 : 56;
}

/** Classic bar: tab row + bottom padding (safe area). */
const CLASSIC_ROW = { labels: 54, icons: 46 };
export function classicBarHeight(labels: boolean, bottomInset: number) {
  return (labels ? CLASSIC_ROW.labels : CLASSIC_ROW.icons) + 6 + Math.max(bottomInset, 6) + 1;
}

/** Bottom space a scroll view needs to clear the floating bar. */
export function floatingInset(labels: boolean, bottomInset: number) {
  return floatingBarHeight(labels) + Math.max(bottomInset, FLOAT_GAP) + 12;
}

/** iOS 26's floating system tab bar is ~62pt tall, above the home indicator. */
export function nativeInset(bottomInset: number) {
  return 62 + bottomInset;
}

const liquidGlass = Platform.OS === "ios" && isLiquidGlassAvailable();

/** Translucent background of the floating bar, as native as each platform allows. */
function GlassBackground() {
  if (liquidGlass) {
    // The glass draws its own rounded shape: a clipping parent would flatten the effect.
    return (
      <GlassView
        style={[StyleSheet.absoluteFill, { borderRadius: radius.pill }]}
        glassEffectStyle="regular"
        tintColor="rgba(10,10,10,0.35)"
      />
    );
  }
  if (Platform.OS === "ios" || Platform.OS === "web") {
    return (
      <>
        <BlurView style={StyleSheet.absoluteFill} tint="systemChromeMaterialDark" intensity={80} />
        <Sheen />
      </>
    );
  }
  // Android: real backdrop blur needs a BlurTargetView around the content;
  // a dense translucent fill with a light sheen reads as frosted glass instead.
  return (
    <>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(28,28,30,0.86)" }]} />
      <Sheen />
    </>
  );
}

function Sheen() {
  return (
    <LinearGradient
      pointerEvents="none"
      colors={["rgba(255,255,255,0.10)", "rgba(255,255,255,0.02)", "rgba(255,255,255,0)"]}
      locations={[0, 0.45, 1]}
      style={StyleSheet.absoluteFill}
    />
  );
}

export function TabBar({
  state,
  descriptors,
  emitter,
  navigateToTab,
  insets,
  variant,
  labels,
  hidden,
}: BottomTabBarProps & { variant: TabBarStyle; labels: boolean; hidden?: boolean }) {
  const glass = variant === "glass";
  const [width, setWidth] = useState(0);
  const count = state.routes.length;
  const itemW = width / Math.max(1, count);
  const x = useRef(new Animated.Value(0)).current;
  const placed = useRef(false);

  // Sliding active indicator (glass) — jumps into place on first layout, springs after.
  useEffect(() => {
    if (!itemW) return;
    const to = state.index * itemW;
    if (!placed.current) {
      x.setValue(to);
      placed.current = true;
    } else {
      Animated.spring(x, { toValue: to, useNativeDriver: true, speed: 18, bounciness: 6 }).start();
    }
  }, [state.index, itemW, x]);

  if (hidden) return null;

  const items = state.routes.map((route, index) => {
    const focused = index === state.index;
    const { options } = descriptors[route.key]!;
    const label = typeof options.tabBarLabel === "string" ? options.tabBarLabel : (options.title ?? route.name);
    const color = focused ? colors.text : glass ? "rgba(255,255,255,0.62)" : colors.muted;
    const onPress = () => {
      const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
      if (!focused && !event.defaultPrevented) {
        haptic.tap();
        navigateToTab(route.key);
      }
    };
    return (
      <Pressable
        key={route.key}
        onPress={onPress}
        onLongPress={() => emitter.emit({ type: "tabLongPress", target: route.key })}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
        testID={options.tabBarButtonTestID}
        style={glass ? styles.item : styles.classicItem}
      >
        {({ pressed }) => (
          // Classic: the active tab is a filled cell, like the desktop rail's active button.
          <View
            style={[
              glass ? styles.glassCell : styles.classicCell,
              !glass && focused && styles.classicCellActive,
              !glass && pressed && !focused && { backgroundColor: "rgba(255,255,255,0.04)" },
            ]}
          >
            <View style={styles.iconWrap}>{options.tabBarIcon?.({ focused, color, size: labels ? 24 : 26 })}</View>
            {labels ? (
              <Text style={[styles.label, { color }, focused && styles.labelActive]} numberOfLines={1}>
                {label}
              </Text>
            ) : null}
          </View>
        )}
      </Pressable>
    );
  });

  if (!glass) {
    return (
      <View style={[styles.classic, { paddingBottom: Math.max(insets.bottom, 6) }]} role="tablist">
        <View style={[styles.row, { height: labels ? CLASSIC_ROW.labels : CLASSIC_ROW.icons }]}>{items}</View>
      </View>
    );
  }

  const bottom = Math.max(insets.bottom, FLOAT_GAP);
  return (
    <View pointerEvents="box-none" style={[styles.floatWrap, { bottom, left: FLOAT_SIDE + insets.left, right: FLOAT_SIDE + insets.right }]}>
      <View style={[styles.float, liquidGlass ? styles.floatGlass : styles.floatClip, { height: floatingBarHeight(labels) }]} role="tablist">
        <GlassBackground />
        {itemW > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[styles.indicator, { width: itemW - 8, transform: [{ translateX: x }] }]}
          />
        ) : null}
        <View style={[styles.row, StyleSheet.absoluteFill]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          {items}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "stretch" },
  item: { flex: 1 },
  glassCell: { flex: 1, alignItems: "center", justifyContent: "center", gap: 2 },
  classicItem: { flex: 1, paddingHorizontal: 3 },
  classicCell: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3, borderRadius: radius.lg },
  classicCellActive: { backgroundColor: colors.accent },
  iconWrap: { alignItems: "center", justifyContent: "center", height: 26 },
  label: { fontSize: 11, fontWeight: "500" },
  labelActive: { fontWeight: "700" },
  classic: {
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 6,
    paddingHorizontal: 6,
  },
  floatWrap: { position: "absolute", alignItems: "center" },
  float: {
    width: "100%",
    maxWidth: 520,
    borderRadius: radius.pill,
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  // Fallback fills (blur / translucent) are clipped to the pill and get a hairline rim.
  floatClip: { overflow: "hidden", borderWidth: StyleSheet.hairlineWidth * 2, borderColor: "rgba(255,255,255,0.16)" },
  // Liquid Glass brings its own edge and shadow.
  floatGlass: { shadowOpacity: 0, elevation: 0 },
  indicator: {
    position: "absolute",
    top: 4,
    bottom: 4,
    left: 4,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.13)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.18)",
  },
});
