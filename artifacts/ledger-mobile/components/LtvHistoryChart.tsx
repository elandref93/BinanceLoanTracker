import { useEffect, useMemo, useState } from "react";
import {
  type GestureResponderEvent,
  type LayoutChangeEvent,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";

import { useColors } from "@/hooks/useColors";
import { getLtvHistory, type LtvSample } from "@/lib/ltvHistory";

const CHART_H = 80;
const PAD_X = 4;
const PAD_Y = 8;
const FALLBACK_W = 320;

type Point = { x: number; y: number; ltv: number; t: number };

function buildPoints(
  samples: LtvSample[],
  minLtv: number,
  maxLtv: number,
  width: number,
): Point[] {
  if (samples.length === 0) return [];
  const t0 = samples[0].t;
  const tN = samples[samples.length - 1].t;
  const dt = Math.max(1, tN - t0);
  const dy = Math.max(0.0001, maxLtv - minLtv);
  return samples.map((s) => ({
    x: PAD_X + ((s.t - t0) / dt) * (width - PAD_X * 2),
    y: PAD_Y + (1 - (s.ltv - minLtv) / dy) * (CHART_H - PAD_Y * 2),
    ltv: s.ltv,
    t: s.t,
  }));
}

function fmtClock(t: number): string {
  const d = new Date(t);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function LtvHistoryChart({
  currentLtv,
  targetLtv,
  hours = 24,
}: {
  currentLtv: number;
  /** Omit to hide the target line (e.g. the combined "All accounts" view). */
  targetLtv?: number;
  hours?: number;
}) {
  const colors = useColors();
  const [samples, setSamples] = useState<LtvSample[]>([]);
  const [width, setWidth] = useState(FALLBACK_W);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  useEffect(() => {
    void getLtvHistory(hours).then(setSamples);
  }, [hours, currentLtv]);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && Math.abs(w - width) > 0.5) setWidth(w);
  };

  // Need at least 2 points to draw a line; otherwise show a placeholder card.
  const enough = samples.length >= 2;
  // Fit the y-axis to the actual data so even small LTV movements fill the
  // chart instead of collapsing to a flat line. A fixed ±1 pad swamped tiny
  // real moves (e.g. 57.80 → 57.85); pad proportionally to the observed span
  // instead, with a small floor so a truly-flat series still has a sane band.
  const rawMin = enough ? Math.min(...samples.map((s) => s.ltv)) : 0;
  const rawMax = enough ? Math.max(...samples.map((s) => s.ltv)) : 100;
  const span = rawMax - rawMin;
  const pad = enough ? Math.max(0.05, span * 0.2) : 0;
  const minLtv = enough ? rawMin - pad : 0;
  const maxLtv = enough ? rawMax + pad : 100;

  const points = useMemo(
    () => (enough ? buildPoints(samples, minLtv, maxLtv, width) : []),
    [enough, samples, minLtv, maxLtv, width],
  );
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(" ");

  const targetY =
    enough && targetLtv != null && targetLtv >= minLtv && targetLtv <= maxLtv
      ? PAD_Y +
        (1 - (targetLtv - minLtv) / Math.max(0.0001, maxLtv - minLtv)) *
          (CHART_H - PAD_Y * 2)
      : null;

  // Map a touch x to the nearest sample so dragging snaps the cursor to real
  // data points rather than interpolating between them.
  const onScrub = (e: GestureResponderEvent) => {
    if (points.length === 0) return;
    const x = e.nativeEvent.locationX;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = Math.abs(points[i].x - x);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    setActiveIdx(best);
  };

  const active = activeIdx != null ? points[activeIdx] : null;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
        },
      ]}
    >
      <View style={styles.head}>
        <Text style={[styles.label, { color: colors.mutedForeground }]}>
          LTV · LAST {hours}H
        </Text>
        {active ? (
          <Text style={[styles.range, { color: colors.foreground }]}>
            {active.ltv.toFixed(2)}% · {fmtClock(active.t)}
          </Text>
        ) : enough ? (
          <Text style={[styles.range, { color: colors.mutedForeground }]}>
            {minLtv.toFixed(1)}–{maxLtv.toFixed(1)}%
          </Text>
        ) : null}
      </View>
      {enough ? (
        <View
          onLayout={onLayout}
          style={{ width: "100%" }}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={onScrub}
          onResponderMove={onScrub}
          onResponderRelease={() => setActiveIdx(null)}
          onResponderTerminate={() => setActiveIdx(null)}
        >
          <Svg width={width} height={CHART_H}>
            <Rect x={0} y={0} width={width} height={CHART_H} fill="transparent" />
            {targetY !== null ? (
              <Line
                x1={PAD_X}
                x2={width - PAD_X}
                y1={targetY}
                y2={targetY}
                stroke={colors.warn}
                strokeWidth={1}
                strokeDasharray="3 3"
                opacity={0.5}
              />
            ) : null}
            <Path d={path} stroke={colors.primary} strokeWidth={1.8} fill="none" />
            {active ? (
              <>
                <Line
                  x1={active.x}
                  x2={active.x}
                  y1={PAD_Y}
                  y2={CHART_H - PAD_Y}
                  stroke={colors.foreground}
                  strokeWidth={1}
                  strokeDasharray="2 3"
                  opacity={0.5}
                />
                <Circle
                  cx={active.x}
                  cy={active.y}
                  r={4}
                  fill={colors.background}
                  stroke={colors.primary}
                  strokeWidth={2}
                />
              </>
            ) : null}
          </Svg>
        </View>
      ) : (
        <Text style={[styles.empty, { color: colors.mutedForeground }]}>
          Building history… check back after a few refreshes.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, borderWidth: StyleSheet.hairlineWidth, gap: 8 },
  head: { flexDirection: "row", justifyContent: "space-between" },
  label: { fontSize: 10, letterSpacing: 1, fontFamily: "Inter_600SemiBold" },
  range: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    fontVariant: ["tabular-nums"],
  },
  empty: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    paddingVertical: 18,
    textAlign: "center",
  },
});
