import { Stack, useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { ErrorView } from "@/components/ErrorView";
import { Pill } from "@/components/Pill";
import { RiskGauge } from "@/components/RiskGauge";
import { useCurrency } from "@/context/CurrencyContext";
import { useColors } from "@/hooks/useColors";
import { fmtMoney, fmtPct, fmtQty } from "@/utils/format";
import {
  headroomToTarget,
  LIQ_LTV,
  priceAtLtv,
  priceDropPctTo,
  statusFromLtv,
  statusLabel,
  TARGET_LTV,
  WARNING_LTV,
} from "@/utils/risk";
import {
  useListAccounts,
  useListLoans,
} from "@workspace/api-client-react";

function Row({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
      <Text style={[styles.rowValue, { color: colors.foreground }]}>
        {value}
      </Text>
    </View>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const colors = useColors();
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
      <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>
        {title.toUpperCase()}
      </Text>
      <View style={{ gap: 6 }}>{children}</View>
    </View>
  );
}

export default function LoanDetailScreen() {
  const colors = useColors();
  const { currency } = useCurrency();
  const { id } = useLocalSearchParams<{ id: string }>();
  const loansQ = useListLoans();
  const accountsQ = useListAccounts();

  if (loansQ.isLoading || accountsQ.isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: "Loan" }} />
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (loansQ.isError || accountsQ.isError) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: "Loan" }} />
        <ErrorView
          message={(loansQ.error ?? accountsQ.error)?.message}
          onRetry={() => {
            loansQ.refetch();
            accountsQ.refetch();
          }}
        />
      </View>
    );
  }

  const loan = loansQ.data?.loans.find((l) => l.id === id);
  if (!loan) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: "Loan" }} />
        <Text style={{ color: colors.mutedForeground }}>Loan not found</Text>
      </View>
    );
  }
  const account = accountsQ.data?.accounts.find((a) => a.id === loan.accountId);
  const status = statusFromLtv(loan.ltv);
  const headroom = headroomToTarget(loan);
  const warnPrice = priceAtLtv(loan, WARNING_LTV);
  const liqPrice = priceAtLtv(loan, LIQ_LTV);
  const warnDrop = priceDropPctTo(loan, WARNING_LTV);
  const liqDrop = priceDropPctTo(loan, LIQ_LTV);
  const hourly = loan.debt * loan.hourlyInterestRate;
  const daily = hourly * 24;

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.wrap}
    >
      <Stack.Screen
        options={{ title: `${loan.collateral.asset} · ${account?.name ?? ""}` }}
      />
      <View style={styles.head}>
        <Text style={[styles.asset, { color: colors.foreground }]}>
          {loan.collateral.asset}/{loan.asset}
        </Text>
        <Pill status={status} label={statusLabel(status)} />
      </View>

      <View style={{ alignItems: "center", marginVertical: 6 }}>
        <RiskGauge ltv={loan.ltv} size={220} />
      </View>

      <Card title="Position">
        <Row
          label="Borrowed"
          value={`${fmtMoney(loan.debtUsd, currency)} (${loan.asset})`}
        />
        <Row
          label="Collateral"
          value={fmtQty(loan.collateral.qty, loan.collateral.asset)}
        />
        <Row
          label="Collateral value"
          value={fmtMoney(loan.collateral.valueUsd, currency)}
        />
        <Row
          label="Headroom to target"
          value={
            headroom > 0
              ? `+${fmtMoney(headroom, currency)}`
              : fmtMoney(-headroom, currency)
          }
        />
      </Card>

      <Card title="Price triggers">
        <Row
          label={`Warning (${WARNING_LTV}%)`}
          value={`${fmtMoney(warnPrice, currency)}  ·  ${fmtPct(warnDrop)}`}
        />
        <Row
          label={`Liquidation (${LIQ_LTV}%)`}
          value={`${fmtMoney(liqPrice, currency)}  ·  ${fmtPct(liqDrop)}`}
        />
      </Card>

      <Card title="Interest">
        <Row label="Hourly rate" value={`${(loan.hourlyInterestRate * 100).toFixed(5)}%`} />
        <Row label="Per day" value={fmtMoney(daily, currency)} />
        <Row label="Per 30 days" value={fmtMoney(daily * 30, currency)} />
        <Row label="Per 365 days" value={fmtMoney(daily * 365, currency)} />
      </Card>

      <Text style={[styles.foot, { color: colors.mutedForeground }]}>
        Read-only · adjust position in the Binance app
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 16, gap: 14, paddingBottom: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  asset: { fontSize: 20, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  card: {
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  cardTitle: { fontSize: 10, letterSpacing: 1, fontFamily: "Inter_600SemiBold" },
  row: { flexDirection: "row", justifyContent: "space-between" },
  rowLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  rowValue: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    fontVariant: ["tabular-nums"],
  },
  foot: {
    textAlign: "center",
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 4,
  },
});
