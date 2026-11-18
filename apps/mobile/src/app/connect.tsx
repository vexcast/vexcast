import Ionicons from "@expo/vector-icons/Ionicons";
import { DEFAULT_PORT } from "@vexcast/protocol";
import { router, useCanGoBack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ConfirmSheet } from "@/components/ConfirmSheet";
import { Wordmark } from "@/components/Logo";
import { Screen } from "@/components/Screen";
import { Button, Card, Field, IconButton, IconTile, SectionTitle } from "@/components/ui";
import { haptic } from "@/lib/haptics";
import { useI18n } from "@/lib/i18n";
import { goHome, takeManualRequest } from "@/lib/nav";
import { fromParams, parseConnectPayload } from "@/lib/pairing";
import type { SavedConnection } from "@/lib/storage";
import { useRemote } from "@/state/remote";
import { colors, radius } from "@/theme";

export default function ConnectScreen() {
  const { t, locale } = useI18n();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ host?: string; port?: string; token?: string; name?: string }>();
  const { phase, session, error, saved, connect, connectSaved, forget, clearError } = useRemote();
  const [showManual, setShowManual] = useState(false);
  const [host, setHost] = useState("");
  const [port, setPort] = useState(String(DEFAULT_PORT));
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [toForget, setToForget] = useState<SavedConnection | null>(null);
  const handledLink = useRef<string | null>(null);
  const canGoBack = useCanGoBack();

  // Coming back from the QR scanner's "enter manually" button.
  useFocusEffect(
    useCallback(() => {
      if (takeManualRequest()) setShowManual(true);
    }, []),
  );

  // Deep link: vexcast://connect?host=..&port=..&token=..
  useEffect(() => {
    if (!params.host) return;
    const key = `${params.host}|${params.port}|${params.token}`;
    if (handledLink.current === key) return;
    handledLink.current = key;
    const target = fromParams(params);
    if (!target) {
      setLocalError(t("connect.errInvalidQr"));
      return;
    }
    setHost(target.hosts.join(","));
    setPort(String(target.port));
    setToken(target.token);
    void doConnect(() => connect(target), "link");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.host, params.port, params.token]);

  // Launch-time restore succeeded while this screen was showing.
  const restoring = phase === "restoring";
  useEffect(() => {
    if (!restoring && session && !busy && !params.host && !canGoBack) goHome();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoring]);

  async function doConnect(fn: () => Promise<boolean>, id: string) {
    setLocalError(null);
    clearError();
    setBusy(id);
    const ok = await fn();
    setBusy(null);
    if (ok) {
      haptic.success();
      goHome();
    } else {
      haptic.error();
    }
  }

  function submitManual() {
    const raw = host.trim();
    if (!raw) {
      setLocalError(t("connect.errHost"));
      return;
    }
    const target = raw.startsWith("vexcast:") ? parseConnectPayload(raw) : fromParams({ host: raw, port, token });
    if (!target) {
      setLocalError(t("connect.errInvalidQr"));
      return;
    }
    void doConnect(() => connect(target), "manual");
  }

  const shownError = localError ?? error;
  const lastRestoring = restoring ? saved[0] : undefined;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen contentStyle={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 32 }}>
        <View style={styles.header}>
          <Wordmark size={26} suffix="Remote" />
          {canGoBack ? <IconButton icon="close" label={t("common.close")} variant="outline" onPress={() => router.back()} /> : null}
        </View>

        <View style={styles.intro}>
          <Text style={styles.title}>{t("connect.title")}</Text>
          <Text style={styles.subtitle}>{t("connect.sameWifi")}</Text>
        </View>

        {restoring ? (
          <Card style={styles.restoring}>
            <ActivityIndicator color={colors.muted} />
            <Text style={styles.restoringText}>
              {t("connect.autoReconnecting", { name: lastRestoring?.name ?? "PC" })}
            </Text>
          </Card>
        ) : null}

        {shownError ? (
          <View style={styles.error} accessibilityRole="alert">
            <Ionicons name="alert-circle" size={20} color={colors.danger} />
            <Text style={styles.errorText}>{shownError}</Text>
          </View>
        ) : null}

        <Card style={styles.steps}>
          {(["connect.step1", "connect.step2", "connect.step3"] as const).map((key, i) => (
            <View key={key} style={styles.step}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>{i + 1}</Text>
              </View>
              <Text style={styles.stepText}>{t(key)}</Text>
            </View>
          ))}
          <Button
            label={t("connect.scan")}
            icon="qr-code-outline"
            size="lg"
            onPress={() => {
              haptic.light();
              router.push("/scan");
            }}
            style={{ marginTop: 4 }}
            testID="scan-button"
          />
        </Card>

        <View style={styles.orRow}>
          <View style={styles.orLine} />
          <Text style={styles.orText}>{t("connect.or")}</Text>
          <View style={styles.orLine} />
        </View>

        <Card padded={false}>
          <Pressable
            style={({ pressed }) => [styles.manualHeader, pressed && { backgroundColor: colors.accent }]}
            onPress={() => {
              haptic.tap();
              setShowManual((v) => !v);
            }}
            accessibilityRole="button"
            accessibilityState={{ expanded: showManual }}
          >
            <IconTile icon="create-outline" size={34} />
            <Text style={styles.manualTitle}>{t("connect.manual")}</Text>
            <Ionicons name={showManual ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} />
          </Pressable>
          {showManual ? (
            <View style={styles.manualBody}>
              <Field
                label={t("connect.host")}
                placeholder={t("connect.hostHint")}
                value={host}
                onChangeText={setHost}
                keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "url"}
                returnKeyType="next"
                testID="host-input"
              />
              <Field
                label={t("connect.port")}
                value={port}
                onChangeText={setPort}
                keyboardType="number-pad"
                maxLength={5}
                testID="port-input"
              />
              <Field
                label={t("connect.token")}
                hint={t("connect.tokenHint")}
                value={token}
                onChangeText={setToken}
                secureTextEntry
                returnKeyType="go"
                onSubmitEditing={submitManual}
                testID="token-input"
              />
              <Button
                label={busy === "manual" ? t("connect.connecting") : t("connect.button")}
                icon="link-outline"
                loading={busy === "manual"}
                onPress={submitManual}
                testID="manual-connect"
              />
            </View>
          ) : null}
        </Card>

        {saved.length > 0 ? (
          <>
            <SectionTitle>{t("connect.saved")}</SectionTitle>
            <Card padded={false}>
              {saved.map((c, i) => (
                <View key={c.id} style={[styles.savedRowWrap, i > 0 && styles.divider]}>
                  <Pressable
                    onPress={() => void doConnect(() => connectSaved(c), c.id)}
                    onLongPress={() => setToForget(c)}
                    style={({ pressed }) => [styles.savedRow, pressed && { backgroundColor: colors.accent }]}
                    accessibilityRole="button"
                  >
                    <IconTile icon="desktop-outline" />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.savedName} numberOfLines={1}>
                        {c.name}
                      </Text>
                      <Text style={styles.savedMeta} numberOfLines={1}>
                        {(c.lastHost ?? c.hosts[0]) + ":" + c.port} · {new Date(c.lastUsedAt).toLocaleDateString(locale)}
                      </Text>
                    </View>
                  </Pressable>
                  <View style={styles.savedAction}>
                    {busy === c.id || (restoring && lastRestoring?.id === c.id) ? (
                      <ActivityIndicator color={colors.muted} />
                    ) : (
                      <IconButton icon="trash-outline" label={t("connect.forget")} color={colors.muted} size={18} onPress={() => setToForget(c)} />
                    )}
                  </View>
                </View>
              ))}
            </Card>
          </>
        ) : null}

      </Screen>

      <ConfirmSheet
        visible={!!toForget}
        title={t("settings.forgetTitle")}
        body={toForget ? t("settings.forgetBody", { name: toForget.name }) : undefined}
        confirmLabel={t("connect.forget")}
        icon="trash-outline"
        destructive
        onCancel={() => setToForget(null)}
        onConfirm={() => {
          if (toForget) void forget(toForget.id);
          setToForget(null);
        }}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 40 },
  intro: { gap: 6, marginTop: 20, marginBottom: 6 },
  title: { color: colors.text, fontSize: 28, fontWeight: "700", letterSpacing: -0.6 },
  subtitle: { color: colors.muted, fontSize: 15, lineHeight: 21 },
  steps: { gap: 14 },
  step: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  stepNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumText: { color: colors.text, fontSize: 12, fontWeight: "600", fontVariant: ["tabular-nums"] },
  stepText: { color: colors.textDim, fontSize: 15, lineHeight: 22, flex: 1, marginTop: 1 },
  orRow: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 2 },
  orLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong },
  orText: { color: colors.muted, fontSize: 13 },
  restoring: { flexDirection: "row", alignItems: "center", gap: 12 },
  restoringText: { color: colors.text, fontSize: 15, fontWeight: "500", flex: 1 },
  error: {
    flexDirection: "row",
    gap: 10,
    padding: 14,
    borderRadius: radius.lg,
    backgroundColor: "rgba(255,100,103,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,100,103,0.35)",
  },
  errorText: { color: colors.text, fontSize: 14, lineHeight: 20, flex: 1 },
  manualHeader: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  manualTitle: { color: colors.text, fontSize: 15, fontWeight: "600", flex: 1 },
  manualBody: { paddingHorizontal: 16, paddingBottom: 16, gap: 14, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 14 },
  savedRowWrap: { flexDirection: "row", alignItems: "center" },
  savedRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 14, paddingRight: 6, paddingVertical: 12 },
  savedAction: { width: 48, alignItems: "center" },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  savedName: { color: colors.text, fontSize: 15, fontWeight: "600" },
  savedMeta: { color: colors.muted, fontSize: 13, marginTop: 2 },
});
