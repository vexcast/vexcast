import Ionicons from "@expo/vector-icons/Ionicons";
import type { OutputState, OutputStatus } from "@vexcast/protocol";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Switch, Text, View } from "react-native";

import { CompatNotice } from "@/components/Banners";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { PlatformIcon, serviceToPlatform } from "@/components/PlatformIcon";
import { PreviewImage } from "@/components/PreviewImage";
import { Screen } from "@/components/Screen";
import { StreamInfoCard } from "@/components/StreamInfoCard";
import { Button, Card, Pill, PulseDot, SectionTitle, type IconName } from "@/components/ui";
import { formatBitrate, formatDuration, formatMemory } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { useT, type TKey } from "@/lib/i18n";
import { useRemote } from "@/state/remote";
import { colors, font, radius } from "@/theme";

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

const stateColor: Record<OutputState, string> = {
  idle: colors.muted,
  starting: colors.warning,
  active: colors.success,
  reconnecting: colors.warning,
  stopping: colors.warning,
  error: colors.danger,
};

/** Outputs that are not stream destinations. */
const LOCAL_OUTPUTS: { id: string; label: TKey; icon: IconName }[] = [
  { id: "record", label: "output.record", icon: "radio-button-on" },
  { id: "replay", label: "output.replay", icon: "film-outline" },
  { id: "virtualcam", label: "output.virtualcam", icon: "videocam-outline" },
];

interface OutputRow {
  key: string;
  name: string;
  platform: string;
  icon?: IconName;
  enabled: boolean;
  /** A stream destination (can be switched on/off), not a local output. */
  dest: boolean;
  out: OutputStatus | undefined;
}

const pct = (part: number, total: number) => (total > 0 ? `${((part / total) * 100).toFixed(1)}%` : "0%");

