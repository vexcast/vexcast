import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { useT } from "@/lib/i18n";
import { useRemote } from "@/state/remote";
import { colors } from "@/theme";

const INTERVAL_MS = 500; // ~2 fps

/**
 * Program-output thumbnail. Polls `client.snapshotUrl()` and double-buffers:
 * the next frame loads in a hidden layer and is only shown once fully
 * decoded, so the picture never flashes empty between frames.
 */
export function PreviewImage({
  aspect = 16 / 9,
  scene,
  intervalMs = INTERVAL_MS,
  compact = false,
  style,
}: {
  aspect?: number;
  /** A scene to show instead of the program output (studio mode's preview). */
  scene?: string | null;
  intervalMs?: number;
  /** Small thumbnail (mini player): smaller placeholder, no text. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useT();
  const { session, phase } = useRemote();
  const [urls, setUrls] = useState<[string | null, string | null]>([null, null]);
  const [front, setFront] = useState<0 | 1>(0);
  const [hasFrame, setHasFrame] = useState(false);
  const [failed, setFailed] = useState(false);
  const [focused, setFocused] = useState(true);
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingSlot = useRef<0 | 1 | null>(null);
  const requestedAt = useRef(0);
  const frontRef = useRef<0 | 1>(0);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setAppActive(s === "active"));
    return () => sub.remove();
  }, []);

  const running = !!session && focused && appActive && phase === "connected";

  const requestNext = useCallback(() => {
    if (!session) return;
    const slot: 0 | 1 = frontRef.current === 0 ? 1 : 0;
    loadingSlot.current = slot;
    requestedAt.current = Date.now();
    const url = scene
      ? `${session.client.previewUrl({ scene }).replace("/preview.mjpeg", "/preview.jpg")}&t=${Date.now()}`
      : session.client.snapshotUrl("horizontal");
    setUrls((u) => (slot === 0 ? [url, u[1]] : [u[0], url]));
  }, [session, scene]);

  const schedule = useCallback(
    (delay: number) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(requestNext, Math.max(0, delay));
    },
    [requestNext],
  );

  useEffect(() => {
    if (!running) {
      if (timer.current) clearTimeout(timer.current);
      loadingSlot.current = null;
      return;
    }
    requestNext();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [running, requestNext]);

  const onLoad = (slot: 0 | 1) => {
    if (slot !== loadingSlot.current) return;
    loadingSlot.current = null;
    frontRef.current = slot;
    setFront(slot);
    setHasFrame(true);
    setFailed(false);
    if (running) schedule(intervalMs - (Date.now() - requestedAt.current));
  };

  const onError = (slot: 0 | 1) => {
    if (slot !== loadingSlot.current) return;
    loadingSlot.current = null;
    setFailed(true);
    if (running) schedule(2000);
  };

  return (
    <View style={[styles.frame, compact && styles.compact, { aspectRatio: aspect }, style]}>
      {([0, 1] as const).map((slot) =>
        urls[slot] ? (
          <Image
            key={slot}
            source={{ uri: urls[slot]! }}
            cachePolicy="none"
            contentFit="contain"
            transition={0}
            onLoad={() => onLoad(slot)}
            onError={() => onError(slot)}
            style={[StyleSheet.absoluteFill, { opacity: front === slot && hasFrame ? 1 : 0, zIndex: front === slot ? 2 : 1 }]}
            accessibilityLabel={t("dash.preview")}
          />
        ) : null,
      )}
      {!hasFrame ? (
        <View style={styles.placeholder}>
          <Ionicons name={failed ? "eye-off-outline" : "tv-outline"} size={compact ? 18 : 30} color={colors.faint} />
          {failed && !compact ? <Text style={styles.placeholderText}>{t("dash.previewUnavailable")}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: "100%",
    backgroundColor: "#000",
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
  },
  compact: { borderRadius: 8 },
  placeholder: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", gap: 8 },
  placeholderText: { color: colors.faint, fontSize: 13 },
});
