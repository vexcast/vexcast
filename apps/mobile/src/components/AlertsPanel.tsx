import Ionicons from "@expo/vector-icons/Ionicons";
import type { AlertEvent, AlertType } from "@vexcast/protocol";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { PlatformIcon } from "@/components/PlatformIcon";
import { Screen } from "@/components/Screen";
import { Button, Card, EmptyState, SectionTitle, type IconName } from "@/components/ui";
import { formatTime } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { useI18n, type TKey } from "@/lib/i18n";
import { useRemote } from "@/state/remote";
import { colors, radius } from "@/theme";

const ALERT_TYPES: { type: AlertType; icon: IconName; color: string }[] = [
  { type: "follow", icon: "heart", color: "#F472B6" },
  { type: "subscription", icon: "star", color: "#8B5CF6" },
  { type: "gift_sub", icon: "gift", color: "#A78BFA" },
  { type: "raid", icon: "people", color: "#F59E0B" },
  { type: "bits", icon: "diamond", color: "#22D3EE" },
  { type: "superchat", icon: "cash", color: "#22C55E" },
  { type: "donation", icon: "wallet", color: "#34D399" },
  { type: "kofi", icon: "cafe", color: "#FF5E5B" },
  { type: "member", icon: "ribbon", color: "#38BDF8" },
  { type: "host", icon: "tv", color: "#FB923C" },
];
const meta = Object.fromEntries(ALERT_TYPES.map((a) => [a.type, a])) as Record<AlertType, (typeof ALERT_TYPES)[number]>;

function amountText(a: AlertEvent): string {
  if (a.amount == null) return "";
  if (a.currency) {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: a.currency }).format(a.amount);
    } catch {
      return `${a.amount} ${a.currency}`;
    }
  }
  return String(a.amount);
}

/** Alerts: skip the current one, text to speech, test alerts and recent events (a segment of the Chat tab). */
export function AlertsPanel() {
  const { t, locale } = useI18n();
  const { alerts, run } = useRemote();
  const [tts, setTts] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [testing, setTesting] = useState<AlertType | null>(null);

  async function speak() {
    const text = tts.trim();
    if (!text) return;
    haptic.light();
    setSpeaking(true);
    const r = await run((c) => c.speak(text), t("alerts.spoken"));
    setSpeaking(false);
    if (r) setTts("");
  }

  return (
    <Screen>
      <Button
        label={t("alerts.skip")}
        icon="play-skip-forward"
        variant="outline"
        onPress={() => {
          haptic.medium();
          void run((c) => c.skipAlert(), t("alerts.skipped"));
        }}
        testID="skip-alert"
      />

      <SectionTitle>{t("alerts.speak")}</SectionTitle>
      <Card style={{ gap: 12 }}>
        <TextInput
          value={tts}
          onChangeText={setTts}
          placeholder={t("alerts.speakPlaceholder")}
          placeholderTextColor={colors.faint}
          selectionColor={colors.primary}
          cursorColor={colors.text}
          multiline
          maxLength={400}
          style={styles.ttsInput}
          testID="tts-input"
        />
        <View style={styles.ttsRow}>
          <Text style={styles.counter}>{tts.length}/400</Text>
          <Button
            label={t("alerts.speakButton")}
            icon="megaphone-outline"
            size="sm"
            loading={speaking}
            disabled={!tts.trim()}
            onPress={speak}
            style={{ minWidth: 130 }}
          />
        </View>
      </Card>

      <SectionTitle>{t("alerts.test")}</SectionTitle>
      <View style={styles.testGrid}>
        {ALERT_TYPES.map((a) => (
          <Pressable
            key={a.type}
            onPress={async () => {
              haptic.light();
              setTesting(a.type);
              await run((c) => c.testAlert(a.type), t("alerts.testSent"));
              setTesting(null);
            }}
            style={({ pressed }) => [styles.testBtn, (pressed || testing === a.type) && { backgroundColor: colors.accent }]}
            accessibilityRole="button"
            testID={`test-${a.type}`}
          >
            <View style={[styles.testIcon, { backgroundColor: `${a.color}22` }]}>
              <Ionicons name={a.icon} size={16} color={a.color} />
            </View>
            <Text style={styles.testLabel} numberOfLines={1}>
              {t(`alert.${a.type}` as TKey)}
            </Text>
          </Pressable>
        ))}
      </View>

      <SectionTitle>{t("alerts.recent")}</SectionTitle>
      {alerts.length === 0 ? (
        <EmptyState icon="notifications-outline" text={t("alerts.empty")} />
      ) : (
        <Card padded={false}>
          {alerts.map((a, i) => {
            const m = meta[a.type] ?? ALERT_TYPES[0]!;
            return (
              <View key={a.id} style={[styles.event, i > 0 && styles.divider]}>
                <View style={[styles.eventIcon, { backgroundColor: `${m.color}22` }]}>
                  <Ionicons name={m.icon} size={18} color={m.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.eventHead}>
                    <Text style={styles.eventTitle} numberOfLines={2}>
                      {t(`alertText.${a.type}` as TKey, { user: a.user, amount: amountText(a) })}
                    </Text>
                  </View>
                  {a.message ? (
                    <Text style={styles.eventMsg} numberOfLines={3}>
                      “{a.message}”
                    </Text>
                  ) : null}
                  <View style={styles.eventMeta}>
                    <PlatformIcon platform={a.platform} size={16} />
                    <Text style={styles.eventTime}>{formatTime(a.ts, locale)}</Text>
                    {a.test ? (
                      <View style={styles.testTag}>
                        <Text style={styles.testTagText}>{t("alerts.testBadge")}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              </View>
            );
          })}
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  ttsInput: {
    minHeight: 80,
    color: colors.text,
    fontSize: 15,
    lineHeight: 21,
    textAlignVertical: "top",
    backgroundColor: colors.input,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    padding: 12,
  },
  ttsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  counter: { color: colors.faint, fontSize: 12 },
  testGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  testBtn: {
    flexBasis: "47%",
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  testIcon: { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  testLabel: { color: colors.text, fontSize: 14, fontWeight: "500", flexShrink: 1 },
  event: { flexDirection: "row", gap: 12, padding: 14 },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  eventIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  eventHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  eventTitle: { color: colors.text, fontSize: 15, fontWeight: "600", flex: 1 },
  eventMsg: { color: colors.textDim, fontSize: 14, marginTop: 4, lineHeight: 19 },
  eventMeta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  eventTime: { color: colors.faint, fontSize: 12 },
  testTag: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1 },
  testTagText: { color: colors.muted, fontSize: 10, fontWeight: "800" },
});