export default function Dashboard() {
  const t = useT();
  const { state, stats, run, refresh, serverNow } = useRemote();
  const [confirm, setConfirm] = useState<"start" | "stop" | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  /** Optimistic on/off of destinations until the core's state confirms it. */
  const [destOverride, setDestOverride] = useState<Record<string, boolean>>({});
  const status = state?.status;
  const streaming = !!status?.streaming;
  const recording = !!status?.recording;
  const paused = recording && !!status?.recordingPaused;
  useNow(streaming || recording); // re-render every second while live/recording
  // Uptime on the core's clock: serverTime - startedAt + local time since the last status.
  const now = serverNow();

  if (!state || !status) return <Screen>{null}</Screen>;

  const ready = status.ready;
  const outputsById = new Map<string, OutputStatus>((stats?.outputs ?? []).map((o) => [o.id, o]));
  const recOut = outputsById.get("record");
  const uptime = streaming && status.streamStartedAt ? formatDuration(now - status.streamStartedAt) : "00:00";
  const recTime = recording
    ? paused && recOut
      ? formatDuration(recOut.durationMs)
      : status.recordingStartedAt
        ? formatDuration(now - status.recordingStartedAt)
        : null
    : null;
  const enabledDest = state.destinations.filter((d) => d.enabled);
  const programScene = state.scenes.find((s) => s.uuid === state.programSceneUuid);

  const rows: OutputRow[] = [
    ...state.destinations.map((d) => ({
      key: d.id,
      name: d.name,
      platform: serviceToPlatform(d.service),
      enabled: d.enabled,
      dest: true,
      out: outputsById.get(d.id),
    })),
    ...LOCAL_OUTPUTS.flatMap((o) => {
      const out = outputsById.get(o.id);
      return out && out.state !== "idle"
        ? [{ key: o.id, name: t(o.label), platform: "custom", icon: o.icon, enabled: true, dest: false, out }]
        : [];
    }),
  ];

  // Network drops across stream destinations.
  const streamOuts = (stats?.outputs ?? []).filter((o) => !LOCAL_OUTPUTS.some((l) => l.id === o.id));
  const netDropped = streamOuts.reduce((n, o) => n + o.droppedFrames, 0);
  const netTotal = streamOuts.reduce((n, o) => n + o.totalFrames, 0);

  async function act(id: string, fn: () => Promise<unknown>) {
    setPending(id);
    await fn();
    setPending(null);
  }

  async function onRefresh() {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <CompatNotice />

      {/* Live status hero */}
      <Card style={[styles.hero, streaming && styles.heroLive]}>
        <View style={styles.heroTop}>
          {streaming ? (
            <Pill label={t("dash.live")} color={colors.live} filled pulse />
          ) : (
            <Pill label={t("dash.offline")} color={colors.muted} icon="ellipse" />
          )}
          {recTime ? (
            <Pill
              label={`${paused ? t("dash.paused") : t("dash.recording")} ${recTime}`}
              color={paused ? colors.warning : colors.live}
              icon={paused ? "pause" : undefined}
              pulse={!paused}
            />
          ) : null}
          {status.replayBufferActive ? <Pill label={t("dash.replayActive")} color={colors.muted} icon="film-outline" /> : null}
          {status.virtualCamActive ? <Pill label={t("dash.vcamActive")} color={colors.muted} icon="videocam-outline" /> : null}
        </View>
        <Text style={[styles.uptime, !streaming && { color: colors.faint }]} accessibilityLabel={`uptime ${uptime}`}>
          {uptime}
        </Text>
        <View style={styles.sceneRow}>
          <Ionicons name="albums-outline" size={14} color={colors.muted} />
          <Text style={styles.sceneText} numberOfLines={1}>
            {t("dash.scene")}: <Text style={{ color: colors.text, fontWeight: "700" }}>{programScene?.name ?? "—"}</Text>
          </Text>
        </View>

        {!ready ? (
          <View style={[styles.warn, status.error ? styles.warnError : null]}>
            {status.error ? (
              <Ionicons name="warning-outline" size={16} color={colors.danger} />
            ) : (
              <ActivityIndicator size="small" color={colors.warning} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.warnTitle}>{status.error ? t("dash.engineError") : t("dash.engineStarting")}</Text>
              {status.error ? <Text style={styles.warnText}>{status.error}</Text> : null}
            </View>
          </View>
        ) : null}

        <Button
          label={streaming ? t("dash.endStream") : t("dash.goLive")}
          icon={streaming ? "stop-circle" : "radio"}
          variant={streaming ? "destructive" : "default"}
          size="lg"
          loading={pending === "stream"}
          disabled={!ready && !streaming}
          onPress={() => {
            haptic.medium();
            setConfirm(streaming ? "stop" : "start");
          }}
          style={{ marginTop: 14 }}
          testID="go-live"
        />
        <View style={styles.row}>
          <Button
            label={recording ? t("dash.stopRecord") : t("dash.record")}
            icon={recording ? "stop" : "radio-button-on"}
            variant="outline"
            loading={pending === "rec"}
            disabled={!ready && !recording}
            onPress={() => {
              haptic.medium();
              void act("rec", () => run((c) => (recording ? c.stopRecording() : c.startRecording())));
            }}
            style={{ flex: 1 }}
            testID="record"
          />
          <Button
            label={paused ? t("dash.resume") : t("dash.pause")}
            icon={paused ? "play" : "pause"}
            variant="outline"
            loading={pending === "pause"}
            disabled={!recording}
            onPress={() => {
              haptic.medium();
              void act("pause", () => run((c) => c.pauseRecording(!paused)));
            }}
            style={{ flex: 1 }}
            testID="record-pause"
          />
        </View>
        <View style={styles.row}>
          <Button
            label={status.replayBufferActive ? t("dash.replayStop") : t("dash.replayStart")}
            icon={status.replayBufferActive ? "stop" : "film-outline"}
            variant="outline"
            loading={pending === "replayToggle"}
            disabled={!ready && !status.replayBufferActive}
            onPress={() => {
              haptic.medium();
              void act("replayToggle", () =>
                run((c) => (status.replayBufferActive ? c.stopReplayBuffer() : c.startReplayBuffer())),
              );
            }}
            style={{ flex: 1 }}
            testID="replay-toggle"
          />
          <Button
            label={t("dash.replaySave")}
            icon="save-outline"
            variant="outline"
            loading={pending === "replay"}
            disabled={!status.replayBufferActive}
            onPress={() => {
              haptic.heavy();
              void act("replay", () => run((c) => c.saveReplay(), t("dash.replaySaved")));
            }}
            style={{ flex: 1 }}
            testID="replay-save"
          />
        </View>
        <Button
          label={status.virtualCamActive ? t("dash.vcamStop") : t("dash.vcamStart")}
          icon={status.virtualCamActive ? "stop" : "videocam-outline"}
          variant="outline"
          loading={pending === "vcam"}
          disabled={!ready && !status.virtualCamActive}
          onPress={() => {
            haptic.medium();
            void act("vcam", () => run((c) => (status.virtualCamActive ? c.stopVirtualCam() : c.startVirtualCam())));
          }}
          style={{ marginTop: 10 }}
          testID="vcam-toggle"
        />
      </Card>

      <StreamInfoCard />

      {/* Program preview */}
      <SectionTitle>{t("dash.preview")}</SectionTitle>
      <PreviewImage aspect={state.video.baseWidth / state.video.baseHeight || 16 / 9} />

      {/* Outputs: stream destinations + active local outputs */}
      <SectionTitle>{t("dash.outputs")}</SectionTitle>
      {state.destinations.length === 0 ? (
        <Card style={rows.length ? { marginBottom: 10 } : undefined}>
          <Text style={styles.muted}>{t("dash.noDestinations")}</Text>
        </Card>
      ) : null}
      {rows.length > 0 ? (
        <View style={styles.chips}>
          {rows.map((r) => {
            const s: OutputState = r.out?.state ?? "idle";
            const color = r.enabled ? stateColor[s] : colors.faint;
            return (
              <View key={r.key} style={styles.chip}>
                <PlatformIcon platform={r.platform} icon={r.icon} size={30} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.chipName} numberOfLines={1}>
                    {r.name}
                  </Text>
                  <View style={styles.chipStateRow}>
                    <PulseDot color={color} active={s === "starting" || s === "reconnecting" || s === "stopping"} size={6} />
                    <Text style={[styles.chipState, { color }]}>
                      {r.enabled ? t(`state.${s}` as TKey) : t("state.disabled")}
                    </Text>
                  </View>
                  {r.out?.error ? (
                    <Text style={[styles.chipStats, { color: colors.danger }]} numberOfLines={2}>
                      {r.out.error}
                    </Text>
                  ) : r.out && s !== "idle" ? (
                    <Text style={styles.chipStats} numberOfLines={1}>
                      {`${r.out.kbps > 0 ? `${formatBitrate(r.out.kbps)} · ` : ""}${r.out.droppedFrames}/${r.out.totalFrames} ${t("dash.dropped")} (${pct(r.out.droppedFrames, r.out.totalFrames)})`}
                    </Text>
                  ) : null}
                </View>
                {r.dest ? (
                  <Switch
                    value={destOverride[r.key] ?? r.enabled}
                    onValueChange={(v) => {
                      haptic.tap();
                      setDestOverride((o) => ({ ...o, [r.key]: v }));
                      void run((c) => c.updateDestination(r.key, { enabled: v })).finally(() =>
                        setDestOverride((o) => {
                          const { [r.key]: _, ...rest } = o;
                          return rest;
                        }),
                      );
                    }}
                    trackColor={{ false: colors.cardStrong, true: colors.primary }}
                    thumbColor={(destOverride[r.key] ?? r.enabled) ? colors.primaryFg : colors.muted}
                    ios_backgroundColor={colors.cardStrong}
                    {...({ activeThumbColor: colors.primaryFg } as object)}
                    accessibilityLabel={`${r.name}: ${t("dash.destEnabled")}`}
                    testID={`dest-toggle-${r.key}`}
                  />
                ) : null}
              </View>
            );
          })}
          {streaming && state.destinations.length > 0 ? <Text style={styles.destHint}>{t("dash.destLiveHint")}</Text> : null}
        </View>
      ) : null}

      {/* Stats */}
      <SectionTitle>{t("dash.stats")}</SectionTitle>
      <View style={styles.stats}>
        <Stat
          icon="speedometer-outline"
          label={t("dash.fps")}
          value={stats ? stats.fps.toFixed(0) : "—"}
          sub={stats ? `/ ${Math.round(stats.targetFps)}` : undefined}
          warn={!!stats && stats.targetFps > 0 && stats.fps < stats.targetFps * 0.9}
        />
        <Stat
          icon="hardware-chip-outline"
          label={t("dash.cpu")}
          value={stats ? `${stats.cpu.toFixed(0)}%` : "—"}
          warn={(stats?.cpu ?? 0) > 85}
        />
        <Stat icon="server-outline" label={t("dash.memory")} value={stats ? formatMemory(stats.memoryMb) : "—"} />
        <Stat
          icon="timer-outline"
          label={t("dash.renderLag")}
          value={stats ? String(stats.renderSkipped) : "—"}
          sub={stats ? pct(stats.renderSkipped, stats.renderTotal) : undefined}
          warn={(stats?.renderSkipped ?? 0) > 0}
        />
        <Stat
          icon="flash-outline"
          label={t("dash.encodingLag")}
          value={stats ? String(stats.encodingSkipped) : "—"}
          sub={stats ? pct(stats.encodingSkipped, stats.encodingTotal) : undefined}
          warn={(stats?.encodingSkipped ?? 0) > 0}
        />
        <Stat
          icon="cloud-offline-outline"
          label={t("dash.networkDropped")}
          value={stats ? String(netDropped) : "—"}
          sub={stats ? pct(netDropped, netTotal) : undefined}
          warn={netDropped > 0}
        />
      </View>

      <ConfirmSheet
        visible={confirm !== null}
        icon={confirm === "stop" ? "stop-circle" : "radio"}
        destructive={confirm === "stop"}
        title={confirm === "stop" ? t("dash.confirmEndTitle") : t("dash.confirmGoLiveTitle")}
        body={confirm === "stop" ? t("dash.confirmEndBody") : t("dash.confirmGoLiveBody", { count: enabledDest.length })}
        confirmLabel={confirm === "stop" ? t("dash.endStream") : t("dash.goLive")}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const which = confirm;
          setConfirm(null);
          haptic.heavy();
          void act("stream", async () => {
            const r = await run(
              (c) => (which === "stop" ? c.stopStream() : c.startStream()).then(() => true),
              which === "stop" ? t("dash.streamStopped") : t("dash.streamStarted"),
            );
            if (r) haptic.success();
          });
        }}
      />
    </Screen>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
  warn,
  small,
}: {
  icon: IconName;
  label: string;
  value: string;
  sub?: string;
  warn?: boolean;
  small?: boolean;
}) {
  return (
    <Card style={styles.stat}>
      <View style={styles.statHead}>
        <Ionicons name={icon} size={14} color={warn ? colors.warning : colors.muted} />
        <Text style={styles.statLabel} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text style={[styles.statValue, small && { fontSize: 17 }, warn && { color: colors.warning }]} numberOfLines={1}>
        {value}
        {sub ? <Text style={styles.statSub}> {sub}</Text> : null}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  hero: { paddingVertical: 18 },
  heroLive: { borderColor: "rgba(239,68,68,0.45)" },
  heroTop: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  uptime: {
    color: colors.text,
    fontSize: 50,
    fontWeight: "700",
    letterSpacing: -1.5,
    fontVariant: ["tabular-nums"],
    marginTop: 8,
  },
  sceneRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  sceneText: { color: colors.muted, fontSize: 14, flexShrink: 1 },
  warn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
    padding: 10,
    borderRadius: radius.sm,
    backgroundColor: "rgba(245,158,11,0.08)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.3)",
  },
  warnError: { backgroundColor: "rgba(255,100,103,0.08)", borderColor: "rgba(255,100,103,0.35)" },
  warnTitle: { color: colors.text, fontSize: 13, fontWeight: "600" },
  warnText: { color: colors.textDim, fontSize: 12, lineHeight: 17, marginTop: 2 },
  row: { flexDirection: "row", gap: 10, marginTop: 10 },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  chips: { gap: 10 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipName: { color: colors.text, fontWeight: "600", fontSize: 15 },
  chipStateRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  chipState: { fontSize: 12, fontWeight: "600" },
  destHint: { color: colors.muted, fontSize: 12, lineHeight: 17, paddingHorizontal: 2 },
  chipStats: { color: colors.muted, fontSize: 12, marginTop: 2, fontFamily: font.mono },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  stat: { flexBasis: "47%", flexGrow: 1, padding: 14 },
  statHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  statLabel: { color: colors.muted, fontSize: 12, fontWeight: "500" },
  statValue: { color: colors.text, fontSize: 24, fontWeight: "700", marginTop: 6, fontVariant: ["tabular-nums"] },
  statSub: { color: colors.faint, fontSize: 14, fontWeight: "500" },
});
