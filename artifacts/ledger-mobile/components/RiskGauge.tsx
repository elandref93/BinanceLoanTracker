import { useMemo, useRef, useState } from "react";
import {
  PanResponder,
  type GestureResponderEvent,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Circle, G, Line } from "react-native-svg";

import { useColors } from "@/hooks/useColors";
import { useTargetLtv } from "@/context/RiskSettingsContext";
import { haptic } from "@/lib/haptics";
import { fmtMoney } from "@/utils/format";
import {
  headroomToTarget,
  LIQ_LTV,
  liqPriceAtTargetLtv,
  statusFromLtv,
  WARNING_LTV,
} from "@/utils/risk";

import type { Loan } from "@workspace/api-client-react";

interface Props {
  ltv: number;
  size?: number;
  /** Per-account target; falls back to the global default when omitted. */
  target?: number;
  /**
   * The loan this gauge represents. When supplied the ring becomes
   * interactive: press and drag around it to scrub a hypothetical LTV and
   * read off the liquidation price at that LTV and the collateral you'd need to
   * add (or could remove) to reach it.
   */
  loan?: Loan;
  /** Display currency for the scrubbed price / collateral readouts. */
  currency?: "USD" | "ZAR";
}

/**
 * Convert a touch point (relative to the gauge's top-left corner) into the LTV
 * the ring represents at that angle. The ring sweeps the full circle clockwise
 * from the 12-o'clock position, mapping 0 → `LIQ_LTV`. Returns `null` when the
 * touch is outside the interactive ring band so taps in the dead-centre (where
 * the readout lives) don't hijack a scroll gesture.
 */
export function ltvFromTouch(
  x: number,
  y: number,
  size: number,
  stroke: number,
): number | null {
  const center = size / 2;
  const dx = x - center;
  const dy = y - center;
  const dist = Math.hypot(dx, dy);
  const r = (size - stroke) / 2;
  // Generous band around the stroke so a slightly-off finger still grabs it.
  const inner = r - stroke - 14;
  const outer = r + stroke + 14;
  if (dist < inner || dist > outer) return null;
  // atan2 gives 0 at east, +clockwise (screen y points down). Shift so 0 sits
  // at the 12-o'clock start of the ring, then normalise to [0, 1).
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  const frac = (((deg + 90) % 360) + 360) % 360 / 360;
  const ltv = frac * LIQ_LTV;
  return Math.max(1, Math.min(LIQ_LTV, ltv));
}

