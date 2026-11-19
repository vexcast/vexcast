/**
 * The phone camera, live, over the local network: the WebView captures the camera and
 * streams it with WebRTC; this component relays the signalling between the WebView and
 * the core (`/phonecam/ws`), keeps the screen on and shows what's going on.
 */
import Ionicons from "@expo/vector-icons/Ionicons";
import { API_PREFIX, phoneCamSource, revealPlan, sourceInScene } from "@vexcast/protocol";
import { useKeepAwake } from "expo-keep-awake";
import { useCallback, useEffect, useRef, useState, type ComponentType, type Ref } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { WebView, type WebViewMessageEvent, type WebViewProps } from "react-native-webview";

import { haptic } from "@/lib/haptics";
import { useT, type TKey } from "@/lib/i18n";
import { PHONECAM_BASE_URL, PHONECAM_PAGE } from "@/lib/phonecam-page";
import { useRemote } from "@/state/remote";
import { useToast } from "@/state/toasts";
import { colors, radius } from "@/theme";
import { CameraSettingsSheet, type CameraCaps, type CameraControls, type CameraLook } from "./CameraSettingsSheet";
import { Button, type IconName } from "./ui";

// The package's class typings don't resolve against this React version's JSX types.
const Web = WebView as unknown as ComponentType<WebViewProps & { ref?: Ref<WebView> }>;

export interface LiveCameraConfig extends CameraLook {
  room: string;
  facing: "rear" | "front";
  deviceId: string | null;
  orientation: "landscape" | "portrait";
}

interface Status {
  phase: "starting" | "camera" | "error";
  error: string | null;
  viewers: number;
  connected: number;
}

const ERRORS: Record<string, TKey> = {
  NotAllowedError: "cam.errPermission",
  SecurityError: "cam.errPermission",
  NotReadableError: "cam.errBusy",
  AbortError: "cam.errBusy",
  NotFoundError: "cam.errNoCamera",
  OverconstrainedError: "cam.errNoCamera",
  unsupported: "cam.errUnsupported",
};

