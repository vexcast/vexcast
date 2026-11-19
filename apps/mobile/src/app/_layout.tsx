import { DarkTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as ScreenOrientation from "expo-screen-orientation";
import * as SystemUI from "expo-system-ui";
import { useEffect } from "react";
import { View } from "react-native";

import { ToastHost } from "@/components/ToastHost";
import { I18nProvider, useT } from "@/lib/i18n";
import { DeckProvider } from "@/lib/deck";
import { PrefsProvider } from "@/state/prefs";
import { RemoteProvider } from "@/state/remote";
import { ToastProvider } from "@/state/toasts";
import { UpdatesProvider } from "@/state/updates";
import { colors } from "@/theme";

export { ErrorBoundary } from "expo-router";

SplashScreen.preventAutoHideAsync().catch(() => {});

const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.primary,
    background: colors.bg,
    card: colors.bg,
    text: colors.text,
    border: colors.border,
    notification: colors.live,
  },
};

function RootStack() {
  const t = useT();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: "600", fontSize: 17 },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: "fade_from_bottom",
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="connect" options={{ headerShown: false }} />
      {/* The title names the group for back buttons and screen readers (otherwise "(tabs)"). */}
      <Stack.Screen name="(tabs)" options={{ title: "Vexcast", headerShown: false, animation: "fade" }} />
      <Stack.Screen name="scan" options={{ title: t("scan.title"), headerShown: false, animation: "slide_from_bottom", gestureEnabled: true }} />
      <Stack.Screen
        name="stream-info"
        options={{ title: t("info.title"), animation: "slide_from_right", headerBackButtonDisplayMode: "minimal", headerBackTitle: t("tabs.dashboard") }}
      />
      <Stack.Screen
        name="phone-camera"
        options={{ title: t("cam.title"), animation: "slide_from_right", headerBackButtonDisplayMode: "minimal", headerBackTitle: t("tabs.dashboard") }}
      />
      <Stack.Screen name="deck-button" options={{ title: t("deck.editTitle"), animation: "slide_from_right", headerBackButtonDisplayMode: "minimal", headerBackTitle: t("tabs.deck") }} />
      <Stack.Screen
        name="settings"
        // Just the chevron: the previous screen is the "(tabs)" group, whose route name would show as the back title.
        options={{ title: t("settings.title"), animation: "slide_from_right", headerBackButtonDisplayMode: "minimal", headerBackTitle: t("tabs.dashboard") }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.bg).catch(() => {});
    // Portrait app; only the phone camera screen turns (while live).
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    const id = setTimeout(() => SplashScreen.hideAsync().catch(() => {}), 50);
    return () => clearTimeout(id);
  }, []);

  return (
    <ThemeProvider value={theme}>
      <I18nProvider>
        <ToastProvider>
          <PrefsProvider>
          <UpdatesProvider>
            <RemoteProvider>
              <DeckProvider>
              <View style={{ flex: 1, backgroundColor: colors.bg }}>
                <StatusBar style="light" />
                <RootStack />
                <ToastHost />
              </View>
              </DeckProvider>
            </RemoteProvider>
          </UpdatesProvider>
          </PrefsProvider>
        </ToastProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
