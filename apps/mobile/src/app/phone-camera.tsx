/**
 * Use the phone as a camera for Vexcast, two ways:
 * - Local network (default): the app captures the camera itself and streams it with WebRTC
 *   straight to the PC (the `phonecam.html` widget in a browser source). Nothing leaves the
 *   Wi-Fi, lowest latency, and the camera can be switched live.
 * - Internet: the phone's browser sends it through VDO.Ninja (like "Invite a guest" on the
 *   desktop). For when the phone isn't on the PC's network (mobile data, another place).
 */
import Ionicons from "@expo/vector-icons/Ionicons";
import { phoneCamSource, revealPlan, sourceInScene, type AppState } from "@vexcast/protocol";
import { useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import { Stack, useLocalSearchParams } from "expo-router";
import * as ScreenOrientation from "expo-screen-orientation";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, Switch, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ConfirmSheet } from "@/components/ConfirmSheet";
import { LiveCamera } from "@/components/LiveCamera";
import { Screen } from "@/components/Screen";
import { Button, Card, IconTile, SectionTitle, type IconName } from "@/components/ui";
import { haptic } from "@/lib/haptics";
import { useT, type TKey } from "@/lib/i18n";
import { getJSON, setJSON } from "@/lib/storage";
import { useRemote } from "@/state/remote";
import { useToast } from "@/state/toasts";
import { colors, radius } from "@/theme";

type Mode = "local" | "internet";
type Facing = "rear" | "front" | "ask";
type Quality = "720p" | "1080p";
type Orientation = "landscape" | "portrait";

interface CamPrefs {
  mode: Mode;
  room: string;
  password: string;
  facing: Facing;
  /** A specific camera picked from the list (local mode). */
  deviceId: string | null;
  quality: Quality;
  fps: 24 | 30 | 60;
  orientation: Orientation;
  mic: boolean;
  /** Noise suppression and echo cancellation for the phone's mic. */
  noise: boolean;
  /** How Vexcast shows the image. */
  mirror: boolean;
  flip: boolean;
  rotate: 0 | 90 | 180 | 270;
  fit: "contain" | "cover";
}

const KEY = "vexcast.phoneCamera";
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

