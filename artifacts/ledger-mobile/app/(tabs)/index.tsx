import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { checkAndNotifyLoans } from "@/lib/alerts";
import { buildSnapshot, writeWidgetSnapshot } from "@/lib/widgetSnapshot";
import { AccountChip } from "@/components/AccountChip";
import { ErrorView } from "@/components/ErrorView";
import { LoanRow } from "@/components/LoanRow";
import { Pill } from "@/components/Pill";
import { Tile } from "@/components/Tile";
import { useCurrency } from "@/context/CurrencyContext";
import { useColors } from "@/hooks/useColors";
import { fmtMoney, fmtPct } from "@/utils/format";
import {
  headroomToTarget,
  LIQ_LTV,
  priceAtLtv,
  priceDropPctTo,
  statusFromLtv,
  statusLabel,
} from "@/utils/risk";

function tap() {
  if (Platform.OS !== "web") {
    void Haptics.selectionAsync();
  }
}
import {
  useListAccounts,
  useListLoans,
} from "@workspace/api-client-react";

export default function DashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { currency, toggle } = useCurrency();
  const [filter, setFilter] = useState<string | null>(null);

  const accountsQ = useListAccounts();
  const loansQ = useListLoans();

  const accounts = accountsQ.data?.accounts ?? [];
  const all = loansQ.data?.loans ?? [];
  const loans = filter ? all.filter((l) => l.accountId === filter) : all;

  const accountLtv = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of accounts) {
      const ls = all.filter((l) => l.accountId === a.id);
      const debt = ls.reduce((s, l) => s + l.debtUsd, 0);
      const col = ls.reduce((s, l) => s + l.collateral.valueUsd, 0);
      m.set(a.id, col > 0 ? (debt / col) * 100 : 0);
    }
    return m;
  }, [accounts, all]);

  const totalDebtUsd = loans.reduce((s, l) => s + l.debtUsd, 0);
  const totalColUsd = loans.reduce((s, l) => s + l.collateral.valueUsd, 0);
  const aggLtv = totalColUsd > 0 ? (totalDebtUsd / totalColUsd) * 100 : 0;
  const status = statusFromLtv(aggLtv);

  const closest = useMemo(() => {
    if (loans.length === 0) return null;
    return [...loans].sort((a, b) => b.ltv - a.ltv)[0];
  }, [loans]);

  const totalHeadroomToTarget = useMemo(
    () =>
      loans.reduce((s, l) => {
        const h = headroomToTarget(l);
        return s + (h > 0 ? h : 0);
      }, 0),
    [loans],
  );

  useEffect(() => {
    if (all.length === 0) return;
    void checkAndNotifyLoans(all);
    void writeWidgetSnapshot(buildSnapshot(all));
  }, [all]);

  const refreshing = accountsQ.isFetching || loansQ.isFetching;
  const onRefresh = () => {
    accountsQ.refetch();
    loansQ.refetch();
  };

  if (accountsQ.isLoading || loansQ.isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (accountsQ.isError || loansQ.isError) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ErrorView
          message={(loansQ.error ?? accountsQ.error)?.message}
          onRetry={onRefresh}
        />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{
        paddingTop: insets.top + 16,
        paddingBottom: insets.bottom + 100,
        paddingHorizontal: 16,
        gap: 16,
      }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
        />
      }
    >
      <View style={styles.header}>
        <View>
          <Text style={[styles.title, { color: colors.foreground }]}>
            Dashboard
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Across {accounts.length} account{accounts.length === 1 ? "" : "s"}
          </Text>
        </View>
        <Pressable
          onPress={() => {
            tap();
            toggle();
          }}
          style={({ pressed }) => [
            styles.fxBtn,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: colors.radius,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Text style={[styles.fxText, { color: colors.foreground }]}>
            {currency}
          </Text>
          <Feather name="repeat" size={12} color={colors.mutedForeground} />
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        <AccountChip
          label="All"
          hint={fmtPct(aggLtv)}
          selected={filter === null}
          onPress={() => {
            tap();
            setFilter(null);
          }}
        />
        {accounts.map((a) => (
          <AccountChip
            key={a.id}
            label={a.name}
            hint={`LTV ${fmtPct(accountLtv.get(a.id) ?? 0)}`}
            selected={filter === a.id}
            onPress={() => {
              tap();
              setFilter(a.id);
            }}
          />
        ))}
      </ScrollView>

      <View
        style={[
          styles.hero,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius: colors.radius,
          },
        ]}
      >
        <Text style={[styles.heroLabel, { color: colors.mutedForeground }]}>
          AGGREGATE LTV
        </Text>
        <Text
          style={[
            styles.heroValue,
            {
              color:
                status === "ok"
                  ? colors.ok
                  : status === "warn"
                    ? colors.warn
                    : colors.danger,
            },
          ]}
        >
          {fmtPct(aggLtv)}
        </Text>
        <Pill status={status} label={statusLabel(status)} />
        <View style={styles.heroFooter}>
          <Text style={[styles.heroSub, { color: colors.mutedForeground }]}>
            Debt {fmtMoney(totalDebtUsd, currency, { compact: true })}
          </Text>
          <Text style={[styles.heroSub, { color: colors.mutedForeground }]}>
            Collateral {fmtMoney(totalColUsd, currency, { compact: true })}
          </Text>
        </View>
      </View>

      {closest ? (
        <Pressable
          onPress={() => {
            tap();
            router.push(`/loan/${closest.id}`);
          }}
          style={({ pressed }) => [
            styles.distance,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: colors.radius,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <View style={styles.distanceHead}>
            <Text style={[styles.tileLabel, { color: colors.mutedForeground }]}>
              CLOSEST TO LIQUIDATION
            </Text>
            <Text style={[styles.distAsset, { color: colors.foreground }]}>
              {closest.collateral.asset}
            </Text>
          </View>
          <Text style={[styles.distValue, { color: colors.danger }]}>
            {fmtPct(priceDropPctTo(closest, LIQ_LTV))}
          </Text>
          <View style={styles.distFooter}>
            <Text style={[styles.distHint, { color: colors.mutedForeground }]}>
              price drop until liquidation
            </Text>
            <Text style={[styles.distHint, { color: colors.mutedForeground }]}>
              at {fmtMoney(priceAtLtv(closest, LIQ_LTV), currency)}
            </Text>
          </View>
        </Pressable>
      ) : null}

      <View style={styles.tileRow}>
        <Tile
          label="Loans"
          value={String(loans.length)}
          style={{ flex: 1 }}
        />
        <Tile
          label="To reach 65%"
          value={fmtMoney(totalHeadroomToTarget, currency, { compact: true })}
          hint={totalHeadroomToTarget > 0 ? "add collateral" : "at target"}
          tone={totalHeadroomToTarget > 0 ? "warn" : "ok"}
          style={{ flex: 1 }}
        />
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          Loans
        </Text>
        <View style={{ gap: 10 }}>
          {loans.map((l) => {
            const acc = accounts.find((a) => a.id === l.accountId);
            return (
              <LoanRow
                key={l.id}
                loan={l}
                accountName={acc?.name ?? "—"}
                onPress={() => router.push(`/loan/${l.id}`)}
              />
            );
          })}
          {loans.length === 0 ? (
            <Text style={[styles.empty, { color: colors.mutedForeground }]}>
              No open loans
            </Text>
          ) : null}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 24, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  fxBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  fxText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  chipRow: { gap: 8, paddingRight: 8 },
  hero: {
    padding: 18,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  heroLabel: { fontSize: 10, letterSpacing: 1.5, fontFamily: "Inter_600SemiBold" },
  heroValue: {
    fontSize: 56,
    fontFamily: "Inter_700Bold",
    fontVariant: ["tabular-nums"],
    letterSpacing: -2,
  },
  heroFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  heroSub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    fontVariant: ["tabular-nums"],
  },
  distance: {
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  distanceHead: { flexDirection: "row", justifyContent: "space-between" },
  distFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },
  tileLabel: { fontSize: 10, letterSpacing: 1, fontFamily: "Inter_600SemiBold" },
  distAsset: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  distValue: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    fontVariant: ["tabular-nums"],
  },
  distHint: { fontSize: 11, fontFamily: "Inter_400Regular" },
  tileRow: { flexDirection: "row", gap: 10 },
  section: { gap: 10 },
  sectionTitle: {
    fontSize: 13,
    letterSpacing: 0.5,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
  },
  empty: { textAlign: "center", paddingVertical: 24, fontFamily: "Inter_400Regular" },
});
