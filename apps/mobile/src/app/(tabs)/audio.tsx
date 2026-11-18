import Ionicons from "@expo/vector-icons/Ionicons";
import Slider from "@react-native-community/slider";
import type { AppState, SceneItem, SourceInfo } from "@vexcast/protocol";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { LevelMeter } from "@/components/LevelMeter";
import { Screen } from "@/components/Screen";
import { Card, EmptyState, IconTile, SectionTitle, type IconName } from "@/components/ui";
import { dbLabel, dbToFader, faderToDb, volumeToDb } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { useRemote } from "@/state/remote";
import { colors, font, radius } from "@/theme";

function sourceIcon(s: SourceInfo): IconName {
  const k = s.baseKind || s.kind;
  if (s.globalSlot?.startsWith("mic") || k.includes("input_capture")) return "mic";
  if (s.globalSlot?.startsWith("desktop") || k.includes("output_capture")) return "volume-high";
  if (k.includes("process")) return "apps";
  if (k.includes("browser")) return "globe";
  if (k.includes("ffmpeg") || k.includes("vlc") || s.controllableMedia) return "film";
  if (k.includes("dshow") || k.includes("av_capture") || k.includes("v4l2")) return "videocam";
  return "musical-notes";
}

/**
 * Audio sources shown in the mixer, like OBS: global devices plus every audio
 * source used (directly, in a group or through a nested scene) by the program scene.
 */
function mixerSources(state: AppState): SourceInfo[] {
  const used = new Set<string>();
  const scenes = new Map(state.scenes.map((s) => [s.uuid, s]));
  const visited = new Set<string>();
  const walk = (items: SceneItem[]) => {
    for (const it of items) {
      used.add(it.sourceUuid);
      if (it.items?.length) walk(it.items);
      const nested = scenes.get(it.sourceUuid);
      if (nested && !visited.has(nested.uuid)) {
        visited.add(nested.uuid);
        walk(nested.items);
      }
    }
  };
  const program = state.programSceneUuid ? scenes.get(state.programSceneUuid) : undefined;
  if (program) {
    visited.add(program.uuid);
    walk(program.items);
  }
  const audio = state.sources.filter((s) => s.audio && (s.globalSlot != null || used.has(s.uuid)));
  // Global devices first (desktop audio, mics), then scene sources — OBS order.
  return [...audio.filter((s) => s.globalSlot != null), ...audio.filter((s) => s.globalSlot == null)];
}

export default function Audio() {
  const t = useT();
  const { state } = useRemote();
  const sources = useMemo(() => (state ? mixerSources(state) : []), [state]);
  if (!state) return <Screen>{null}</Screen>;
  return (
    <Screen>
      <SectionTitle>{t("audio.title")}</SectionTitle>
      {sources.length === 0 ? (
        <EmptyState icon="volume-mute-outline" text={t("audio.empty")} />
      ) : (
        sources.map((s) => <Channel key={s.uuid} source={s} />)
      )}
    </Screen>
  );
}

/** Fader position (0..1, OBS log curve) of a source's current volume. */
const positionOf = (s: SourceInfo) => dbToFader(volumeToDb(s.volume));

function Channel({ source }: { source: SourceInfo }) {
  const t = useT();
  const { run } = useRemote();
  const [pos, setPos] = useState(() => positionOf(source));
  const [optimisticMute, setOptimisticMute] = useState<boolean | null>(null);
  const dragging = useRef(false);
  const touched = useRef(false);
  const lastSent = useRef(0);
  const muted = optimisticMute ?? source.muted;

  // Follow server changes unless the user is dragging.
  useEffect(() => {
    if (!dragging.current) {
      setPos(positionOf(source));
      touched.current = false;
    }
  }, [source.volume]);
  useEffect(() => setOptimisticMute(null), [source.muted]);

  // Until the user moves the fader, show the real value (it may be above 0 dB if set on the PC).
  const shownDb = touched.current ? faderToDb(pos) : volumeToDb(source.volume);

  function send(p: number) {
    const db = faderToDb(p);
    // -inf is not representable in JSON: send a linear 0 instead.
    void run((c) => c.updateSource(source.uuid, Number.isFinite(db) ? { volumeDb: db } : { volume: 0 }));
  }

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <IconTile
          icon={sourceIcon(source)}
          color={muted ? colors.live : colors.text}
          bg={muted ? "rgba(239,68,68,0.12)" : colors.cardStrong}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>
            {source.name}
          </Text>
          <Text style={styles.db}>{muted ? `${t("audio.muted")} · ${dbLabel(shownDb)}` : dbLabel(shownDb)}</Text>
        </View>
        <Pressable
          onPress={() => {
            haptic.medium();
            const next = !muted;
            setOptimisticMute(next);
            void run((c) => c.updateSource(source.uuid, { muted: next })).then((r) => {
              if (r === undefined) setOptimisticMute(null);
            });
          }}
          style={({ pressed }) => [styles.mute, muted && styles.muteOn, pressed && { opacity: 0.7 }]}
          accessibilityRole="switch"
          accessibilityState={{ checked: muted }}
          accessibilityLabel={muted ? t("audio.unmute") : t("audio.mute")}
          testID={`mute-${source.uuid}`}
        >
          <Ionicons name={muted ? "volume-mute" : "volume-high"} size={20} color={muted ? "#fff" : colors.text} />
        </Pressable>
      </View>
      <LevelMeter sourceUuid={source.uuid} muted={muted} />
      <View>
        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={1}
          step={0.001}
          value={pos}
          minimumTrackTintColor={muted ? colors.faint : colors.primary}
          maximumTrackTintColor={colors.cardStrong}
          thumbTintColor={colors.text}
          onSlidingStart={() => {
            dragging.current = true;
            touched.current = true;
          }}
          onValueChange={(p) => {
            touched.current = true;
            setPos(p);
            const now = Date.now();
            if (now - lastSent.current > 120) {
              lastSent.current = now;
              send(p);
            }
          }}
          onSlidingComplete={(p) => {
            dragging.current = false;
            setPos(p);
            send(p);
            haptic.tap();
          }}
          accessibilityLabel={`${source.name} volume`}
        />
        <View style={styles.scale} pointerEvents="none">
          {[-60, -30, -20, -10, -5, 0].map((db) => (
            <Text key={db} style={[styles.scaleText, { left: `${dbToFader(db) * 100}%` }]}>
              {db}
            </Text>
          ))}
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  name: { color: colors.text, fontSize: 15, fontWeight: "600" },
  db: { color: colors.muted, fontSize: 12, marginTop: 2, fontFamily: font.mono },
  mute: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  muteOn: { backgroundColor: colors.liveDeep, borderColor: colors.live },
  slider: { width: "100%", height: 36 },
  scale: { height: 14, marginTop: -4, marginHorizontal: 14 },
  scaleText: {
    position: "absolute",
    width: 28,
    marginLeft: -14,
    textAlign: "center",
    color: colors.faint,
    fontSize: 10,
    fontWeight: "700",
  },
});