function rand(n: number): string {
  const bytes = new Uint8Array(n);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

const enc = encodeURIComponent;

/** Internet mode — what the phone's browser opens: sends the chosen camera (and the mic, if wanted). */
function pushLink(p: CamPrefs, label: string): string {
  let url = `https://vdo.ninja/?push=${p.room}&password=${enc(p.password)}&label=${enc(label)}&webcam&quality=${p.quality}`;
  // A fixed camera starts straight away; "ask" shows VDO.Ninja's device picker (wide-angle, zoom…).
  if (p.facing !== "ask") url += `&facing=${p.facing}&autostart`;
  if (!p.mic) url += "&audiodevice=0";
  return url;
}

/** What the browser source in Vexcast loads. The local widget is served by the core itself. */
const sourceUrl = (p: CamPrefs, port: number) =>
  p.mode === "local"
    ? `http://127.0.0.1:${port}/widgets/phonecam.html?id=${p.room}`
    : `https://vdo.ninja/?view=${p.room}&password=${enc(p.password)}&cleanoutput`;

const sourceSize = (p: CamPrefs) => {
  const [w, h] = p.quality === "1080p" ? [1920, 1080] : [1280, 720];
  return p.orientation === "portrait" ? { width: h, height: w } : { width: w, height: h };
};

/** The scene new sources go to (the preview in studio mode, like the desktop). */
const targetScene = (s: AppState) => (s.status.studioMode && s.previewSceneUuid ? s.previewSceneUuid : s.programSceneUuid);

function Choice<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string; icon: IconName }[]; onChange: (v: T) => void }) {
  return (
    <View style={styles.choices}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Pressable
            key={o.id}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => {
              haptic.tap();
              onChange(o.id);
            }}
            style={[styles.choice, on && styles.choiceOn]}
          >
            <Ionicons name={o.icon} size={20} color={on ? colors.text : colors.muted} />
            <Text style={[styles.choiceLabel, on && { color: colors.text }]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function PhoneCameraScreen() {
  const t = useT();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { session, state, run } = useRemote();
  const [prefs, setPrefs] = useState<CamPrefs | null>(null);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  /** `?start=1` (the dashboard's "Open camera"): go straight to the live camera. */
  const params = useLocalSearchParams<{ start?: string }>();
  const autoStart = useRef(params.start === "1");
  const startRef = useRef<(() => Promise<void>) | null>(null);
  const [camPerm, askCam] = useCameraPermissions();
  const [micPerm, askMic] = useMicrophonePermissions();

  useEffect(() => {
    getJSON<Partial<CamPrefs> | null>(KEY, null).then((saved) => {
      const p: CamPrefs = {
        mode: "local",
        room: `vxcam${rand(10)}`,
        password: rand(14),
        facing: "rear",
        deviceId: null,
        quality: "720p",
        fps: 30,
        orientation: "landscape",
        mic: false,
        noise: true,
        mirror: false,
        flip: false,
        rotate: 0,
        fit: "contain",
        ...(saved ?? {}),
      };
      setPrefs(p);
      if (!saved?.room) void setJSON(KEY, p);
    });
  }, []);

  // While live, the screen turns with the chosen orientation; back to portrait afterwards.
  const orientation = prefs?.orientation;
  useEffect(() => {
    if (!live) return;
    ScreenOrientation.lockAsync(orientation === "landscape" ? ScreenOrientation.OrientationLock.LANDSCAPE : ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, [live, orientation]);

  // While live, "back" stops the camera and returns to its settings instead of leaving the screen.
  useEffect(() => {
    if (!live) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setLive(false);
      return true;
    });
    return () => sub.remove();
  }, [live]);

  // Opened from the dashboard to resume: start as soon as the settings and the state are loaded.
  const loaded = !!prefs && !!state && !!session;
  useEffect(() => {
    if (!loaded || !autoStart.current) return;
    autoStart.current = false;
    void startRef.current?.();
  }, [loaded]);

  const update = (patch: Partial<CamPrefs>) =>
    setPrefs((cur) => {
      if (!cur) return cur;
      const next = { ...cur, ...patch };
      void setJSON(KEY, next);
      return next;
    });

  if (!prefs || !state || !session)
    return (
      <Screen>
        <ActivityIndicator color={colors.muted} style={{ marginTop: 40 }} />
      </Screen>
    );

  const source = phoneCamSource(state.sources, prefs.room);
  const scene = targetScene(state);
  const sceneInfo = state.scenes.find((s) => s.uuid === scene);
  /** visible / hidden / missing in the scene new sources go to (also inside groups and nested scenes). */
  const inScene = source ? sourceInScene(state, scene, source.uuid) : "missing";

  /** Makes sure the camera source exists, matches the chosen mode and size, and shows in the current scene. */
  const ensureSource = async (): Promise<boolean> => {
    if (!scene) return false;
    const settings = { url: sourceUrl(prefs, session.conn.port), ...sourceSize(prefs), reroute_audio: true, fps_custom: false };
    if (!source) {
      return !!(await run((c) => c.createSource({ name: t("cam.sourceName"), kind: "browser_source", settings, sceneUuid: scene })));
    }
    const s = source.settings;
    if (s.url !== settings.url || s.width !== settings.width || s.height !== settings.height) {
      if (!(await run((c) => c.updateSourceSettings(source.uuid, { url: settings.url, width: settings.width, height: settings.height })))) return false;
    }
    // Turn on whatever hides it (its item, a hidden group or nested scene), or add it if it isn't there.
    const plan = revealPlan(state, scene, source.uuid);
    if (!plan) return !!(await run((c) => c.addSourceToScene(scene, source.uuid)));
    for (const step of plan) {
      if ((await run((c) => c.updateItem(step.sceneUuid, step.itemId, { visible: true }))) === undefined) return false;
    }
    return true;
  };

  const start = async () => {
    haptic.medium();
    setBusy(true);
    try {
      if (prefs.mode === "local") {
        // Ask here, with the app's own explanation, rather than inside the WebView.
        const cam = camPerm?.granted ? camPerm : await askCam();
        if (!cam.granted) return toast.show(t("cam.errPermission"), "error");
        if (prefs.mic && !micPerm?.granted && !(await askMic()).granted) update({ mic: false });
      }
      if (!(await ensureSource())) return;
      if (prefs.mode === "local") setLive(true);
      else await WebBrowser.openBrowserAsync(pushLink(prefs, t("cam.label")), { toolbarColor: colors.bg, controlsColor: colors.text });
    } catch {
      toast.show(t("cam.openFailed"), "error");
    } finally {
      setBusy(false);
    }
  };

  startRef.current = start;

  const remove = async () => {
    setConfirmRemove(false);
    if (!source) return;
    haptic.medium();
    await run((c) => c.deleteSource(source.uuid), t("cam.removed"));
  };

  if (live) {
    const landscape = width > height;
    return (
      <View style={[styles.liveRoot, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8, paddingLeft: insets.left + 12, paddingRight: insets.right + 12 }]}>
        <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
        <LiveCamera
          landscape={landscape}
          config={{
            room: prefs.room,
            facing: prefs.facing === "front" ? "front" : "rear",
            deviceId: prefs.deviceId,
            quality: prefs.quality,
            fps: prefs.fps,
            orientation: prefs.orientation,
            mic: prefs.mic,
            noise: prefs.noise,
            mirror: prefs.mirror,
            flip: prefs.flip,
            rotate: prefs.rotate,
            fit: prefs.fit,
          }}
          onChange={async (patch) => {
            if (patch.mic && !micPerm?.granted && !(await askMic()).granted) return toast.show(t("cam.errMicPermission"), "error");
            update(patch);
            // A new quality changes the source's size in Vexcast too, so the picture stays sharp.
            if (patch.quality && source) {
              const size = sourceSize({ ...prefs, ...patch });
              if (source.settings.width !== size.width || source.settings.height !== size.height) void run((c) => c.updateSourceSettings(source.uuid, size));
            }
          }}
          onStop={() => {
            haptic.medium();
            setLive(false);
          }}
        />
      </View>
    );
  }

  const facingOptions: { id: Facing; label: string; icon: IconName }[] = [
    { id: "rear", label: t("cam.rear"), icon: "camera-outline" },
    { id: "front", label: t("cam.front"), icon: "person-circle-outline" },
    ...(prefs.mode === "internet" ? [{ id: "ask" as const, label: t("cam.ask"), icon: "list-outline" as const }] : []),
  ];
  const facing = prefs.mode === "local" && prefs.facing === "ask" ? "rear" : prefs.facing;
  const hint: Record<Facing, TKey> = { rear: "cam.rearHint", front: "cam.frontHint", ask: "cam.askHint" };

  return (
    <Screen>
      {/* The live view hides the header and the back gesture: bring them back. */}
      <Stack.Screen options={{ headerShown: true, gestureEnabled: true }} />
      <ConfirmSheet
        visible={confirmRemove}
        title={t("cam.removeTitle")}
        body={t("cam.removeBody")}
        confirmLabel={t("cam.remove")}
        icon="trash-outline"
        destructive
        onConfirm={remove}
        onCancel={() => setConfirmRemove(false)}
      />
      <Card style={styles.hero}>
        <IconTile icon="videocam" size={44} />
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <Text style={styles.heroTitle}>{t("cam.title")}</Text>
          <Text style={styles.muted}>{t(prefs.mode === "local" ? "cam.descLocal" : "cam.descInternet")}</Text>
        </View>
      </Card>

      <SectionTitle>{t("cam.connection")}</SectionTitle>
      <Choice
        value={prefs.mode}
        options={[
          { id: "local", label: t("cam.local"), icon: "wifi-outline" },
          { id: "internet", label: t("cam.internet"), icon: "globe-outline" },
        ]}
        onChange={(mode) => update({ mode })}
      />
      <Text style={styles.hint}>{t(prefs.mode === "local" ? "cam.localHint" : "cam.internetHint")}</Text>

      <SectionTitle>{t("cam.which")}</SectionTitle>
      <Choice value={facing} options={facingOptions} onChange={(f) => update({ facing: f, deviceId: null })} />
      <Text style={styles.hint}>{t(prefs.mode === "local" && facing !== "ask" ? "cam.moreLocal" : hint[facing])}</Text>

      <SectionTitle>{t("cam.options")}</SectionTitle>
      <Card style={{ gap: 14 }}>
        <View style={{ gap: 8 }}>
          <Text style={styles.label}>{t("cam.quality")}</Text>
          <Choice
            value={prefs.quality}
            options={[
              { id: "720p", label: "720p", icon: "speedometer-outline" },
              { id: "1080p", label: "1080p", icon: "sparkles-outline" },
            ]}
            onChange={(quality) => update({ quality })}
          />
        </View>
        <View style={{ gap: 8 }}>
          <Text style={styles.label}>{t("cam.orientation")}</Text>
          <Choice
            value={prefs.orientation}
            options={[
              { id: "landscape", label: t("cam.landscape"), icon: "phone-landscape-outline" },
              { id: "portrait", label: t("cam.portrait"), icon: "phone-portrait-outline" },
            ]}
            onChange={(o) => update({ orientation: o })}
          />
        </View>
        <View style={styles.switchRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.label}>{t("cam.mic")}</Text>
            <Text style={styles.hint}>{t("cam.micHint")}</Text>
          </View>
          <Switch value={prefs.mic} onValueChange={(mic) => update({ mic })} trackColor={{ true: colors.success, false: colors.cardStrong }} thumbColor="#fff" />
        </View>
      </Card>

      <Button
        label={source ? t("cam.open") : t("cam.start")}
        icon="videocam"
        size="lg"
        loading={busy}
        disabled={!scene}
        onPress={start}
        testID="phone-camera-start"
      />

      <Card style={{ gap: 10 }}>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: source ? colors.success : colors.faint }]} />
          <Text style={[styles.label, { flex: 1 }]}>
            {source
              ? inScene === "visible"
                ? t("cam.inScene", { scene: sceneInfo?.name ?? "" })
                : inScene === "hidden"
                  ? t("cam.hiddenInScene", { scene: sceneInfo?.name ?? "" })
                  : t("cam.otherScene")
              : t("cam.notAdded")}
          </Text>
          {source ? <Button label={t("cam.remove")} icon="trash-outline" variant="ghost" size="sm" onPress={() => setConfirmRemove(true)} /> : null}
        </View>
        <Text style={styles.hint}>{t(prefs.mode === "local" ? "cam.tipsLocal" : "cam.tips")}</Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  liveRoot: { flex: 1, backgroundColor: colors.bg },
  hero: { flexDirection: "row", gap: 14, alignItems: "center" },
  heroTitle: { color: colors.text, fontSize: 16, fontWeight: "600" },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 17, paddingHorizontal: 2 },
  label: { color: colors.text, fontSize: 14, fontWeight: "500" },
  choices: { flexDirection: "row", gap: 8 },
  choice: {
    flex: 1,
    alignItems: "center",
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.input,
  },
  choiceOn: { borderColor: colors.primary, backgroundColor: colors.cardStrong },
  choiceLabel: { color: colors.muted, fontSize: 13, fontWeight: "500" },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
