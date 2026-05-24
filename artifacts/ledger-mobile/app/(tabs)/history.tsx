import { useMemo } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Rect } from "react-native-svg";

import { ErrorView } from "@/components/ErrorView";
import { Tile } from "@/components/Tile";
import { useCurrency } from "@/context/CurrencyContext";
import { useColors } from "@/hooks/useColors";
import { fmtMoney, fmtPct } from "@/utils/format";
import {
  useListAccounts,
  useListInterest,
} from "@workspace/api-client-react";

export default function HistoryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currency } = useCurrency();

  const interestQ = useListInterest();
  const accountsQ = useListAccounts();

  const rows = interestQ.data?.rows ?? [];
  const accounts = accountsQ.data?.accounts ?? [];

  const byDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const day = r.ts.slice(0, 10);
      m.set(day, (m.get(day) ?? 0) + r.amountUsd);
    }
    return Array.from(m.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-14);
  }, [rows]);

  const byAccount = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      m.set(r.accountId, (m.get(r.accountId) ?? 0) + r.amountUsd);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  if (interestQ.isLoading || accountsQ.isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (interestQ.isError || accountsQ.isError) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ErrorView
          message={(interestQ.error ?? accountsQ.error)?.message}
          onRetry={() => {
            interestQ.refetch();
            accountsQ.refetch();
          }}
        />
      </View>
    );
  }

  const max = Math.max(0.0001, ...byDay.map(([, v]) => v));
  const chartW = 320;
  const chartH = 140;
  const barW = chartW / Math.max(byDay.length, 1) - 4;

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{
        paddingTop: insets.top + 16,
        paddingBottom: insets.bottom + 100,
        paddingHorizontal: 16,
        gap: 16,
      }}
    >
      <View>
        <Text style={[styles.title, { color: colors.foreground }]}>
          Interest
        </Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Last 30 days
        </Text>
      </View>

      <View style={styles.row}>
        <Tile
          label="Total charged"
          value={fmtMoney(interestQ.data?.totalUsd ?? 0, currency)}
          style={{ flex: 1 }}
        />
        <Tile
          label="Weighted APR"
          value={fmtPct(interestQ.data?.weightedApr ?? 0, 2)}
          tone="primary"
          style={{ flex: 1 }}
        />
      </View>

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
        <Text style={[styles.cardLabel, { color: colors.mutedForeground }]}>
          DAILY CHARGE · LAST 14 DAYS
        </Text>
        <Svg width={chartW} height={chartH}>
          {byDay.map(([day, v], i) => {
            const h = (v / max) * (chartH - 16);
            const x = i * (barW + 4);
            const y = chartH - h;
            return (
              <Rect
                key={day}
                x={x}
                y={y}
                width={barW}
                height={h}
                rx={2}
                fill={colors.primary}
                opacity={0.85}
              />
            );
          })}
        </Svg>
      </View>

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
        <Text style={[styles.cardLabel, { color: colors.mutedForeground }]}>
          BY ACCOUNT
        </Text>
        {byAccount.map(([accId, v]) => {
          const acc = accounts.find((a) => a.id === accId);
          return (
            <View key={accId} style={styles.lineRow}>
              <Text style={[styles.lineLabel, { color: colors.foreground }]}>
                {acc?.name ?? accId}
              </Text>
              <Text style={[styles.lineValue, { color: colors.foreground }]}>
                {fmtMoney(v, currency)}
              </Text>
            </View>
          );
        })}
        {byAccount.length === 0 ? (
          <Text style={[styles.empty, { color: colors.mutedForeground }]}>
            No interest charges yet
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 24, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  row: { flexDirection: "row", gap: 10 },
  card: {
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  cardLabel: { fontSize: 10, letterSpacing: 1, fontFamily: "Inter_600SemiBold" },
  lineRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  lineLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  lineValue: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    fontVariant: ["tabular-nums"],
  },
  empty: {
    textAlign: "center",
    paddingVertical: 16,
    fontFamily: "Inter_400Regular",
  },
});
