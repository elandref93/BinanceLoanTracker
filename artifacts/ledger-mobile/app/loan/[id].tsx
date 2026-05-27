import { Feather } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Container } from "@/components/Container";
import { ErrorView } from "@/components/ErrorView";
import { Pill } from "@/components/Pill";
import { RiskGauge } from "@/components/RiskGauge";
import { ScreenLoader } from "@/components/ScreenLoader";
import { Sparkline } from "@/components/Sparkline";
import { useCurrency } from "@/context/CurrencyContext";
import { useColors } from "@/hooks/useColors";
import {
  deleteAlertRule,
  listAlertRules,
  ruleAppliesTo,
  type AlertRule,
} from "@/lib/alertRules";
import { useTargetLtv } from "@/context/RiskSettingsContext";
import { fmtMoney, fmtPct, fmtQty } from "@/utils/format";
import {
  headroomToTarget,
  LIQ_LTV,
  priceAtLtv,
  priceDropPctTo,
  statusFromLtv,
  statusLabel,
  WARNING_LTV,
} from "@/utils/risk";
import {
  useListAccounts,
  useListInterest,
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
  right,
}: {
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
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
      <View style={styles.cardHead}>
        <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>
          {title.toUpperCase()}
        </Text>
        {right}
      </View>
      <View style={{ gap: 6 }}>{children}</View>
    </View>
  );
}

