import { useState } from "react";
import {
  type GestureResponderEvent,
  type LayoutChangeEvent,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Circle, Line, Path } from "react-native-svg";

import { useColors } from "@/hooks/useColors";

interface Props {
  values: number[];
  /** Omit to fill the parent's width (measured via onLayout). */
  width?: number;
  height: number;
  color?: string;
  reference?: number;
  /**
   * Optional secondary series drawn as a muted dashed line, sharing the same
   * y-domain and time window as `values`. Used to overlay the locally-recorded
   * nominal APR against the real charged rate. Its own length is fine — it is
   * spread across the full width independently of `values`.
   */
  overlay?: number[];
  overlayColor?: string;
  /** Format the scrubbed value shown while dragging. Defaults to 2dp. */
  formatValue?: (v: number) => string;
}

export function Sparkline({
  values,
  width: fixedWidth,
  height,
  color,
  reference,
  overlay,
  overlayColor,
  formatValue,
}: Props) {
  const colors = useColors();
  const [active, setActive] = useState<number | null>(null);
  const [measured, setMeasured] = useState(0);
  const stroke = color ?? colors.primary;
  const width = fixedWidth ?? measured;
  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && Math.abs(w - measured) > 0.5) setMeasured(w);
  };
  if (values.length < 2 || width <= 0) {
    // Still need to occupy/measure space when filling the parent width.
    return fixedWidth == null ? (
      <View onLayout={onLayout} style={{ width: "100%", height }} />
    ) : null;
  }
  const hasOverlay = overlay != null && overlay.length >= 2;
  const domainVals = [
    ...values,
    ...(hasOverlay ? overlay : []),
    ...(reference != null ? [reference] : []),
  ];
  const min = Math.min(...domainVals);
  const max = Math.max(...domainVals);
  const range = max - min || 1;
  const padY = 4;
  const innerH = height - padY * 2;
  const stepX = width / (values.length - 1);
  const yOf = (v: number) => padY + innerH - ((v - min) / range) * innerH;
  const points = values.map((v, i) => {
    const x = i * stepX;
    return [x, yOf(v)] as const;
  });
  const d = points
    .map(([x, y], i) => (i === 0 ? `M${x},${y}` : `L${x},${y}`))
    .join(" ");
  const overlayD = hasOverlay
    ? overlay
        .map((v, i) => {
          const x = i * (width / (overlay.length - 1));
          return `${i === 0 ? "M" : "L"}${x},${yOf(v)}`;
        })
        .join(" ")
    : null;
  const refY =
    reference != null
      ? padY + innerH - ((reference - min) / range) * innerH
      : null;

  const onScrub = (e: GestureResponderEvent) => {
    const x = e.nativeEvent.locationX;
    const idx = Math.max(0, Math.min(values.length - 1, Math.round(x / stepX)));
    setActive(idx);
  };

  const activePt = active != null ? points[active] : null;
  const fmt = formatValue ?? ((v: number) => v.toFixed(2));

  return (
    <View
      onLayout={fixedWidth == null ? onLayout : undefined}
      style={fixedWidth == null ? { width: "100%" } : { width }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={onScrub}
      onResponderMove={onScrub}
      onResponderRelease={() => setActive(null)}
      onResponderTerminate={() => setActive(null)}
    >
      <Svg width={width} height={height}>
        {refY != null ? (
          <Line
            x1={0}
            x2={width}
            y1={refY}
            y2={refY}
            stroke={colors.mutedForeground}
            strokeDasharray="3,3"
            strokeWidth={1}
          />
        ) : null}
        {overlayD ? (
          <Path
            d={overlayD}
            stroke={overlayColor ?? colors.mutedForeground}
            strokeWidth={1}
            strokeDasharray="4,3"
            fill="none"
            opacity={0.7}
          />
        ) : null}
        <Path d={d} stroke={stroke} strokeWidth={1.5} fill="none" />
        {activePt ? (
          <>
            <Line
              x1={activePt[0]}
              x2={activePt[0]}
              y1={0}
              y2={height}
              stroke={colors.foreground}
              strokeDasharray="2,3"
              strokeWidth={1}
              opacity={0.5}
            />
            <Circle
              cx={activePt[0]}
              cy={activePt[1]}
              r={3.5}
              fill={colors.background}
              stroke={stroke}
              strokeWidth={2}
            />
          </>
        ) : null}
      </Svg>
      {active != null ? (
        <Text style={[styles.readout, { color: colors.foreground }]}>
          {fmt(values[active])}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  readout: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    fontVariant: ["tabular-nums"],
    textAlign: "center",
    marginTop: 2,
  },
});
