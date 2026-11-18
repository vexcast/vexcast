import Ionicons from "@expo/vector-icons/Ionicons";
import type { SceneInfo, TransitionInfo } from "@vexcast/protocol";
import { useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";

import { Screen } from "@/components/Screen";
import { Button, Card, EmptyState, IconTile, SectionTitle } from "@/components/ui";
import { haptic } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { useRemote } from "@/state/remote";
import { colors, radius } from "@/theme";

export default function Scenes() {
  const t = useT();
  const { state, run } = useRemote();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);

  if (!state) return <Screen>{null}</Screen>;
  const studio = state.status.studioMode;
  const programUuid = state.programSceneUuid;
  const previewUuid = studio ? state.previewSceneUuid : null;
  const current = state.transitions.find((tr) => tr.uuid === state.currentTransitionUuid);

  async function onTile(scene: SceneInfo) {
    // In studio mode the core stages the scene in preview instead of program.
    if (scene.uuid === (studio ? previewUuid : programUuid)) return;
    haptic.medium();
    setPendingId(scene.uuid);
    await run((c) => c.setProgramScene(scene.uuid));
    setPendingId(null);
  }

  async function toggleStudio(on: boolean) {
    haptic.light();
    await run((c) => c.setStudioMode(on));
  }

  async function transition() {
    haptic.heavy();
    setTransitioning(true);
    await run((c) => c.transitionToProgram());
    setTransitioning(false);
  }

  async function pickTransition(tr: TransitionInfo) {
    if (tr.uuid === state?.currentTransitionUuid) return;
    haptic.light();
    await run((c) => c.setCurrentTransition(tr.uuid));
  }

  const transitionLabel = (tr: TransitionInfo | undefined) =>
    tr ? (tr.fixed ? tr.name : `${tr.name} · ${state.transitionDurationMs} ms`) : "—";

  return (
    <Screen>
      <Card style={styles.studioCard}>
        <View style={styles.studioRow}>
          <IconTile icon="git-compare-outline" />
          <View style={{ flex: 1 }}>
            <Text style={styles.studioTitle}>{t("scenes.studio")}</Text>
            <Text style={styles.studioMeta}>
              {transitionLabel(current)}
            </Text>
          </View>
          <Switch
            value={studio}
            onValueChange={toggleStudio}
            trackColor={{ false: colors.cardStrong, true: colors.primary }}
            thumbColor={studio ? colors.primaryFg : colors.muted}
            ios_backgroundColor={colors.cardStrong}
            // react-native-web colours the "on" thumb with activeThumbColor
            {...({ activeThumbColor: colors.primaryFg } as object)}
            accessibilityLabel={t("scenes.studio")}
          />
        </View>
        {studio ? <Text style={styles.studioHint}>{t("scenes.studioHint")}</Text> : null}
        {state.transitions.length > 1 ? (
          <View style={styles.transitions} accessibilityLabel={t("scenes.transitions")}>
            {state.transitions.map((tr) => {
              const active = tr.uuid === state.currentTransitionUuid;
              return (
                <Pressable
                  key={tr.uuid}
                  onPress={() => pickTransition(tr)}
                  style={({ pressed }) => [styles.trChip, active && styles.trChipActive, pressed && { opacity: 0.7 }]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  testID={`transition-${tr.uuid}`}
                >
                  <Text style={[styles.trChipText, active && { color: colors.primaryFg, fontWeight: "600" }]} numberOfLines={1}>
                    {tr.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </Card>

      {studio ? (
        <Button
          label={t("scenes.transition")}
          icon="swap-horizontal"
          size="lg"
          loading={transitioning}
          disabled={!previewUuid || previewUuid === programUuid}
          onPress={transition}
          testID="studio-transition"
        />
      ) : null}

      <SectionTitle>{t("scenes.title")}</SectionTitle>
      {state.scenes.length === 0 ? (
        <EmptyState icon="albums-outline" text={t("scenes.empty")} />
      ) : (
        <View style={styles.grid}>
          {state.scenes.map((scene, i) => {
            const program = scene.uuid === programUuid;
            const preview = studio && scene.uuid === previewUuid;
            const selected = studio ? preview : program;
            return (
              <Pressable
                key={scene.uuid}
                onPress={() => onTile(scene)}
                style={({ pressed }) => [
                  styles.tile,
                  selected && styles.tileSelected,
                  pressed && !selected && { backgroundColor: colors.accent },
                  { transform: [{ scale: pressed ? 0.98 : 1 }] },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: program }}
                accessibilityLabel={scene.name}
                testID={`scene-${scene.uuid}`}
              >
                <View style={styles.tileTop}>
                  <Text style={[styles.tileNum, selected && { color: colors.muted }]}>{i + 1}</Text>
                  {program ? (
                    <View style={styles.tag}>
                      <View style={styles.liveDot} />
                      <Text style={[styles.tagText, { color: colors.live }]}>{t("scenes.program")}</Text>
                    </View>
                  ) : preview ? (
                    <View style={[styles.tag, styles.tagPreview]}>
                      <Text style={styles.tagText}>{t("scenes.preview")}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.tileName} numberOfLines={2}>
                  {scene.name}
                </Text>
                <Text style={styles.tileMeta}>
                  {pendingId === scene.uuid ? "…" : t("scenes.sources", { count: scene.items.length })}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  studioCard: { gap: 12 },
  studioRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  studioTitle: { color: colors.text, fontSize: 15, fontWeight: "600" },
  studioMeta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  studioHint: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  transitions: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  trChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.input,
  },
  trChipActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  trChipText: { color: colors.muted, fontSize: 13, fontWeight: "500" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: {
    flexBasis: "47%",
    flexGrow: 1,
    minHeight: 112,
    borderRadius: radius.xl,
    padding: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    justifyContent: "space-between",
  },
  tileSelected: { borderColor: colors.primary, borderWidth: 2, padding: 13, backgroundColor: colors.accent },
  tileTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  tileNum: { color: colors.faint, fontSize: 12, fontWeight: "600", fontVariant: ["tabular-nums"] },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(239,68,68,0.12)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.4)",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  tagPreview: { backgroundColor: colors.cardStrong, borderColor: colors.borderStrong },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.live },
  tagText: { color: colors.text, fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },
  tileName: { color: colors.text, fontSize: 16, fontWeight: "600", marginTop: 12, letterSpacing: -0.2 },
  tileMeta: { color: colors.muted, fontSize: 12, marginTop: 4 },
});
