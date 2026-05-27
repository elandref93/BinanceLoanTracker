import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Line, Path, Rect } from "react-native-svg";

import { useColors } from "@/hooks/useColors";
import { getLtvHistory, type LtvSample } from "@/lib/ltvHistory";

const CHART_W = 320;
const CHART_H = 80;
const PAD_X = 4;
const PAD_Y = 8;

function buildPath(samples: LtvSample[], minLtv: number, maxLtv: number): string {
  if (samples.length === 0) return "";
  const t0 = samples[0].t;
  const tN = samples[samples.length - 1].t;
  const dt = Math.max(1, tN - t0);
  const dy = Math.max(0.0001, maxLtv - minLtv);
  return samples
    .map((s, i) => {
      const x = PAD_X + ((s.t - t0) / dt) * (CHART_W - PAD_X * 2);
      const y =
        PAD_Y + (1 - (s.ltv - minLtv) / dy) * (CHART_H - PAD_Y * 2);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

export function LtvHistoryChart({
  currentLtv,
  targetLtv,
  hours = 24,
}: {
  currentLtv: number;
  targetLtv: number;
  hours?: number;
}) {
  const colors = useColors();
  const [samples, setSamples] = useState<LtvSample[]>([]);

  useEffect(() => {
    void getLtvHistory(hours).then(setSamples);
  }, [hours, currentLtv]);

  // Need at least 2 points to draw a line; otherwise show a placeholder card.
  const enough = samples.length >= 2;
  const minLtv = enough ? Math.min(...samples.map((s) => s.ltv)) - 1 : 0;
  const maxLtv = enough ? Math.max(...samples.map((s) => s.ltv)) + 1 : 100;
  const targetY =
    enough && targetLtv >= minLtv && targetLtv <= maxLtv
      ? PAD_Y +
        (1 - (targetLtv - minLtv) / Math.max(0.0001, maxLtv - minLtv)) *
          (CHART_H - PAD_Y * 2)
      : null;
  const path = enough ? buildPath(samples, minLtv, maxLtv) : "";

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
        {enough ? (
          <Text style={[styles.range, { color: colors.mutedForeground }]}>
            {minLtv.toFixed(1)}–{maxLtv.toFixed(1)}%
          </Text>
        ) : null}
      </View>
      {enough ? (
        <Svg width={CHART_W} height={CHART_H}>
          <Rect
            x={0}
            y={0}
            width={CHART_W}
            height={CHART_H}
            fill="transparent"
          />
          {targetY !== null ? (
            <Line
              x1={PAD_X}
              x2={CHART_W - PAD_X}
              y1={targetY}
              y2={targetY}
              stroke={colors.warn}
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.5}
            />
          ) : null}
          <Path
            d={path}
            stroke={colors.primary}
            strokeWidth={1.8}
            fill="none"
          />
        </Svg>
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
