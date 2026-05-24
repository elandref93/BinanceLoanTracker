import { useRouter } from "expo-router";
import { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Rect } from "react-native-svg";

import { ErrorView } from "@/components/ErrorView";
import { Sparkline } from "@/components/Sparkline";
import { Tile } from "@/components/Tile";
import { useCurrency } from "@/context/CurrencyContext";
import { useColors } from "@/hooks/useColors";
import { fmtMoney, fmtPct } from "@/utils/format";
import {
  useListAccounts,
  useListInterest,
  useListLoans,
} from "@workspace/api-client-react";

export default function HistoryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { currency } = useCurrency();

  const interestQ = useListInterest();
  const accountsQ = useListAccounts();
  const loansQ = useListLoans();

  const rows = interestQ.data?.rows ?? [];
  const byLoan = interestQ.data?.byLoan ?? [];
  const byAsset = interestQ.data?.byAsset ?? [];
  const accounts = accountsQ.data?.accounts ?? [];
  const loans = loansQ.data?.loans ?? [];

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

  if (interestQ.isLoading || accountsQ.isLoading || loansQ.isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (interestQ.isError || accountsQ.isError || loansQ.isError) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ErrorView
          message={(interestQ.error ?? accountsQ.error ?? loansQ.error)?.message}
          onRetry={() => {
            interestQ.refetch();
            accountsQ.refetch();
            loansQ.refetch();
          }}
        />
      </View>
    );
  }

  const max = Math.max(0.0001, ...byDay.map(([, v]) => v));
  const chartW = 320;
  const chartH = 120;
  const barW = chartW / Math.max(byDay.length, 1) - 4;

  const accountFor = (loanId: string) => {
    const l = loans.find((x) => x.id === loanId);
    const a = accounts.find((x) => x.id === l?.accountId);
    return a?.name ?? "—";
  };

  const sortedByLoan = [...byLoan].sort(
    (a, b) => b.projected30dUsd - a.projected30dUsd,
  );
  const sortedByAsset = [...byAsset].sort(
    (a, b) => b.projected30dUsd - a.projected30dUsd,
  );

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
          Last 30 days · projection at current rates
        </Text>
      </View>

      <View style={styles.row}>
        <Tile
          label="Charged · 30d"
          value={fmtMoney(interestQ.data?.totalUsd ?? 0, currency)}
          style={{ flex: 1 }}
        />
        <Tile
          label="Projected · next 30d"
          value={fmtMoney(interestQ.data?.projected30dUsd ?? 0, currency)}
          tone="primary"
          style={{ flex: 1 }}
        />
      </View>

      <View style={styles.row}>
        <Tile
          label="Weighted APR"
          value={fmtPct(interestQ.data?.weightedApr ?? 0, 2)}
          style={{ flex: 1 }}
        />
        <Tile
          label="Open loans"
          value={String(loans.length)}
          hint={`${accounts.length} account${accounts.length === 1 ? "" : "s"}`}
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
          BY LOAN · SORTED BY PROJECTED COST
        </Text>
        {sortedByLoan.length === 0 ? (
          <Text style={[styles.empty, { color: colors.mutedForeground }]}>
            No interest charges yet
          </Text>
        ) : (
          sortedByLoan.map((b, idx) => {
            const aprs = b.rateHistory.map((p) => p.apr);
            const delta =
              b.avg30dApr > 0
                ? ((b.currentApr - b.avg30dApr) / b.avg30dApr) * 100
                : 0;
            return (
              <Pressable
                key={b.loanId}
                onPress={() => router.push(`/loan/${b.loanId}`)}
                style={({ pressed }) => ({
                  opacity: pressed ? 0.6 : 1,
                  paddingVertical: 10,
                  borderTopWidth:
                    idx === 0 ? 0 : StyleSheet.hairlineWidth,
                  borderTopColor: colors.border,
                })}
              >
                <View style={styles.byLoanHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.byLoanAsset, { color: colors.foreground }]}>
                      {b.collateralAsset}/{b.asset}
                      <Text style={[styles.byLoanAccount, { color: colors.mutedForeground }]}>
                        {"  ·  "}
                        {accountFor(b.loanId)}
                      </Text>
                    </Text>
                    <Text style={[styles.byLoanMeta, { color: colors.mutedForeground }]}>
                      APR {fmtPct(b.currentApr, 2)} · 30d avg {fmtPct(b.avg30dApr, 2)}
                      {delta !== 0 ? (
                        <Text
                          style={{
                            color: delta > 0 ? colors.warn : colors.ok,
                            fontFamily: "Inter_600SemiBold",
                          }}
                        >
                          {"  "}
                          {delta > 0 ? "▲" : "▼"}
                          {Math.abs(delta).toFixed(1)}%
                        </Text>
                      ) : null}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={[styles.byLoanCost, { color: colors.foreground }]}>
                      {fmtMoney(b.projected30dUsd, currency, { compact: true })}
                    </Text>
                    <Text style={[styles.byLoanMeta, { color: colors.mutedForeground }]}>
                      / 30d
                    </Text>
                  </View>
                </View>
                {aprs.length >= 2 ? (
                  <View style={{ marginTop: 6 }}>
                    <Sparkline
                      values={aprs}
                      width={300}
                      height={28}
                      reference={b.avg30dApr}
                    />
                  </View>
                ) : null}
              </Pressable>
            );
          })
        )}
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
          BY BORROWED ASSET
        </Text>
        {sortedByAsset.length === 0 ? (
          <Text style={[styles.empty, { color: colors.mutedForeground }]}>
            No interest charges yet
          </Text>
        ) : (
          sortedByAsset.map((b) => (
            <View key={b.asset} style={styles.lineRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.lineLabel, { color: colors.foreground }]}>
                  {b.asset}
                </Text>
                <Text style={[styles.byLoanMeta, { color: colors.mutedForeground }]}>
                  {fmtMoney(b.debtUsd, currency, { compact: true })} debt · weighted APR {fmtPct(b.weightedApr, 2)}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[styles.lineValue, { color: colors.foreground }]}>
                  {fmtMoney(b.projected30dUsd, currency, { compact: true })}
                </Text>
                <Text style={[styles.byLoanMeta, { color: colors.mutedForeground }]}>
                  / 30d
                </Text>
              </View>
            </View>
          ))
        )}
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
  byLoanHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  byLoanAsset: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  byLoanAccount: { fontSize: 12, fontFamily: "Inter_400Regular" },
  byLoanMeta: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    fontVariant: ["tabular-nums"],
    marginTop: 2,
  },
  byLoanCost: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    fontVariant: ["tabular-nums"],
  },
  lineRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: 8,
  },
  lineLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
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