export function LiveCamera({
  config,
  onChange,
  onStop,
  landscape,
}: {
  config: LiveCameraConfig;
  onChange: (patch: Partial<LiveCameraConfig>) => void;
  onStop: () => void;
  landscape: boolean;
}) {
  useKeepAwake();
  const t = useT();
  const { session, state, run } = useRemote();
  const toast = useToast();
  const [fixing, setFixing] = useState(false);
  const web = useRef<WebView>(null);
  const [pageReady, setPageReady] = useState(false);
  const [online, setOnline] = useState(false);
  const [status, setStatus] = useState<Status>({ phase: "starting", error: null, viewers: 0, connected: 0 });
  const [devices, setDevices] = useState<{ id: string; label: string }[]>([]);
  const ws = useRef<WebSocket | null>(null);
  const [caps, setCaps] = useState<CameraCaps>({});
  const [controls, setControls] = useState<CameraControls>({});
  const [sheet, setSheet] = useState(false);

  const toPage = useCallback((msg: unknown) => {
    web.current?.injectJavaScript(`window.vx && window.vx.receive(${JSON.stringify(msg)}); true;`);
  }, []);

  // Signalling with the core, reconnecting while the screen is open.
  useEffect(() => {
    if (!session || !pageReady) return;
    let closed = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      const url = session.client.url(`${API_PREFIX}/phonecam/ws?role=send&id=${encodeURIComponent(config.room)}`, true).replace(/^http/, "ws");
      const sock = new WebSocket(url);
      ws.current = sock;
      sock.onopen = () => {
        retry = 0;
        setOnline(true);
        // The core re-announces the viewers to a new connection: start clean.
        toPage({ type: "reset" });
      };
      sock.onmessage = (ev) => {
        try {
          toPage({ type: "signal", data: JSON.parse(String(ev.data)) });
        } catch {
          /* not JSON */
        }
      };
      sock.onclose = () => {
        if (ws.current === sock) ws.current = null;
        setOnline(false);
        if (!closed) timer = setTimeout(open, Math.min(500 * 2 ** retry++, 5000));
      };
      sock.onerror = () => sock.close();
    };
    open();
    return () => {
      closed = true;
      clearTimeout(timer);
      ws.current?.close();
      ws.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, pageReady, config.room]);

  // Camera settings → the page (it reopens or swaps the camera live).
  const { facing, deviceId, quality, fps, orientation, mic, noise, mirror, flip, rotate, fit } = config;
  useEffect(() => {
    if (pageReady) toPage({ type: "config", facing, deviceId, quality, fps, orientation, mic, noise, label: t("cam.cameraN") });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageReady, facing, deviceId, quality, fps, orientation, mic, noise, toPage]);

  // Another camera: its zoom, torch, focus… start from that camera's own values.
  useEffect(() => {
    setControls({});
  }, [facing, deviceId]);

  // How Vexcast shows the image (the page forwards it to every viewer and mirrors it in the preview).
  useEffect(() => {
    if (pageReady) toPage({ type: "view", mirror, flip, rotate, fit });
  }, [pageReady, mirror, flip, rotate, fit, toPage]);

  const setControl = (patch: CameraControls) => {
    setControls((c) => ({ ...c, ...patch }));
    toPage({ type: "controls", ...patch });
  };

  const onMessage = (e: WebViewMessageEvent) => {
    let m: { type: string; [k: string]: unknown };
    try {
      m = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (m.type === "ready") setPageReady(true);
    else if (m.type === "signal") {
      if (ws.current?.readyState === 1) ws.current.send(JSON.stringify(m.data));
    } else if (m.type === "status") setStatus(m as unknown as Status);
    else if (m.type === "devices") {
      setDevices((m.list as { id: string; label: string }[]) ?? []);
    } else if (m.type === "caps") {
      setCaps((m.caps as CameraCaps) ?? {});
      // Start the sliders where the camera is (zoom 1×, exposure 0…) without overriding the user's values.
      const cur = (m.settings ?? {}) as CameraControls;
      setControls((c) => ({ ...cur, ...c }));
    }
  };

  const live = status.phase === "camera" && status.connected > 0;
  const [label, color] = !online
    ? [t("cam.stOffline"), colors.danger]
    : status.phase === "error"
      ? [t(ERRORS[status.error ?? ""] ?? "cam.errCamera"), colors.danger]
      : status.phase === "starting"
        ? [t("cam.stStarting"), colors.warning]
        : live
          ? [t("cam.stLive"), colors.success]
          : status.viewers > 0
            ? [t("cam.stConnecting"), colors.warning]
            : [t("cam.stWaiting"), colors.warning];

  const pick = (patch: Partial<LiveCameraConfig>) => {
    haptic.tap();
    onChange(patch);
  };

  const chips: { key: string; label: string; icon: IconName; on: boolean; patch: Partial<LiveCameraConfig> }[] = [
    { key: "rear", label: t("cam.rear"), icon: "camera-outline", on: !deviceId && facing === "rear", patch: { facing: "rear", deviceId: null } },
    { key: "front", label: t("cam.front"), icon: "person-circle-outline", on: !deviceId && facing === "front", patch: { facing: "front", deviceId: null } },
    ...devices.map((d) => ({ key: d.id, label: d.label, icon: "aperture-outline" as const, on: deviceId === d.id, patch: { deviceId: d.id } })),
  ];

  // Is the camera on air? The scene in program must show its source (visible).
  const programUuid = state?.programSceneUuid ?? null;
  const programName = state?.scenes.find((s) => s.uuid === programUuid)?.name ?? "";
  const camSource = state ? phoneCamSource(state.sources, config.room) : undefined;
  const onAir = state && camSource ? sourceInScene(state, programUuid, camSource.uuid) : "missing";
  // Studio mode: already in the preview scene = it goes on air with the next transition.
  const previewUuid = state?.status.studioMode ? state.previewSceneUuid : null;
  const inPreview = !!(state && camSource && previewUuid && previewUuid !== programUuid && sourceInScene(state, previewUuid, camSource.uuid) === "visible");
  const fixScene = async () => {
    if (!programUuid || !camSource) return;
    haptic.medium();
    setFixing(true);
    // Turn on whatever hides it (its item, a hidden group or nested scene), or add it.
    const plan = state ? revealPlan(state, programUuid, camSource.uuid) : null;
    if (!plan) await run((c) => c.addSourceToScene(programUuid, camSource.uuid), t("cam.addedHere", { scene: programName }));
    else {
      for (const step of plan) await run((c) => c.updateItem(step.sceneUuid, step.itemId, { visible: true }));
      toast.show(t("cam.shown"), "success");
    }
    setFixing(false);
  };

  const panel = (
    <View style={[styles.controls, landscape && styles.controlsSide]}>
      {state && programUuid && onAir !== "visible" ? (
        <View style={styles.warn}>
          <Ionicons name={inPreview ? "information-circle-outline" : "warning-outline"} size={18} color={inPreview ? colors.info : colors.warning} />
          <Text style={styles.warnText}>{inPreview ? t("cam.inPreview") : t(onAir === "hidden" ? "cam.sceneHidden" : "cam.sceneMissing", { scene: programName })}</Text>
          {camSource && !inPreview ? (
            <Button label={t(onAir === "hidden" ? "cam.showIt" : "cam.addHere")} size="sm" loading={fixing} onPress={fixScene} testID="phone-camera-add-here" />
          ) : null}
        </View>
      ) : null}
      <View style={styles.statusRow}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        <Text style={styles.statusText} numberOfLines={2}>
          {label}
        </Text>
      </View>
      {!live && online && status.phase === "camera" && status.viewers === 0 ? <Text style={styles.hint}>{t("cam.waitingHint")}</Text> : null}
      <ScrollView horizontal={!landscape} showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chips, landscape && { flexDirection: "column" }]}>
        {chips.map((c) => (
          <Pressable key={c.key} onPress={() => pick(c.patch)} style={[styles.chip, c.on && styles.chipOn]} accessibilityRole="radio" accessibilityState={{ selected: c.on }}>
            <Ionicons name={c.icon} size={15} color={c.on ? colors.text : colors.muted} />
            <Text style={[styles.chipText, c.on && { color: colors.text }]} numberOfLines={1}>
              {c.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={styles.tools}>
        <Tool icon="camera-reverse-outline" label={t("cam.switch")} onPress={() => onChange({ facing: facing === "front" ? "rear" : "front", deviceId: null })} />
        {caps.torch ? <Tool icon={controls.torch ? "flashlight" : "flashlight-outline"} label={t("cam.torch")} on={!!controls.torch} onPress={() => setControl({ torch: !controls.torch })} /> : null}
        <Tool icon="swap-horizontal" label={t("cam.mirror")} on={mirror} onPress={() => onChange({ mirror: !mirror })} />
        <Tool icon={mic ? "mic" : "mic-off"} label={t("cam.micShort")} on={mic} onPress={() => onChange({ mic: !mic })} />
        <Tool icon="options-outline" label={t("cam.settings")} onPress={() => setSheet(true)} testID="phone-camera-settings" />
      </View>
      {status.phase === "error" ? (
        <Button
          label={t("common.retry")}
          icon="refresh"
          variant="secondary"
          onPress={() => toPage({ type: "config", facing, deviceId, quality, fps, orientation, mic, noise, label: t("cam.cameraN") })}
        />
      ) : null}
      <Button label={t("cam.stop")} icon="stop" variant="destructive" onPress={onStop} testID="phone-camera-stop" />
    </View>
  );

  return (
    <View style={[styles.root, landscape && { flexDirection: "row" }]}>
      <View style={styles.preview}>
        <Web
          ref={web}
          source={{ html: PHONECAM_PAGE, baseUrl: PHONECAM_BASE_URL }}
          originWhitelist={["*"]}
          onMessage={onMessage}
          javaScriptEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          mediaCapturePermissionGrantType="grant"
          style={{ backgroundColor: "#000" }}
          containerStyle={{ backgroundColor: "#000" }}
        />
        {live ? (
          <View style={styles.liveBadge}>
            <View style={[styles.dot, { backgroundColor: "#fff" }]} />
            <Text style={styles.liveText}>VEXCAST</Text>
          </View>
        ) : null}
      </View>
      {panel}
      <CameraSettingsSheet
        visible={sheet}
        onClose={() => setSheet(false)}
        look={{ quality, fps, mic, noise, mirror, flip, rotate, fit }}
        onLook={(patch) => onChange(patch)}
        caps={caps}
        controls={controls}
        onControls={setControl}
        frontCamera={facing === "front" && !deviceId}
      />
    </View>
  );
}

function Tool({ icon, label, on, onPress, testID }: { icon: IconName; label: string; on?: boolean; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={on === undefined ? undefined : { selected: on }}
      testID={testID}
      style={({ pressed }) => [styles.tool, on && styles.toolOn, pressed && { opacity: 0.8 }]}
    >
      <Ionicons name={icon} size={20} color={on ? colors.primaryFg : colors.text} />
      <Text style={[styles.toolText, on && { color: colors.primaryFg }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, gap: 12 },
  preview: { flex: 1, borderRadius: radius.xl, overflow: "hidden", backgroundColor: "#000", borderWidth: 1, borderColor: colors.border },
  controls: { gap: 10 },
  controlsSide: { width: 260 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusText: { color: colors.text, fontSize: 14, fontWeight: "500", flexShrink: 1 },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  chips: { gap: 8, paddingVertical: 2 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    height: 34,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.input,
    maxWidth: 220,
  },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.cardStrong },
  chipText: { color: colors.muted, fontSize: 13, fontWeight: "500", flexShrink: 1 },
  tools: { flexDirection: "row", gap: 6 },
  warn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.45)",
    backgroundColor: "rgba(245,158,11,0.08)",
  },
  warnText: { color: colors.text, fontSize: 13, lineHeight: 18, flex: 1 },
  tool: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingVertical: 8,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.input,
  },
  toolOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  toolText: { color: colors.text, fontSize: 10.5, fontWeight: "500" },
  liveBadge: {
    position: "absolute",
    top: 10,
    left: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.live,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  liveText: { color: "#fff", fontSize: 11, fontWeight: "800", letterSpacing: 0.6 },
});
