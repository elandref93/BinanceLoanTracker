import { View } from "react-native";
import Svg, { Circle, Defs, Line, LinearGradient, Polygon, Polyline, Stop } from "react-native-svg";

import { useColors } from "@/hooks/useColors";
import type { Snap } from "@/lib/leverageSim";

interface Props {
  snapsA: Snap[];
  snapsB: Snap[];
  width: number;
  height?: number;
  years: number;
  /**
   * Optional "you are here" marker — `month` is months since sim start,
   * `net` is the actual current net value in the same units (ZAR) as
   * snapsA/snapsB. Drawn as a pulsing dot with a vertical guideline.
   */
  marker?: { month: number; net: number } | null;
}

/**
 * Two-line area chart for Strategy A (primary) vs Strategy B (purple). Annual
 * rebalance marks rendered as dashed vertical lines (every 4th quarterly
 * snapshot). Values are in ZAR — the parent decides the axis labels.
 */
export function LeverageChart({ snapsA, snapsB, width, height = 180, years, marker }: Props) {
  const colors = useColors();
  if (snapsA.length < 2 || snapsB.length < 2) return null;

  const cMax = Math.max(
    ...snapsA.map((s) => s.net),
    ...snapsB.map((s) => s.net),
    marker?.net ?? 0,
    1,
  );
  const innerH = height;
  const innerW = width;
  const n = snapsA.length;
  const stepX = innerW / Math.max(1, n - 1);

  const ptsA = snapsA
    .map((r, i) => `${i * stepX},${innerH - (r.net / cMax) * (innerH - 4)}`)
    .join(" ");
  const ptsB = snapsB
    .map((r, i) => `${i * stepX},${innerH - (r.net / cMax) * (innerH - 4)}`)
    .join(" ");

  const colorA = colors.primary;
  const colorB = "#7c6aef";

  return (
    <View>
      <Svg width={innerW} height={innerH}>
        <Defs>
          <LinearGradient id="gA" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={colorA} stopOpacity="0.18" />
            <Stop offset="100%" stopColor={colorA} stopOpacity="0" />
          </LinearGradient>
          <LinearGradient id="gB" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={colorB} stopOpacity="0.18" />
            <Stop offset="100%" stopColor={colorB} stopOpacity="0" />
          </LinearGradient>
        </Defs>

        {/* Horizontal grid lines at 25/50/75% */}
        {[0.25, 0.5, 0.75].map((p) => (
          <Line
            key={p}
            x1={0}
            x2={innerW}
            y1={innerH * (1 - p)}
            y2={innerH * (1 - p)}
            stroke={colors.border}
            strokeWidth={1}
            opacity={0.4}
          />
        ))}

        {/* Annual rebalance markers — every 4th snap (since snaps are quarterly). */}
        {snapsA.map((s, i) =>
          s.month % 12 === 0 ? (
            <Line
              key={`r${i}`}
              x1={i * stepX}
              x2={i * stepX}
              y1={0}
              y2={innerH}
              stroke="#f59e0b"
              strokeDasharray="3,3"
              strokeWidth={1}
              opacity={0.18}
            />
          ) : null,
        )}

        <Polygon fill="url(#gA)" points={`0,${innerH} ${ptsA} ${(n - 1) * stepX},${innerH}`} />
        <Polygon fill="url(#gB)" points={`0,${innerH} ${ptsB} ${(n - 1) * stepX},${innerH}`} />
        <Polyline fill="none" stroke={colorA} strokeWidth={2} points={ptsA} />
        <Polyline fill="none" stroke={colorB} strokeWidth={2} points={ptsB} />

        {marker != null && marker.month > 0 ? (() => {
          // Snaps run from month 3 (first) to year*12 (last) and are
          // plotted linearly across the inner width. Map the marker's
          // month into the SAME domain so it lines up with the curve.
          const firstSnapMonth = 3;
          const lastSnapMonth = years * 12;
          const span = Math.max(1, lastSnapMonth - firstSnapMonth);
          const xRatio = Math.min(
            1,
            Math.max(0, (marker.month - firstSnapMonth) / span),
          );
          const mx = xRatio * (n - 1) * stepX;
          const my = innerH - (marker.net / cMax) * (innerH - 4);
          return (
            <>
              <Line x1={mx} x2={mx} y1={0} y2={innerH} stroke={colors.foreground} strokeDasharray="2,3" strokeWidth={1} opacity={0.4} />
              <Circle cx={mx} cy={my} r={6} fill={colors.background} stroke={colors.foreground} strokeWidth={2} />
              <Circle cx={mx} cy={my} r={3} fill={colors.foreground} />
            </>
          );
        })() : null}
      </Svg>
    </View>
  );
}
