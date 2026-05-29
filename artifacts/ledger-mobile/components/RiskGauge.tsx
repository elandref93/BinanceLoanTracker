import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, G, Line } from "react-native-svg";

import { useColors } from "@/hooks/useColors";
import { useTargetLtv } from "@/context/RiskSettingsContext";
import { LIQ_LTV, statusFromLtv, WARNING_LTV } from "@/utils/risk";

interface Props {
  ltv: number;
  size?: number;
  /** Per-account target; falls back to the global default when omitted. */
  target?: number;
}

export function RiskGauge({ ltv, size = 220, target }: Props) {
  const colors = useColors();
  const defaultTarget = useTargetLtv();
  const targetLtv = target ?? defaultTarget;
  const status = statusFromLtv(ltv, targetLtv);
  const tone =
    status === "ok"
      ? colors.ok
      : status === "warn"
        ? colors.warn
        : colors.danger;
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.min(100, Math.max(0, (ltv / LIQ_LTV) * 100));
  const offset = c * (1 - pct / 100);

  const tickAngle = (frac: number) => -90 + 360 * frac;
  const center = size / 2;

  const Tick = ({
    frac,
    color,
  }: {
    frac: number;
    color: string;
  }) => {
    const a = (tickAngle(frac) * Math.PI) / 180;
    const x1 = center + Math.cos(a) * (r - stroke / 2 - 2);
    const y1 = center + Math.sin(a) * (r - stroke / 2 - 2);
    const x2 = center + Math.cos(a) * (r + stroke / 2 + 2);
    const y2 = center + Math.sin(a) * (r + stroke / 2 + 2);
    return (
      <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={2} />
    );
  };

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <G rotation={-90} origin={`${center},${center}`}>
          <Circle
            cx={center}
            cy={center}
            r={r}
            stroke={colors.border}
            strokeWidth={stroke}
            fill="none"
          />
          <Circle
            cx={center}
            cy={center}
            r={r}
            stroke={tone}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${c} ${c}`}
            strokeDashoffset={offset}
          />
        </G>
        <Tick frac={targetLtv / LIQ_LTV} color={colors.mutedForeground} />
        <Tick frac={WARNING_LTV / LIQ_LTV} color={colors.warn} />
      </Svg>
      <View style={styles.center} pointerEvents="none">
        <Text style={[styles.label, { color: colors.mutedForeground }]}>
          LTV
        </Text>
        <Text style={[styles.value, { color: tone }]}>{ltv.toFixed(1)}%</Text>
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>
          target {targetLtv} · liq {LIQ_LTV}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: 10,
    letterSpacing: 2,
    fontFamily: "Inter_600SemiBold",
  },
  value: {
    fontSize: 44,
    fontFamily: "Inter_700Bold",
    fontVariant: ["tabular-nums"],
    marginTop: 2,
  },
  sub: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    fontVariant: ["tabular-nums"],
    marginTop: 4,
  },
});
