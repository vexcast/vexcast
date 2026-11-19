/**
 * Every setting of the live phone camera in one sheet: how the image shows in Vexcast
 * (mirror, flip, rotation, fill), the camera's own controls when the phone exposes them
 * (zoom, torch, focus, exposure, white balance), quality and audio.
 */
import Ionicons from "@expo/vector-icons/Ionicons";
import Slider from "@react-native-community/slider";
import type { ReactNode } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { haptic } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { colors, radius } from "@/theme";
import type { IconName } from "./ui";

export interface Range {
  min: number;
  max: number;
  step?: number;
}

/** What the current camera can adjust (from MediaStreamTrack.getCapabilities). */
export interface CameraCaps {
  zoom?: Range;
  torch?: boolean;
  focusMode?: string[];
  focusDistance?: Range;
  exposureMode?: string[];
  exposureCompensation?: Range;
  whiteBalanceMode?: string[];
  colorTemperature?: Range;
  frameRate?: Range;
}

export type CameraControls = Partial<{
  zoom: number;
  torch: boolean;
  focusMode: string;
  focusDistance: number;
  exposureMode: string;
  exposureCompensation: number;
  whiteBalanceMode: string;
  colorTemperature: number;
}>;

export interface CameraLook {
  mirror: boolean;
  flip: boolean;
  rotate: 0 | 90 | 180 | 270;
  fit: "contain" | "cover";
  quality: "720p" | "1080p";
  fps: 24 | 30 | 60;
  mic: boolean;
  noise: boolean;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Row({ icon, label, hint, children }: { icon: IconName; label: string; hint?: string; children?: ReactNode }) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={18} color={colors.muted} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Switch
      value={value}
      onValueChange={(v) => {
        haptic.tap();
        onChange(v);
      }}
      trackColor={{ true: colors.success, false: colors.cardStrong }}
      thumbColor="#fff"
    />
  );
}