export function RiskGauge({
  ltv: rawLtv,
  size = 220,
  target,
  loan,
  currency = "USD",
}: Props) {
  const colors = useColors();
  const defaultTarget = useTargetLtv();
  const targetLtv = target ?? defaultTarget;
  // Guard against NaN/Infinity reaching the SVG dash math (a native crash that
  // the JS error boundary can't catch) or the LTV readout.
  const ltv = Number.isFinite(rawLtv) ? rawLtv : 0;
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const center = size / 2;

  // While the user drags around the ring, `scrub` holds the hypothetical LTV
  // they're pointing at; null means show the live current LTV.
  const [scrub, setScrub] = useState<number | null>(null);
  const interactive = !!loan;
  const lastHapticLtv = useRef<number | null>(null);

  const displayLtv = scrub ?? ltv;
  const status = statusFromLtv(displayLtv, targetLtv);
  const tone =
    status === "ok"
      ? colors.ok
      : status === "warn"
        ? colors.warn
        : colors.danger;

  const pct = Math.min(100, Math.max(0, (displayLtv / LIQ_LTV) * 100));
  const offset = c * (1 - pct / 100);

  const tickAngle = (frac: number) => -90 + 360 * frac;

  const panResponder = useMemo(() => {
    if (!interactive) return null;
    const update = (e: GestureResponderEvent) => {
      const { locationX, locationY } = e.nativeEvent;
      const next = ltvFromTouch(locationX, locationY, size, stroke);
      if (next == null) return;
      setScrub(next);
      // Tick haptic on each whole-percent step so the dial feels detented.
      const whole = Math.round(next);
      if (lastHapticLtv.current !== whole) {
        lastHapticLtv.current = whole;
        haptic.tap();
      }
    };
    const within = (e: GestureResponderEvent) =>
      ltvFromTouch(
        e.nativeEvent.locationX,
        e.nativeEvent.locationY,
        size,
        stroke,
      ) != null;
    return PanResponder.create({
      onStartShouldSetPanResponder: within,
      onMoveShouldSetPanResponder: within,
      onPanResponderGrant: update,
      onPanResponderMove: update,
      onPanResponderRelease: () => {
        setScrub(null);
        lastHapticLtv.current = null;
      },
      onPanResponderTerminate: () => {
        setScrub(null);
        lastHapticLtv.current = null;
      },
      // Don't let an enclosing ScrollView steal the gesture mid-drag.
      onPanResponderTerminationRequest: () => false,
    });
  }, [interactive, size]);

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

  // Marker dot tracking the dragged position on the ring.
  const markerFrac = Math.min(1, Math.max(0, displayLtv / LIQ_LTV));
  const markerA = (tickAngle(markerFrac) * Math.PI) / 180;
  const markerX = center + Math.cos(markerA) * r;
  const markerY = center + Math.sin(markerA) * r;

  // Scrub readouts: once positioned at the selected LTV (via the add/remove
  // amount below), the collateral price that triggers liquidation, and the
  // signed collateral delta needed to move the loan there.
  const scrubbing = scrub != null && loan != null;
  const scrubLiqPrice = scrubbing ? liqPriceAtTargetLtv(loan, scrub) : 0;
  const scrubHeadroom = scrubbing ? headroomToTarget(loan, scrub) : 0;

  return (
    <View
      style={{ width: size, height: size }}
      {...(panResponder?.panHandlers ?? {})}
    >
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
        {scrubbing ? (
          <Circle
            cx={markerX}
            cy={markerY}
            r={stroke / 2 + 3}
            fill={colors.background}
            stroke={tone}
            strokeWidth={3}
          />
        ) : null}
      </Svg>
      <View style={styles.center} pointerEvents="none">
        {scrubbing ? (
          <>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>
              SELECTED
            </Text>
            <Text style={[styles.value, { color: tone }]}>
              {scrub.toFixed(1)}%
            </Text>
            <View style={styles.scrubRow}>
              <Text
                style={[styles.scrubLabel, { color: colors.mutedForeground }]}
              >
                liq at
              </Text>
              <Text style={[styles.scrubValue, { color: colors.foreground }]}>
                {scrubLiqPrice > 0 ? fmtMoney(scrubLiqPrice, currency) : "—"}
              </Text>
            </View>
            <View style={styles.scrubRow}>
              <Text
                style={[styles.scrubLabel, { color: colors.mutedForeground }]}
              >
                {scrubHeadroom < 0 ? "add" : "remove"}
              </Text>
              <Text
                style={[
                  styles.scrubValue,
                  { color: scrubHeadroom < 0 ? colors.warn : colors.ok },
                ]}
              >
                {fmtMoney(Math.abs(scrubHeadroom), currency)}
              </Text>
            </View>
          </>
        ) : (
          <>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>
              LTV
            </Text>
            <Text style={[styles.value, { color: tone }]}>
              {ltv.toFixed(1)}%
            </Text>
            <Text style={[styles.sub, { color: colors.mutedForeground }]}>
              target {targetLtv} · liq {LIQ_LTV}
            </Text>
            {interactive ? (
              <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                drag ring to explore
              </Text>
            ) : null}
          </>
        )}
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
  hint: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    marginTop: 6,
    opacity: 0.7,
  },
  scrubRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
    marginTop: 4,
  },
  scrubLabel: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  scrubValue: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    fontVariant: ["tabular-nums"],
  },
});
