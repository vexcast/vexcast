import Ionicons from "@expo/vector-icons/Ionicons";
import type { AppState } from "@vexcast/protocol";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ConfirmSheet } from "@/components/ConfirmSheet";
import { Screen } from "@/components/Screen";
import { Button, Card, Field, SectionTitle } from "@/components/ui";
import {
  ACTION_GROUPS,
  ALERT_TYPES,
  actionIcon,
  DECK_COLORS,
  describe,
  newAction,
  newButtonId,
  useDeck,
  type DeckAction,
  type DeckActionType,
  type DeckButton,
} from "@/lib/deck";
import { haptic } from "@/lib/haptics";
import { useT, type TKey } from "@/lib/i18n";
import { useRemote } from "@/state/remote";
import { colors, radius } from "@/theme";

type Item = AppState["scenes"][number]["items"][number];
const flatItems = (items: Item[], depth = 0): { item: Item; depth: number }[] =>
  [...items].reverse().flatMap((it) => [{ item: it, depth }, ...(it.items?.length ? flatItems(it.items, depth + 1) : [])]);

export default function DeckButtonEditor() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state } = useRemote();
  const { deck, saveButton, removeButton, moveButton } = useDeck();
  const existing = deck?.buttons.find((b) => b.id === id);
  const index = existing ? deck!.buttons.indexOf(existing) : -1;
  const [action, setAction] = useState<DeckAction>(() => existing?.action ?? newAction("scene", state));
  const [label, setLabel] = useState(existing?.label ?? "");
  const [color, setColor] = useState<string | undefined>(existing?.color);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const draft: DeckButton = { id: existing?.id ?? "draft", action, label: label.trim() || undefined, color };
  const view = state ? describe(draft, state, t) : null;
  const valid = useMemo(() => {
    switch (action.type) {
      case "scene":
        return !!action.scene;
      case "transition":
        return !!action.transition;
      case "mute":
      case "media":
        return !!action.source;
      case "visibility":
        return !!action.scene && action.item >= 0;
      case "chat":
      case "speak":
        return !!action.text.trim();
      default:
        return true;
    }
  }, [action]);

  if (!state) return <Screen>{null}</Screen>;

  const save = () => {
    haptic.success();
    saveButton({ ...draft, id: existing?.id ?? newButtonId() });
    router.back();
  };

  const pickType = (type: DeckActionType) => {
    if (type === action.type) return;
    haptic.tap();
    setAction(newAction(type, state));
  };

  return (
    <>
      <Stack.Screen options={{ title: existing ? t("deck.editTitle") : t("deck.newTitle") }} />
      <Screen>
        {/* Live preview of the key */}
        {view ? (
          <View style={styles.previewRow}>
            <View style={[styles.previewKey, view.active && { backgroundColor: `${color ?? view.tone}26`, borderColor: color ?? view.tone }]}>
              <Ionicons name={view.missing ? "help-circle-outline" : view.icon} size={30} color={view.active ? (color ?? view.tone) : (color ?? colors.text)} />
              <Text style={styles.previewLabel} numberOfLines={2}>
                {view.label}
              </Text>
              {view.status ? <Text style={[styles.previewStatus, { color: view.active ? (color ?? view.tone) : colors.muted }]}>{view.status}</Text> : null}
            </View>
          </View>
        ) : null}

        {/* Action */}
        {ACTION_GROUPS.map((g) => (
          <View key={g.group} style={{ gap: 8 }}>
            <SectionTitle>{t(`deck.g.${g.group}` as TKey)}</SectionTitle>
            <View style={styles.chips}>
              {g.types.map((type) => {
                const on = action.type === type;
                return (
                  <Pressable
                    key={type}
                    onPress={() => pickType(type)}
                    style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && !on && { backgroundColor: colors.accent }]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    testID={`deck-type-${type}`}
                  >
                    <Ionicons name={actionIcon(type)} size={15} color={on ? colors.primaryFg : colors.muted} />
                    <Text style={[styles.chipText, on && { color: colors.primaryFg }]}>{t(`deck.a.${type}` as TKey)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}

        {/* Target */}
        <Target action={action} setAction={setAction} state={state} />

        {/* Look */}
        <SectionTitle>{t("deck.label")}</SectionTitle>
        <Field value={label} onChangeText={setLabel} placeholder={view ? describe({ ...draft, label: undefined }, state, t).label : ""} maxLength={40} testID="deck-label" />

        <SectionTitle>{t("deck.color")}</SectionTitle>
        <View style={styles.colors}>
          <Swatch selected={!color} onPress={() => setColor(undefined)} auto />
          {DECK_COLORS.map((c) => (
            <Swatch key={c} color={c} selected={color === c} onPress={() => setColor(c)} />
          ))}
        </View>

        <Button label={t("deck.save")} icon="checkmark" onPress={save} disabled={!valid} style={{ marginTop: 10 }} testID="deck-save" />

        {existing ? (
          <>
            <View style={styles.row}>
              <Button label={t("deck.moveBack")} icon="arrow-back" variant="outline" size="sm" disabled={index <= 0} onPress={() => moveButton(existing.id, -1)} style={{ flex: 1 }} />
              <Button
                label={t("deck.moveForward")}
                icon="arrow-forward"
                variant="outline"
                size="sm"
                disabled={index >= (deck?.buttons.length ?? 0) - 1}
                onPress={() => moveButton(existing.id, 1)}
                style={{ flex: 1 }}
              />
            </View>
            <Button label={t("deck.delete")} icon="trash-outline" variant="ghost" onPress={() => setConfirmDelete(true)} testID="deck-delete" />
          </>
        ) : null}
      </Screen>

      <ConfirmSheet
        visible={confirmDelete}
        icon="trash-outline"
        destructive
        title={t("deck.delete")}
        body={view?.label}
        confirmLabel={t("common.delete")}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          if (existing) removeButton(existing.id);
          router.back();
        }}
      />
    </>
  );
}

function Target({ action, setAction, state }: { action: DeckAction; setAction: (a: DeckAction) => void; state: AppState }) {
  const t = useT();
  switch (action.type) {
    case "scene":
      return (
        <Picker
          title={t("deck.scene")}
          options={state.scenes.map((s) => ({ id: s.uuid, label: s.name, icon: "albums-outline" as const }))}
          value={action.scene}
          onChange={(scene) => setAction({ ...action, scene })}
        />
      );
    case "transition":
      return (
        <Picker
          title={t("deck.transition")}
          options={state.transitions.map((x) => ({ id: x.uuid, label: x.name, icon: "shuffle" as const }))}
          value={action.transition}
          onChange={(transition) => setAction({ ...action, transition })}
        />
      );
    case "mute":
      return (
        <Picker
          title={t("deck.source")}
          options={state.sources.filter((s) => s.audio).map((s) => ({ id: s.uuid, label: s.name, icon: "mic-outline" as const }))}
          value={action.source}
          onChange={(source) => setAction({ ...action, source })}
        />
      );
    case "media":
      return (
        <Picker
          title={t("deck.source")}
          options={state.sources.filter((s) => s.controllableMedia).map((s) => ({ id: s.uuid, label: s.name, icon: "film-outline" as const }))}
          value={action.source}
          onChange={(source) => setAction({ ...action, source })}
        />
      );
    case "visibility": {
      const scene = state.scenes.find((s) => s.uuid === action.scene);
      return (
        <>
          <Picker
            title={t("deck.scene")}
            options={state.scenes.map((s) => ({ id: s.uuid, label: s.name, icon: "albums-outline" as const }))}
            value={action.scene}
            onChange={(sceneUuid) => {
              const first = state.scenes.find((s) => s.uuid === sceneUuid)?.items.at(-1)?.id ?? -1;
              setAction({ ...action, scene: sceneUuid, item: first });
            }}
          />
          <Picker
            title={t("deck.item")}
            options={flatItems(scene?.items ?? []).map(({ item, depth }) => ({
              id: String(item.id),
              label: item.name,
              icon: (item.visible ? "eye-outline" : "eye-off-outline") as "eye-outline",
              depth,
            }))}
            value={String(action.item)}
            onChange={(item) => setAction({ ...action, item: Number(item) })}
          />
        </>
      );
    }
    case "testAlert":
      return (
        <Picker
          title={t("deck.alertType")}
          options={ALERT_TYPES.map((a) => ({ id: a, label: t(`alert.${a}` as TKey), icon: "notifications-outline" as const }))}
          value={action.alert}
          onChange={(alert) => setAction({ ...action, alert: alert as typeof action.alert })}
        />
      );
    case "chat":
    case "speak":
      return (
        <>
          <SectionTitle>{t("deck.text")}</SectionTitle>
          <Field
            value={action.text}
            onChangeText={(text) => setAction({ ...action, text })}
            placeholder={action.type === "chat" ? t("deck.textChatPh") : t("deck.textSpeakPh")}
            maxLength={action.type === "chat" ? 500 : 400}
            multiline
            autoCapitalize="sentences"
            autoCorrect
            style={{ minHeight: 70, textAlignVertical: "top" }}
            testID="deck-text"
          />
        </>
      );
    default:
      return null;
  }
}

function Picker({
  title,
  options,
  value,
  onChange,
}: {
  title: string;
  options: { id: string; label: string; icon: React.ComponentProps<typeof Ionicons>["name"]; depth?: number }[];
  value: string;
  onChange: (id: string) => void;
}) {
  const t = useT();
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      {options.length === 0 ? (
        <Text style={styles.none}>{t("deck.noTargets")}</Text>
      ) : (
        <Card padded={false}>
          {options.map((o, i) => {
            const on = o.id === value;
            return (
              <Pressable
                key={o.id}
                onPress={() => {
                  haptic.tap();
                  onChange(o.id);
                }}
                style={({ pressed }) => [styles.option, i > 0 && styles.divider, { paddingLeft: 14 + (o.depth ?? 0) * 18 }, pressed && { backgroundColor: colors.accent }]}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
              >
                <Ionicons name={o.icon} size={17} color={on ? colors.text : colors.muted} />
                <Text style={[styles.optionText, on && { color: colors.text, fontWeight: "600" }]} numberOfLines={1}>
                  {o.label}
                </Text>
                {on ? <Ionicons name="checkmark" size={18} color={colors.text} /> : null}
              </Pressable>
            );
          })}
        </Card>
      )}
    </>
  );
}

function Swatch({ color, selected, onPress, auto }: { color?: string; selected: boolean; onPress: () => void; auto?: boolean }) {
  return (
    <Pressable
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      style={[styles.swatch, selected && styles.swatchOn]}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={auto ? "auto" : color}
    >
      {auto ? (
        <Ionicons name="color-wand-outline" size={16} color={colors.muted} />
      ) : (
        <View style={[styles.swatchDot, { backgroundColor: color }]} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  previewRow: { alignItems: "center", paddingVertical: 6 },
  previewKey: {
    width: 118,
    height: 118,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
    gap: 6,
  },
  previewLabel: { color: colors.text, fontSize: 13, fontWeight: "600", textAlign: "center" },
  previewStatus: { fontSize: 10, fontWeight: "700", letterSpacing: 0.3, marginTop: -2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    height: 34,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.input,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textDim, fontSize: 13, fontWeight: "500" },
  option: { flexDirection: "row", alignItems: "center", gap: 10, paddingRight: 14, paddingVertical: 12 },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  optionText: { color: colors.textDim, fontSize: 15, flex: 1 },
  none: { color: colors.muted, fontSize: 14 },
  colors: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  swatch: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  swatchOn: { borderColor: colors.text, borderWidth: 2 },
  swatchDot: { width: 24, height: 24, borderRadius: 12 },
  row: { flexDirection: "row", gap: 10 },
});