function Segments<T extends string | number>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <View style={styles.segments}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Pressable
            key={String(o.id)}
            onPress={() => {
              haptic.tap();
              onChange(o.id);
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            style={[styles.segment, on && styles.segmentOn]}
          >
            <Text style={[styles.segmentText, on && { color: colors.text }]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function RangeRow({ icon, label, range, value, format, onChange }: { icon: IconName; label: string; range: Range; value: number; format: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <View style={{ gap: 4 }}>
      <View style={styles.row}>
        <Ionicons name={icon} size={18} color={colors.muted} />
        <Text style={[styles.label, { flex: 1 }]}>{label}</Text>
        <Text style={styles.value}>{format(value)}</Text>
      </View>
      <Slider
        minimumValue={range.min}
        maximumValue={range.max}
        step={range.step && range.step > 0 ? range.step : 0}
        value={Math.min(range.max, Math.max(range.min, value))}
        onValueChange={onChange}
        minimumTrackTintColor={colors.primary}
        maximumTrackTintColor={colors.cardStrong}
        thumbTintColor="#fff"
      />
    </View>
  );
}

const has = (list: string[] | undefined, x: string) => !!list && list.includes(x);

export function CameraSettingsSheet({
  visible,
  onClose,
  look,
  onLook,
  caps,
  controls,
  onControls,
  frontCamera,
}: {
  visible: boolean;
  onClose: () => void;
  look: CameraLook;
  onLook: (patch: Partial<CameraLook>) => void;
  caps: CameraCaps;
  controls: CameraControls;
  onControls: (patch: CameraControls) => void;
  frontCamera: boolean;
}) {
  const t = useT();
  const insets = useSafeAreaInsets();

  const focusManual = has(caps.focusMode, "manual");
  const focusAuto = has(caps.focusMode, "continuous") || has(caps.focusMode, "single-shot");
  const wbManual = has(caps.whiteBalanceMode, "manual");
  const wbAuto = has(caps.whiteBalanceMode, "continuous");
  const anyCamera = !!(caps.zoom || caps.torch || caps.focusDistance || caps.exposureCompensation || caps.colorTemperature);
  const can60 = !caps.frameRate || caps.frameRate.max >= 50;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} supportedOrientations={["portrait", "landscape"]}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t("common.close")} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.header}>
          <Text style={styles.title}>{t("cam.settings")}</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel={t("common.close")}>
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ gap: 14, paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
          <Section title={t("cam.image")}>
            <Row icon="swap-horizontal" label={t("cam.mirror")} hint={t("cam.mirrorHint")}>
              <Toggle value={look.mirror} onChange={(mirror) => onLook({ mirror })} />
            </Row>
            <Row icon="swap-vertical" label={t("cam.flip")} hint={t("cam.flipHint")}>
              <Toggle value={look.flip} onChange={(flip) => onLook({ flip })} />
            </Row>
            <View style={{ gap: 8 }}>
              <Row icon="refresh" label={t("cam.rotate")} />
              <Segments
                value={look.rotate}
                options={[0, 90, 180, 270].map((r) => ({ id: r as CameraLook["rotate"], label: `${r}°` }))}
                onChange={(rotate) => onLook({ rotate })}
              />
            </View>
            <View style={{ gap: 8 }}>
              <Row icon="scan-outline" label={t("cam.fit")} />
              <Segments
                value={look.fit}
                options={[
                  { id: "contain", label: t("cam.fitContain") },
                  { id: "cover", label: t("cam.fitCover") },
                ]}
                onChange={(fit) => onLook({ fit })}
              />
            </View>
            <Text style={styles.hint}>{t("cam.imageHint")}</Text>
          </Section>

          <Section title={t("cam.cameraControls")}>
            {!anyCamera ? <Text style={styles.hint}>{t("cam.noControls")}</Text> : null}
            {caps.zoom && caps.zoom.max > caps.zoom.min ? (
              <RangeRow icon="search" label={t("cam.zoom")} range={caps.zoom} value={controls.zoom ?? caps.zoom.min} format={(v) => `${v.toFixed(1)}×`} onChange={(zoom) => onControls({ zoom })} />
            ) : null}
            {caps.torch ? (
              <Row icon="flashlight" label={t("cam.torch")} hint={frontCamera ? t("cam.torchFront") : undefined}>
                <Toggle value={!!controls.torch} onChange={(torch) => onControls({ torch })} />
              </Row>
            ) : null}
            {focusManual && focusAuto ? (
              <View style={{ gap: 8 }}>
                <Row icon="locate" label={t("cam.focus")} />
                <Segments
                  value={controls.focusMode === "manual" ? "manual" : "auto"}
                  options={[
                    { id: "auto", label: t("cam.auto") },
                    { id: "manual", label: t("cam.manual") },
                  ]}
                  onChange={(m) => onControls({ focusMode: m === "manual" ? "manual" : has(caps.focusMode, "continuous") ? "continuous" : "single-shot" })}
                />
              </View>
            ) : null}
            {caps.focusDistance && (controls.focusMode === "manual" || !focusAuto) ? (
              <RangeRow
                icon="aperture-outline"
                label={t("cam.focusDistance")}
                range={caps.focusDistance}
                value={controls.focusDistance ?? caps.focusDistance.min}
                format={(v) => v.toFixed(2)}
                onChange={(focusDistance) => onControls({ focusDistance })}
              />
            ) : null}
            {caps.exposureCompensation && caps.exposureCompensation.max > caps.exposureCompensation.min ? (
              <RangeRow
                icon="sunny-outline"
                label={t("cam.exposure")}
                range={caps.exposureCompensation}
                value={controls.exposureCompensation ?? 0}
                format={(v) => (v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1))}
                onChange={(exposureCompensation) => onControls({ exposureCompensation })}
              />
            ) : null}
            {wbManual && wbAuto ? (
              <View style={{ gap: 8 }}>
                <Row icon="color-palette-outline" label={t("cam.whiteBalance")} />
                <Segments
                  value={controls.whiteBalanceMode === "manual" ? "manual" : "auto"}
                  options={[
                    { id: "auto", label: t("cam.auto") },
                    { id: "manual", label: t("cam.manual") },
                  ]}
                  onChange={(m) => onControls({ whiteBalanceMode: m === "manual" ? "manual" : "continuous" })}
                />
              </View>
            ) : null}
            {caps.colorTemperature && (controls.whiteBalanceMode === "manual" || !wbAuto) ? (
              <RangeRow
                icon="thermometer-outline"
                label={t("cam.temperature")}
                range={caps.colorTemperature}
                value={controls.colorTemperature ?? Math.round((caps.colorTemperature.min + caps.colorTemperature.max) / 2)}
                format={(v) => `${Math.round(v)} K`}
                onChange={(colorTemperature) => onControls({ colorTemperature })}
              />
            ) : null}
          </Section>

          {Platform.OS === "ios" ? (
            <Section title={t("cam.centerStage")}>
              <Row icon="person-outline" label={t("cam.centerStage")} hint={t("cam.centerStageHint")} />
            </Section>
          ) : null}

          <Section title={t("cam.quality")}>
            <Segments
              value={look.quality}
              options={[
                { id: "720p", label: "720p" },
                { id: "1080p", label: "1080p" },
              ]}
              onChange={(quality) => onLook({ quality })}
            />
            <Segments
              value={look.fps}
              options={[
                { id: 24 as const, label: "24 fps" },
                { id: 30 as const, label: "30 fps" },
                ...(can60 ? [{ id: 60 as const, label: "60 fps" }] : []),
              ]}
              onChange={(fps) => onLook({ fps })}
            />
            <Text style={styles.hint}>{t("cam.qualityHint")}</Text>
          </Section>

          <Section title={t("cam.audio")}>
            <Row icon={look.mic ? "mic" : "mic-off"} label={t("cam.mic")} hint={t("cam.micHint")}>
              <Toggle value={look.mic} onChange={(mic) => onLook({ mic })} />
            </Row>
            {look.mic ? (
              <Row icon="ear-outline" label={t("cam.noise")} hint={t("cam.noiseHint")}>
                <Toggle value={look.noise} onChange={(noise) => onLook({ noise })} />
              </Row>
            ) : null}
          </Section>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: {
    maxHeight: "82%",
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: radius.xl + 6,
    borderTopRightRadius: radius.xl + 6,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingTop: 14,
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  title: { color: colors.text, fontSize: 17, fontWeight: "600" },
  section: { gap: 6 },
  sectionTitle: { color: colors.muted, fontSize: 13, fontWeight: "600", paddingHorizontal: 2 },
  card: { backgroundColor: colors.card, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  label: { color: colors.text, fontSize: 14, fontWeight: "500" },
  value: { color: colors.muted, fontSize: 13, fontVariant: ["tabular-nums"] },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  segments: { flexDirection: "row", gap: 6 },
  segment: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    height: 36,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.input,
    paddingHorizontal: 4,
  },
  segmentOn: { borderColor: colors.primary, backgroundColor: colors.cardStrong },
  segmentText: { color: colors.muted, fontSize: 13, fontWeight: "500" },
});
