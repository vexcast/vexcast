import Ionicons from "@expo/vector-icons/Ionicons";
import { Redirect, router, usePathname } from "expo-router";
import { NativeTabs } from "expo-router/native-tabs";
import { Tabs } from "expo-router/tabs";
import { useEffect, useState } from "react";
import { Keyboard, Platform, StyleSheet, Text, View, type ColorValue } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ConnectionBanner, UpdateBanner } from "@/components/Banners";
import { VexcastMark } from "@/components/Logo";
import { MINI_PLAYER_HEIGHT, MiniPlayer } from "@/components/MiniPlayer";
import { Splash } from "@/components/Splash";
import { classicBarHeight, floatingInset, nativeInset, TabBar } from "@/components/TabBar";
import { IconButton, PulseDot, type IconName } from "@/components/ui";
import { haptic } from "@/lib/haptics";
import { useT, type TKey } from "@/lib/i18n";
import { TabBarInsetContext, usePrefs } from "@/state/prefs";
import { useRemote } from "@/state/remote";
import { colors, radius } from "@/theme";

function TopBar() {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { session, state, phase } = useRemote();
  const live = !!state?.status.streaming;
  const rec = !!state?.status.recording;
  const dot = phase === "connected" ? colors.success : phase === "lost" ? colors.live : colors.warning;
  return (
    <View style={[styles.topbar, { paddingTop: insets.top + 8 }]}>
      <VexcastMark size={28} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.brand} numberOfLines={1}>
          {session?.conn.name ?? "Vexcast"}
        </Text>
        <View style={styles.connRow}>
          <PulseDot color={dot} active={phase !== "connected"} size={6} />
          <Text style={styles.connText} numberOfLines={1}>
            {session ? `${session.host}:${session.conn.port}` : ""}
          </Text>
        </View>
      </View>
      {live ? (
        <View style={[styles.mini, { backgroundColor: colors.live, borderColor: colors.live }]}>
          <PulseDot color="#fff" size={6} />
          <Text style={styles.miniText}>{t("dash.live")}</Text>
        </View>
      ) : null}
      {rec ? (
        <View style={[styles.mini, { backgroundColor: "rgba(239,68,68,0.12)", borderColor: "rgba(239,68,68,0.4)" }]}>
          <View style={styles.recDot} />
          <Text style={[styles.miniText, { color: colors.live }]}>REC</Text>
        </View>
      ) : null}
      <IconButton icon="settings-outline" label={t("settings.title")} variant="outline" onPress={() => router.push("/settings")} testID="open-settings" />
    </View>
  );
}

const tabIcon =
  (focusedName: IconName, name: IconName) =>
  ({ color, focused, size }: { color: ColorValue; focused: boolean; size: number }) => (
    <Ionicons name={focused ? focusedName : name} size={size - 2} color={typeof color === "string" ? color : colors.muted} />
  );

function useKeyboardVisible() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", () => setVisible(true));
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

/** The five tabs: route, label, Ionicons (custom bars) and SF Symbols (iOS's bar). */
const TABS: { name: string; title: TKey; icon: [IconName, IconName]; sf: [string, string] }[] = [
  { name: "dashboard", title: "tabs.dashboard", icon: ["home", "home-outline"], sf: ["house.fill", "house"] },
  { name: "scenes", title: "tabs.scenes", icon: ["albums", "albums-outline"], sf: ["rectangle.stack.fill", "rectangle.stack"] },
  { name: "deck", title: "tabs.deck", icon: ["grid", "grid-outline"], sf: ["square.grid.3x3.fill", "square.grid.3x3"] },
  { name: "audio", title: "tabs.audio", icon: ["options", "options-outline"], sf: ["slider.horizontal.3", "slider.horizontal.3"] },
  { name: "chat", title: "tabs.chat", icon: ["chatbubbles", "chatbubbles-outline"], sf: ["bubble.left.and.bubble.right.fill", "bubble.left.and.bubble.right"] },
];

export default function TabsLayout() {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { session, phase } = useRemote();
  const { tabBar, tabBarLabels, miniPlayer } = usePrefs();
  const keyboard = useKeyboardVisible();
  const pathname = usePathname();

  if (!session) {
    if (phase === "restoring") return <Splash />;
    return <Redirect href="/connect" />;
  }

  const inset = keyboard
    ? 0
    : tabBar === "native"
      ? nativeInset(insets.bottom)
      : tabBar === "glass"
        ? floatingInset(tabBarLabels, insets.bottom)
        : 0;

  // Mini player: every tab but Home (which already shows the program), above the
  // tab bar — and above the composer on Chat.
  const onChat = pathname === "/chat";
  const showMini = miniPlayer && !keyboard && pathname !== "/dashboard";
  const barSpace = tabBar === "classic" ? 0 : inset;
  const miniBottom = barSpace + 10 + (onChat ? 64 : 0);
  // Scrolling screens leave room so their last row can come out from under it.
  const screenInset = inset + (showMini && !onChat ? MINI_PLAYER_HEIGHT + 12 : 0);

  return (
    <View style={styles.root}>
      <TopBar />
      <ConnectionBanner />
      <UpdateBanner />
      <TabBarInsetContext.Provider value={screenInset}>
        {tabBar === "native" ? (
          // iOS's own tab bar: the system's Liquid Glass on iOS 26 (also in Expo Go).
          <NativeTabs
            minimizeBehavior="onScrollDown"
            // Before iOS 26 (no system glass): a dark material instead of the light default.
            blurEffect="systemChromeMaterialDark"
            tintColor={colors.text}
            iconColor={colors.muted}
            labelStyle={{ color: colors.muted, fontSize: 10 }}
            screenListeners={{ tabPress: () => haptic.tap() }}
          >
            {TABS.map((tab) => (
              <NativeTabs.Trigger key={tab.name} name={tab.name} contentStyle={{ backgroundColor: colors.bg }}>
                <NativeTabs.Trigger.Icon sf={{ default: tab.sf[1] as never, selected: tab.sf[0] as never }} />
                <NativeTabs.Trigger.Label hidden={!tabBarLabels}>{t(tab.title)}</NativeTabs.Trigger.Label>
              </NativeTabs.Trigger>
            ))}
          </NativeTabs>
        ) : (
          <Tabs
            tabBar={(props) => <TabBar {...props} variant={tabBar} labels={tabBarLabels} hidden={keyboard} />}
            screenOptions={{
              headerShown: false,
              sceneStyle: { backgroundColor: colors.bg },
              animation: "shift",
            }}
          >
            {TABS.map((tab) => (
              <Tabs.Screen
                key={tab.name}
                name={tab.name}
                options={{ title: t(tab.title), tabBarIcon: tabIcon(tab.icon[0], tab.icon[1]), tabBarButtonTestID: `tab-${tab.name}` }}
              />
            ))}
          </Tabs>
        )}
        {showMini ? (
          <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, tabBar === "classic" && { bottom: classicBarHeight(tabBarLabels, insets.bottom) }]}>
            <MiniPlayer bottom={miniBottom} />
          </View>
        ) : null}
      </TabBarInsetContext.Provider>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingBottom: 10,
    backgroundColor: colors.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
  },
  brand: { color: colors.text, fontSize: 15, fontWeight: "600", letterSpacing: -0.2 },
  connRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 1 },
  connText: { color: colors.muted, fontSize: 12, flexShrink: 1 },
  mini: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm, borderWidth: 1 },
  miniText: { color: "#fff", fontSize: 10, fontWeight: "800", letterSpacing: 0.6 },
  recDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.live },
});
