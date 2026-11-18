import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";

import { dbToUnit } from "@/lib/format";
import { useLevel } from "@/state/levels";
import { colors } from "@/theme";

const SILENCE_DB = -100;
const YELLOW_DB = -20;
const RED_DB = -9;
const U_YELLOW = dbToUnit(YELLOW_DB);
const U_RED = dbToUnit(RED_DB);
const HOLD_MS = 1200;

const zone = {
  green: "#22C55E",
  yellow: "#FACC15",
  red: "#EF4444",
  muted: "#404040",
};

/**
 * OBS-style audio meter fed by the WebSocket `levels` event: one bar per
 * channel, lit up to the magnitude (green < -20 dB < yellow < -9 dB < red),
 * with a peak-hold tick that decays after a moment.
 */
export function LevelMeter({ sourceUuid, muted }: { sourceUuid: string; muted: boolean }) {
  const level = useLevel(sourceUuid);
  const channels = Math.max(1, level?.magnitude.length ?? 2);
  const holds = useRef<{ value: number; at: number }[]>([]);

  useEffect(() => {
    if (muted) holds.current = [];
  }, [muted]);

  const now = Date.now();
  const barHeight = channels > 2 ? 3 : 5;

  return (
    <View style={styles.wrap}>
      {Array.from({ length: channels }, (_, ch) => {
        const mag = muted ? 0 : dbToUnit(level?.magnitude[ch] ?? SILENCE_DB);
        const peak = muted ? 0 : dbToUnit(level?.peak[ch] ?? SILENCE_DB);
        const hold = holds.current[ch] ?? { value: 0, at: 0 };
        if (peak >= hold.value || now - hold.at > HOLD_MS) holds.current[ch] = { value: peak, at: now };
        const held = holds.current[ch]!.value;
        return (
          <View key={ch} style={[styles.track, { height: barHeight }]}>
            {muted ? (
              <Segment from={0} to={mag} color={zone.muted} />
            ) : (
              <>
                <Segment from={0} to={Math.min(mag, U_YELLOW)} color={zone.green} />
                <Segment from={U_YELLOW} to={Math.min(mag, U_RED)} color={zone.yellow} />
                <Segment from={U_RED} to={mag} color={zone.red} />
              </>
            )}
            {held > 0.02 ? (
              <View
                style={[
                  styles.peak,
                  { left: `${held * 100}%`, backgroundColor: held >= U_RED ? zone.red : held >= U_YELLOW ? zone.yellow : colors.text },
                ]}
              />
            ) : null}
            <View style={[styles.guide, { left: `${U_YELLOW * 100}%` }]} />
            <View style={[styles.guide, { left: `${U_RED * 100}%` }]} />
          </View>
        );
      })}
    </View>
  );
}

function Segment({ from, to, color }: { from: number; to: number; color: string }) {
  if (to <= from) return null;
  return <View style={[styles.segment, { left: `${from * 100}%`, width: `${(to - from) * 100}%`, backgroundColor: color }]} />;
}

const styles = StyleSheet.create({
  wrap: { gap: 2 },
  track: {
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.06)",
    overflow: "hidden",
    position: "relative",
  },
  segment: { position: "absolute", top: 0, bottom: 0 },
  peak: { position: "absolute", top: 0, bottom: 0, width: 2, marginLeft: -1, opacity: 0.9 },
  guide: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: "rgba(0,0,0,0.45)" },
});
