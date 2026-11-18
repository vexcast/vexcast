import Ionicons from "@expo/vector-icons/Ionicons";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Easing,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, IconTile } from "@/components/ui";
import { haptic } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { goHome, requestManualConnect } from "@/lib/nav";
import { parseConnectPayload } from "@/lib/pairing";
import { useRemote } from "@/state/remote";
import { colors, radius } from "@/theme";

/** Leaves the scanner: back to whatever opened it, or the connect screen. */
function leave(manual = false) {
  if (manual) requestManualConnect();
  if (router.canGoBack()) router.back();
  else router.replace("/connect");
}

const DIM = "rgba(0,0,0,0.62)";
const CORNER = 30;
const STROKE = 4;

export default function ScanScreen() {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const { connect, error, clearError } = useRemote();
  const [busy, setBusy] = useState(false);
  const [torch, setTorch] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState(false);
  const lastData = useRef<string | null>(null);
  const sweep = useRef(new Animated.Value(0)).current;

  const hole = Math.round(Math.min(width * 0.72, height * 0.42, 300));

  // Android back button / gesture always leaves the scanner.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      leave();
      return true;
    });
    return () => sub.remove();
  }, []);

  // Scan line sweeping the window while idle.
  useEffect(() => {
    if (busy) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(sweep, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [busy, sweep]);

  async function onScanned(result: BarcodeScanningResult) {
    if (busy || result.data === lastData.current) return;
    lastData.current = result.data;
    const target = parseConnectPayload(result.data);
    if (!target) {
      haptic.warning();
      setScanError(t("connect.errInvalidQr"));
      // allow scanning the same wrong code again after a moment
      setTimeout(() => (lastData.current = null), 2500);
      return;
    }
    haptic.medium();
    setScanError(null);
    clearError();
    setBusy(true);
    const ok = await connect(target);
    setBusy(false);
    if (ok) {
      haptic.success();
      goHome();
    } else {
      haptic.error();
      setTimeout(() => (lastData.current = null), 1500);
    }
  }

  const header = (onCamera: boolean) => (
    <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
      <Pressable
        onPress={() => leave()}
        hitSlop={8}
        style={({ pressed }) => [styles.back, onCamera && styles.backOnCamera, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
        accessibilityLabel={t("scan.back")}
        testID="scan-back"
      >
        <Ionicons name="chevron-back" size={20} color={colors.text} />
        <Text style={styles.backText}>{t("scan.back")}</Text>
      </Pressable>
      <Text style={styles.title} numberOfLines={1}>
        {t("scan.title")}
      </Text>
      {onCamera ? (
        <Pressable
          onPress={() => {
            haptic.tap();
            setTorch((v) => !v);
          }}
          hitSlop={8}
          style={({ pressed }) => [styles.torch, torch && styles.torchOn, pressed && { opacity: 0.7 }]}
          accessibilityRole="switch"
          accessibilityState={{ checked: torch }}
          accessibilityLabel={torch ? t("scan.torchOff") : t("scan.torchOn")}
        >
          <Ionicons name={torch ? "flashlight" : "flashlight-outline"} size={18} color={torch ? colors.primaryFg : colors.text} />
        </Pressable>
      ) : (
        <View style={{ width: 38 }} />
      )}
    </View>
  );

  if (!permission) {
    return (
      <View style={styles.page}>
        {header(false)}
        <View style={styles.center}>
          <ActivityIndicator color={colors.muted} />
        </View>
      </View>
    );
  }

  if (!permission.granted || cameraError) {
    const denied = !permission.canAskAgain && !permission.granted;
    return (
      <View style={styles.page}>
        {header(false)}
        <View style={[styles.center, { padding: 24, paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.permCard}>
            <IconTile icon="camera-outline" size={48} />
            <Text style={styles.permTitle}>{t("scan.permissionTitle")}</Text>
            <Text style={styles.permBody}>
              {cameraError ? t("scan.unavailable") : denied ? t("scan.permissionDenied") : t("scan.permissionBody")}
            </Text>
            {!cameraError ? (
              denied ? (
                <Button label={t("scan.openSettings")} icon="settings-outline" onPress={() => Linking.openSettings()} style={styles.permBtn} />
              ) : (
                <Button label={t("scan.permissionGrant")} icon="camera-outline" onPress={requestPermission} style={styles.permBtn} />
              )
            ) : null}
            <Button label={t("connect.manual")} icon="create-outline" variant="outline" onPress={() => leave(true)} style={styles.permBtn} />
          </View>
        </View>
      </View>
    );
  }

  const shownError = scanError ?? error;
  const lineY = sweep.interpolate({ inputRange: [0, 1], outputRange: [STROKE + 6, hole - STROKE - 8] });

  return (
    <View style={styles.root}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={busy ? undefined : onScanned}
        onMountError={() => setCameraError(true)}
      />

      {/* Dimmed surroundings with a clear square window in the middle. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View style={styles.dim} />
        <View style={{ flexDirection: "row", height: hole }}>
          <View style={styles.dim} />
          <View style={{ width: hole, height: hole }}>
            <View style={[styles.corner, styles.tl]} />
            <View style={[styles.corner, styles.tr]} />
            <View style={[styles.corner, styles.bl]} />
            <View style={[styles.corner, styles.br]} />
            {busy ? (
              <View style={styles.busy}>
                <ActivityIndicator size="large" color={colors.text} />
              </View>
            ) : (
              <Animated.View style={[styles.line, { transform: [{ translateY: lineY }] }]} />
            )}
          </View>
          <View style={styles.dim} />
        </View>
        <View style={[styles.dim, { alignItems: "center", paddingTop: 22, paddingHorizontal: 24 }]}>
          {shownError ? (
            <View style={styles.error} accessibilityRole="alert">
              <Ionicons name="alert-circle" size={18} color={colors.danger} />
              <Text style={styles.errorText}>{shownError}</Text>
            </View>
          ) : (
            <Text style={styles.hint}>{busy ? t("connect.connecting") : t("scan.hint")}</Text>
          )}
        </View>
      </View>

      {header(true)}

      <View style={[styles.footer, { paddingBottom: insets.bottom + 20 }]}>
        <Button label={t("scan.manual")} icon="create-outline" variant="outline" onPress={() => leave(true)} style={styles.footerBtn} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  page: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    elevation: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  back: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    height: 38,
    paddingLeft: 6,
    paddingRight: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.input,
  },
  backOnCamera: { backgroundColor: "rgba(10,10,10,0.6)", borderColor: "rgba(255,255,255,0.18)" },
  backText: { color: colors.text, fontSize: 14, fontWeight: "600" },
  title: { flex: 1, textAlign: "center", color: colors.text, fontSize: 16, fontWeight: "600" },
  torch: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(10,10,10,0.6)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  torchOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  dim: { flex: 1, backgroundColor: DIM },
  corner: { position: "absolute", width: CORNER, height: CORNER, borderColor: colors.text },
  tl: { top: 0, left: 0, borderTopWidth: STROKE, borderLeftWidth: STROKE, borderTopLeftRadius: radius.xl },
  tr: { top: 0, right: 0, borderTopWidth: STROKE, borderRightWidth: STROKE, borderTopRightRadius: radius.xl },
  bl: { bottom: 0, left: 0, borderBottomWidth: STROKE, borderLeftWidth: STROKE, borderBottomLeftRadius: radius.xl },
  br: { bottom: 0, right: 0, borderBottomWidth: STROKE, borderRightWidth: STROKE, borderBottomRightRadius: radius.xl },
  line: {
    position: "absolute",
    top: 0,
    left: 14,
    right: 14,
    height: 2,
    borderRadius: 1,
    backgroundColor: "rgba(255,255,255,0.75)",
  },
  busy: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.35)" },
  hint: { color: colors.text, fontSize: 15, textAlign: "center", lineHeight: 21, fontWeight: "500", maxWidth: 320 },
  error: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    padding: 12,
    borderRadius: radius.lg,
    backgroundColor: "rgba(23,23,23,0.95)",
    borderWidth: 1,
    borderColor: "rgba(255,100,103,0.45)",
    maxWidth: 360,
  },
  errorText: { color: colors.text, fontSize: 14, flex: 1, lineHeight: 19 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, alignItems: "center", paddingHorizontal: 24 },
  footerBtn: { alignSelf: "stretch", maxWidth: 420, width: "100%", backgroundColor: "rgba(10,10,10,0.6)" },
  permCard: {
    alignItems: "center",
    gap: 12,
    padding: 20,
    width: "100%",
    maxWidth: 380,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  permTitle: { color: colors.text, fontSize: 18, fontWeight: "600" },
  permBody: { color: colors.muted, fontSize: 14, textAlign: "center", lineHeight: 20 },
  permBtn: { alignSelf: "stretch" },
});
