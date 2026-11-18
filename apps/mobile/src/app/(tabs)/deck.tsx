import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { ConfirmSheet } from "@/components/ConfirmSheet";
import { Screen } from "@/components/Screen";
import { Button, EmptyState } from "@/components/ui";
import { describe, runAction, useDeck, type DeckButton } from "@/lib/deck";
import { haptic } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { useRemote } from "@/state/remote";
import { colors, radius } from "@/theme";

const GAP = 10;
const PAD = 16;

export default function DeckTab() {
  const t = useT();
  const { width } = useWindowDimensions();
  const { state, run } = useRemote();
  const { deck, setDeck, reset } = useDeck();
  const [editing, setEditing] = useState(false);
  const [confirmStream, setConfirmStream] = useState<DeckButton | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  if (!state || !deck) return <Screen>{null}</Screen>;
  const cols = deck.columns;
  const inner = Math.min(width, 720) - PAD * 2;
  const size = Math.floor((inner - GAP * (cols - 1)) / cols);

  async function press(b: DeckButton) {
    if (!state) return;
    if (editing) {
      haptic.tap();
      router.push({ pathname: "/deck-button", params: { id: b.id } });
      return;
    }
    if (b.action.type === "stream") {
      haptic.medium();
      setConfirmStream(b);
      return;
    }
    haptic.medium();
    setPending(b.id);
    const r = await run((c) => runAction(b.action, c, state).then(() => true));
    setPending(null);
    if (r) haptic.light();
  }

  return (
    <Screen>
      <View style={styles.head}>
        <Text style={styles.title}>{t("deck.title")}</Text>
        {editing ? (
          <View style={styles.colSwitch} accessibilityLabel={t("deck.columns")}>
            {([3, 4] as const).map((n) => (
              <Pressable
                key={n}
                onPress={() => {
                  haptic.tap();
                  setDeck({ ...deck, columns: n });
                }}
                style={[styles.colBtn, cols === n && styles.colBtnOn]}
                accessibilityRole="radio"
                accessibilityState={{ selected: cols === n }}
              >
                <Ionicons name={n === 3 ? "grid-outline" : "apps-outline"} size={15} color={cols === n ? colors.text : colors.muted} />
                <Text style={[styles.colText, cols === n && { color: colors.text }]}>{n}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <Button
          label={editing ? t("deck.done") : t("deck.edit")}
          icon={editing ? "checkmark" : "create-outline"}
          variant={editing ? "default" : "outline"}
          size="sm"
          onPress={() => {
            haptic.tap();
            setEditing((v) => !v);
          }}
          testID="deck-edit"
        />
      </View>
      {editing ? <Text style={styles.hint}>{t("deck.editHint")}</Text> : null}

      {deck.buttons.length === 0 && !editing ? (
        <EmptyState icon="grid-outline" text={t("deck.empty")} />
      ) : (
        <View style={styles.grid}>
          {deck.buttons.map((b) => {
            const v = describe(b, state, t);
            const tone = b.color ?? v.tone;
            const on = v.active && !v.missing;
            const off = (v.disabled || v.missing) && !editing;
            return (
              <Pressable
                key={b.id}
                onPress={() => press(b)}
                disabled={off}
                style={({ pressed }) => [
                  styles.key,
                  { width: size, height: size },
                  on && { backgroundColor: `${tone}26`, borderColor: tone },
                  editing && styles.keyEditing,
                  off && { opacity: 0.4 },
                  pressed && { transform: [{ scale: 0.95 }] },
                ]}
                accessibilityRole="button"
                accessibilityLabel={v.status ? `${v.label}, ${v.status}` : v.label}
                accessibilityState={{ selected: on, disabled: off, busy: pending === b.id }}
                testID={`deck-${b.id}`}
              >
                <Ionicons name={v.missing ? "help-circle-outline" : v.icon} size={cols === 4 ? 24 : 28} color={on ? tone : b.color ?? colors.text} />
                <Text style={[styles.keyLabel, cols === 4 && { fontSize: 11 }]} numberOfLines={2}>
                  {v.label}
                </Text>
                {v.status ? (
                  <Text style={[styles.keyStatus, { color: on ? tone : colors.muted }]} numberOfLines={1}>
                    {v.status}
                  </Text>
                ) : null}
                {editing ? (
                  <View style={styles.editBadge}>
                    <Ionicons name="pencil" size={11} color={colors.text} />
                  </View>
                ) : null}
              </Pressable>
            );
          })}
          {editing ? (
            <Pressable
              onPress={() => {
                haptic.tap();
                router.push({ pathname: "/deck-button", params: { id: "new" } });
              }}
              style={({ pressed }) => [styles.key, styles.addKey, { width: size, height: size }, pressed && { backgroundColor: colors.accent }]}
              accessibilityRole="button"
              accessibilityLabel={t("deck.add")}
              testID="deck-add"
            >
              <Ionicons name="add" size={28} color={colors.muted} />
              <Text style={[styles.keyLabel, { color: colors.muted }]}>{t("deck.add")}</Text>
            </Pressable>
          ) : null}
        </View>
      )}

      {editing ? (
        <Button label={t("deck.reset")} icon="refresh" variant="ghost" size="sm" onPress={() => setConfirmReset(true)} style={{ alignSelf: "center", marginTop: 8 }} />
      ) : null}

      <ConfirmSheet
        visible={!!confirmStream}
        icon={state.status.streaming ? "stop-circle" : "radio"}
        destructive={state.status.streaming}
        title={state.status.streaming ? t("dash.confirmEndTitle") : t("dash.confirmGoLiveTitle")}
        body={state.status.streaming ? t("dash.confirmEndBody") : t("dash.confirmGoLiveBody", { count: state.destinations.filter((d) => d.enabled).length })}
        confirmLabel={state.status.streaming ? t("dash.endStream") : t("dash.goLive")}
        onCancel={() => setConfirmStream(null)}
        onConfirm={async () => {
          const b = confirmStream;
          setConfirmStream(null);
          if (!b) return;
          haptic.heavy();
          const wasLive = state.status.streaming;
          const r = await run((c) => runAction(b.action, c, state).then(() => true), wasLive ? t("dash.streamStopped") : t("dash.streamStarted"));
          if (r) haptic.success();
        }}
      />
      <ConfirmSheet
        visible={confirmReset}
        icon="refresh"
        destructive
        title={t("deck.resetTitle")}
        body={t("deck.resetBody")}
        confirmLabel={t("deck.reset")}
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          setConfirmReset(false);
          reset();
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { color: colors.text, fontSize: 20, fontWeight: "700", letterSpacing: -0.3, flex: 1 },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  colSwitch: { flexDirection: "row", backgroundColor: colors.cardStrong, borderRadius: radius.md, padding: 2, gap: 2 },
  colBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, height: 32, borderRadius: radius.sm },
  colBtnOn: { backgroundColor: colors.bg },
  colText: { color: colors.muted, fontSize: 13, fontWeight: "600" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP },
  key: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
    gap: 6,
  },
  keyEditing: { borderStyle: "dashed", borderColor: colors.borderStrong },
  addKey: { borderStyle: "dashed", borderColor: colors.borderStrong, backgroundColor: "transparent" },
  keyLabel: { color: colors.text, fontSize: 12, fontWeight: "600", textAlign: "center", lineHeight: 15 },
  keyStatus: { fontSize: 10, fontWeight: "700", letterSpacing: 0.3, marginTop: -2 },
  editBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.cardStrong,
    alignItems: "center",
    justifyContent: "center",
  },
});
