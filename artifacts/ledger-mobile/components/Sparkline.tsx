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
  /** Format the scrubbed value shown while dragging. Defaults to 2dp. */
  formatValue?: (v: number) => string;
}

export function Sparkline({
  values,
  width: fixedWidth,
  height,
  color,
  reference,
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
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padY = 4;
  const innerH = height - padY * 2;
  const stepX = width / (values.length - 1);
  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = padY + innerH - ((v - min) / range) * innerH;
    return [x, y] as const;
  });
  const d = points
    .map(([x, y], i) => (i === 0 ? `M${x},${y}` : `L${x},${y}`))
    .join(" ");
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
