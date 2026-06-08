import { useEffect, useMemo, useState } from "react";
import {
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as ScreenOrientation from "expo-screen-orientation";
import Svg, { Rect, Text as SvgText } from "react-native-svg";

import { useColors } from "@/hooks/useColors";
import { fmtMoney } from "@/utils/format";
import { reportError } from "@/lib/crashReporting";

export type DailyChargePoint = { day: string; usd: number };

type Currency = "USD" | "ZAR";

const RANGES = [30, 90, 180, 365] as const;
type Range = (typeof RANGES)[number];

function formatDay(day: string): string {
  // `day` is an ISO date (YYYY-MM-DD). Render compactly.
  const d = new Date(`${day}T00:00:00`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function Bars({
  data,
  width,
  height,
  currency,
  selected,
  onSelect,
  showLabels,
}: {
  data: DailyChargePoint[];
  width: number;
  height: number;
  currency: Currency;
  selected: number | null;
  onSelect: (i: number | null) => void;
  showLabels: boolean;
}) {
  const colors = useColors();
  const topPad = showLabels ? 18 : 8;
  const max = Math.max(0.0001, ...data.map((d) => d.usd));
  const gap = data.length > 60 ? 1 : data.length > 30 ? 2 : 4;
  const slot = width / Math.max(data.length, 1);
  const barW = Math.max(1, slot - gap);

  return (
    <Svg width={width} height={height}>
      {data.map((d, i) => {
        const h = (d.usd / max) * (height - topPad - 2);
        const x = i * slot;
        const y = height - h;
        const isSel = selected === i;
        return (
          <Rect
            key={d.day}
            x={x}
            y={y}
            width={barW}
            height={h}
            rx={2}
            fill={isSel ? colors.foreground : colors.primary}
            opacity={isSel ? 1 : 0.85}
            onPress={() => onSelect(isSel ? null : i)}
          />
        );
      })}
      {showLabels
        ? data.map((d, i) => {
            // Only label sparse charts to avoid clutter.
            if (data.length > 16 && selected !== i) return null;
            const h = (d.usd / max) * (height - topPad - 2);
            const x = i * slot + barW / 2;
            const y = height - h - 4;
            return (
              <SvgText
                key={`l-${d.day}`}
                x={x}
                y={y}
                fontSize={9}
                fontFamily="Inter_600SemiBold"
                fill={colors.mutedForeground}
                textAnchor="middle"
              >
                {fmtMoney(d.usd, currency, { compact: true })}
              </SvgText>
            );
          })
        : null}
    </Svg>
  );
}

/**
 * Reusable daily interest-charge bar chart with value labels, tap-to-inspect,
 * a 30/90/180/365-day range selector and a landscape fullscreen mode.
 *
 * `data` should be the full available history (oldest→newest); the component
 * slices it to the selected range. Longer ranges fill in as the server
 * accumulates daily buckets.
 */
export function DailyChargeChart({
  data,
  currency,
  hasRealData,
}: {
  data: DailyChargePoint[];
  currency: Currency;
  hasRealData: boolean;
}) {
  const colors = useColors();
  const [range, setRange] = useState<Range>(30);
  const [selected, setSelected] = useState<number | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const ranged = useMemo(() => {
    const sorted = [...data].sort((a, b) => a.day.localeCompare(b.day));
    return sorted.slice(-range);
  }, [data, range]);

  // Clear stale selection when the visible window changes.
  useEffect(() => {
    setSelected(null);
  }, [range]);

  // Lock to landscape while the fullscreen modal is open; restore on close.
  useEffect(() => {
    if (!fullscreen) return;
    let cancelled = false;
    void ScreenOrientation.lockAsync(
      ScreenOrientation.OrientationLock.LANDSCAPE,
    ).catch((e) => reportError(e, { op: "chart.orientation.lock" }));
    return () => {
      cancelled = true;
      void ScreenOrientation.unlockAsync().catch((e) =>
        reportError(e, { op: "chart.orientation.unlock" }),
      );
      if (cancelled) setSelected(null);
    };
  }, [fullscreen]);

  const sel = selected != null ? ranged[selected] : null;
  const totalForRange = ranged.reduce((s, d) => s + d.usd, 0);

  const RangeSeg = (
    <View style={[styles.seg, { borderColor: colors.border }]}>
      {RANGES.map((r) => {
        const on = range === r;
        const enabled = r <= 30 || data.length > 30;
        return (
          <Pressable
            key={r}
            disabled={!enabled}
            onPress={() => setRange(r)}
            style={[
              styles.segBtn,
              on && { backgroundColor: colors.primary + "22" },
            ]}
          >
            <Text
              style={[
                styles.segText,
                {
                  color: on
                    ? colors.primary
                    : enabled
                      ? colors.mutedForeground
                      : colors.border,
                },
              ]}
            >
              {r === 365 ? "1Y" : `${r}D`}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  const inlineW = 320;

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
        <Text style={[styles.cardLabel, { color: colors.mutedForeground }]}>
          DAILY CHARGE
        </Text>
        <View style={styles.headRight}>
          {RangeSeg}
          <Pressable
            onPress={() => setFullscreen(true)}
            hitSlop={8}
            disabled={!hasRealData}
            style={styles.expandBtn}
          >
            <Text style={[styles.expandText, { color: colors.primary }]}>
              ⤢
            </Text>
          </Pressable>
        </View>
      </View>

      {sel ? (
        <View style={styles.selRow}>
          <Text style={[styles.selDate, { color: colors.mutedForeground }]}>
            {formatDay(sel.day)}
          </Text>
          <Text style={[styles.selValue, { color: colors.foreground }]}>
            {fmtMoney(sel.usd, currency)}
          </Text>
        </View>
      ) : (
        <Text style={[styles.selDate, { color: colors.mutedForeground }]}>
          {range === 365 ? "1 year" : `${range} days`} ·{" "}
          {fmtMoney(totalForRange, currency)} total · tap a bar
        </Text>
      )}

      {hasRealData && ranged.length > 0 ? (
        <Bars
          data={ranged}
          width={inlineW}
          height={130}
          currency={currency}
          selected={selected}
          onSelect={setSelected}
          showLabels
        />
      ) : (
        <Text style={[styles.empty, { color: colors.mutedForeground }]}>
          Building daily-charge history — bars appear as data accumulates.
        </Text>
      )}

      <Modal
        visible={fullscreen}
        animationType="fade"
        supportedOrientations={["landscape"]}
        onRequestClose={() => setFullscreen(false)}
      >
        <View
          style={[styles.fsRoot, { backgroundColor: colors.background }]}
        >
          <View style={styles.fsHead}>
            <Text style={[styles.fsTitle, { color: colors.foreground }]}>
              Daily charge ·{" "}
              {range === 365 ? "1 year" : `${range} days`}
            </Text>
            <View style={styles.headRight}>
              {RangeSeg}
              <Pressable
                onPress={() => setFullscreen(false)}
                hitSlop={8}
                style={styles.expandBtn}
              >
                <Text style={[styles.expandText, { color: colors.primary }]}>
                  ✕
                </Text>
              </Pressable>
            </View>
          </View>
          {sel ? (
            <Text style={[styles.fsSel, { color: colors.foreground }]}>
              {formatDay(sel.day)} · {fmtMoney(sel.usd, currency)}
            </Text>
          ) : (
            <Text style={[styles.fsSel, { color: colors.mutedForeground }]}>
              Tap a bar to inspect
            </Text>
          )}
          <View style={styles.fsChart}>
            <Bars
              data={ranged}
              width={Dimensions.get("window").height - 48}
              height={Dimensions.get("window").width - 150}
              currency={currency}
              selected={selected}
              onSelect={setSelected}
              showLabels
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardLabel: { fontSize: 10, letterSpacing: 1, fontFamily: "Inter_600SemiBold" },
  seg: {
    flexDirection: "row",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 7,
    overflow: "hidden",
  },
  segBtn: { paddingHorizontal: 8, paddingVertical: 3 },
  segText: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.3,
  },
  expandBtn: { paddingHorizontal: 4, paddingVertical: 2 },
  expandText: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  selRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  selDate: { fontSize: 12, fontFamily: "Inter_400Regular" },
  selValue: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    fontVariant: ["tabular-nums"],
  },
  empty: {
    textAlign: "center",
    paddingVertical: 16,
    fontFamily: "Inter_400Regular",
  },
  fsRoot: { flex: 1, padding: 24 },
  fsHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  fsTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  fsSel: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    marginTop: 6,
  },
  fsChart: { flex: 1, justifyContent: "center", alignItems: "center" },
});