export default function LoanDetailScreen() {
  const colors = useColors();
  const targetLtv = useTargetLtv();
  const router = useRouter();
  const { currency } = useCurrency();
  const { id } = useLocalSearchParams<{ id: string }>();
  const loansQ = useListLoans();
  const accountsQ = useListAccounts();
  const interestQ = useListInterest();

  const [rules, setRules] = useState<AlertRule[]>([]);
  const refreshRules = () => {
    void listAlertRules().then(setRules);
  };
  useEffect(refreshRules, []);

  if (loansQ.isLoading || accountsQ.isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: "Loan" }} />
        <ScreenLoader hint="Loading loan…" />
      </>
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
  const status = statusFromLtv(loan.ltv, targetLtv);
  const headroom = headroomToTarget(loan, targetLtv);
  const warnPrice = priceAtLtv(loan, WARNING_LTV);
  const liqPrice = priceAtLtv(loan, LIQ_LTV);
  const warnDrop = priceDropPctTo(loan, WARNING_LTV);
  const liqDrop = priceDropPctTo(loan, LIQ_LTV);
  const hourly = loan.debt * loan.hourlyInterestRate;
  const daily = hourly * 24;

  const byLoan = interestQ.data?.byLoan.find((b) => b.loanId === loan.id);
  const rateHistory = byLoan?.rateHistory ?? [];
  const sparkValues = rateHistory.map((p) => p.apr);
  const aprDelta =
    byLoan && byLoan.avg30dApr > 0
      ? ((byLoan.currentApr - byLoan.avg30dApr) / byLoan.avg30dApr) * 100
      : 0;

  const relevantRules = rules.filter((r) => ruleAppliesTo(r, loan.id));

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.wrap}
    >
      <Stack.Screen
        options={{ title: `${loan.collateral.asset} · ${account?.name ?? ""}` }}
      />
      <Container style={{ gap: 14 }}>
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

      <Card
        title="Interest rate"
        right={
          aprDelta !== 0 && byLoan ? (
            <Text
              style={[
                styles.delta,
                {
                  color: aprDelta > 0 ? colors.warn : colors.ok,
                },
              ]}
            >
              {aprDelta > 0 ? "▲" : "▼"} {Math.abs(aprDelta).toFixed(1)}% vs 30d
            </Text>
          ) : null
        }
      >
        <View style={styles.bigRow}>
          <Text style={[styles.bigValue, { color: colors.foreground }]}>
            {fmtPct(loan.apr, 2)}
          </Text>
          <Text style={[styles.bigUnit, { color: colors.mutedForeground }]}>
            APR
          </Text>
        </View>
        {sparkValues.length >= 2 ? (
          <View style={{ marginVertical: 4 }}>
            <Sparkline
              values={sparkValues}
              width={300}
              height={48}
              reference={byLoan?.avg30dApr}
            />
            <View style={styles.sparkAxis}>
              <Text style={[styles.sparkAxisText, { color: colors.mutedForeground }]}>
                30d ago
              </Text>
              <Text style={[styles.sparkAxisText, { color: colors.mutedForeground }]}>
                today
              </Text>
            </View>
          </View>
        ) : null}
        {byLoan ? (
          <>
            <Row label="30d average" value={fmtPct(byLoan.avg30dApr, 2)} />
            <Row
              label="30d range"
              value={`${fmtPct(byLoan.min30dApr, 2)} – ${fmtPct(byLoan.max30dApr, 2)}`}
            />
            <Row label="Hourly rate" value={`${(loan.hourlyInterestRate * 100).toFixed(5)}%`} />
          </>
        ) : (
          <Row label="Hourly rate" value={`${(loan.hourlyInterestRate * 100).toFixed(5)}%`} />
        )}
      </Card>

      <Card title="Drop simulator">
        <Text style={[styles.simHint, { color: colors.mutedForeground }]}>
          If {loan.collateral.asset} falls from{" "}
          {fmtMoney(loan.collateral.valueUsd / loan.collateral.qty, currency)}…
        </Text>
        <View style={styles.simRow}>
          {[5, 10, 20, 30, 40].map((pct) => {
            const projectedLtv = loan.ltv / (1 - pct / 100);
            const projectedStatus = statusFromLtv(projectedLtv, targetLtv);
            const tone =
              projectedStatus === "ok"
                ? colors.ok
                : projectedStatus === "warn"
                  ? colors.warn
                  : colors.danger;
            const past = projectedLtv >= LIQ_LTV;
            return (
              <View
                key={pct}
                style={[
                  styles.simCell,
                  {
                    borderColor: colors.border,
                    borderRadius: 8,
                  },
                ]}
              >
                <Text
                  style={[styles.simPct, { color: colors.mutedForeground }]}
                >
                  −{pct}%
                </Text>
                <Text style={[styles.simLtv, { color: tone }]}>
                  {past ? "LIQ" : fmtPct(projectedLtv, 0)}
                </Text>
              </View>
            );
          })}
        </View>
        <Text style={[styles.simFoot, { color: colors.mutedForeground }]}>
          Liquidation at {fmtPct(LIQ_LTV, 0)} LTV
        </Text>
      </Card>

      <Card title="Debt growth">
        <Text style={[styles.simHint, { color: colors.mutedForeground }]}>
          Interest accrues into the debt — there are no repayments.
        </Text>
        <Row label="Today" value={fmtMoney(loan.debtUsd, currency)} />
        <Row
          label="In 30 days"
          value={fmtMoney(loan.debtUsd + daily * 30, currency)}
        />
        <Row
          label="In 90 days"
          value={fmtMoney(loan.debtUsd + daily * 90, currency)}
        />
        <Row
          label="In 365 days"
          value={fmtMoney(loan.debtUsd + daily * 365, currency)}
        />
        <Row label="Daily interest" value={fmtMoney(daily, currency)} />
        {byLoan ? (
          <Row
            label="Accrued last 30d"
            value={fmtMoney(byLoan.accrued30dUsd, currency)}
          />
        ) : null}
        {byLoan && byLoan.lifetimeInterestUsd > 0 ? (
          <Row
            label={
              byLoan.loanAgeDays > 0
                ? `Interest paid · ${byLoan.loanAgeDays}d`
                : "Interest paid"
            }
            value={fmtMoney(byLoan.lifetimeInterestUsd, currency)}
          />
        ) : null}
      </Card>

      <Pressable
        onPress={() => {
          void Linking.openURL(
            "https://www.binance.com/en/loan/orderRecord/loan/open",
          );
        }}
        style={({ pressed }) => [
          styles.binanceBtn,
          {
            borderColor: colors.border,
            backgroundColor: colors.card,
            borderRadius: colors.radius,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        <Feather name="external-link" size={14} color={colors.primary} />
        <Text style={[styles.binanceBtnText, { color: colors.foreground }]}>
          Open in Binance
        </Text>
      </Pressable>

      <Card
        title="Alerts for this loan"
        right={
          <Pressable
            onPress={() =>
              router.push({
                pathname: "/alert-rule",
                params: { loanId: loan.id },
              })
            }
            hitSlop={8}
          >
            <Feather name="plus" size={18} color={colors.primary} />
          </Pressable>
        }
      >
        {relevantRules.length === 0 ? (
          <Text style={[styles.empty, { color: colors.mutedForeground }]}>
            No alerts configured
          </Text>
        ) : (
          relevantRules.map((r) => (
            <Pressable
              key={r.id}
              onPress={() =>
                router.push({ pathname: "/alert-rule", params: { id: r.id } })
              }
              style={({ pressed }) => [
                styles.ruleRow,
                { opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.ruleLtv, { color: colors.foreground }]}>
                  {fmtPct(r.ltv, 1)} LTV
                </Text>
                <Text style={[styles.ruleScope, { color: colors.mutedForeground }]}>
                  {r.label ?? (r.scope === "any" ? "Any loan" : "This loan only")}
                </Text>
              </View>
              <Pressable
                hitSlop={10}
                onPress={async () => {
                  await deleteAlertRule(r.id);
                  refreshRules();
                }}
              >
                <Feather name="trash-2" size={16} color={colors.mutedForeground} />
              </Pressable>
            </Pressable>
          ))
        )}
      </Card>

      <Text style={[styles.foot, { color: colors.mutedForeground }]}>
        Read-only · adjust position in the Binance app
      </Text>
      </Container>
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
  cardHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardTitle: { fontSize: 10, letterSpacing: 1, fontFamily: "Inter_600SemiBold" },
  row: { flexDirection: "row", justifyContent: "space-between" },
  rowLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  rowValue: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    fontVariant: ["tabular-nums"],
  },
  bigRow: { flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 2 },
  bigValue: {
    fontSize: 36,
    fontFamily: "Inter_700Bold",
    fontVariant: ["tabular-nums"],
    letterSpacing: -1,
  },
  bigUnit: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  delta: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    fontVariant: ["tabular-nums"],
  },
  sparkAxis: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },
  sparkAxisText: { fontSize: 10, fontFamily: "Inter_400Regular" },
  ruleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
  },
  ruleLtv: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    fontVariant: ["tabular-nums"],
  },
  ruleScope: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  empty: { fontSize: 12, fontFamily: "Inter_400Regular", paddingVertical: 4 },
  simHint: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 4 },
  simRow: { flexDirection: "row", gap: 6 },
  simCell: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    gap: 2,
  },
  simPct: {
    fontSize: 10,
    letterSpacing: 0.5,
    fontFamily: "Inter_600SemiBold",
  },
  simLtv: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    fontVariant: ["tabular-nums"],
  },
  simFoot: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    marginTop: 4,
    textAlign: "right",
  },
  binanceBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  binanceBtnText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  foot: {
    textAlign: "center",
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 4,
  },
});
