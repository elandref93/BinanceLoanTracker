import { Feather } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { Container } from "@/components/Container";
import { ErrorView } from "@/components/ErrorView";
import { Pill } from "@/components/Pill";
import { RiskGauge } from "@/components/RiskGauge";
import { ScreenSkeleton } from "@/components/Skeleton";
import { Sparkline } from "@/components/Sparkline";
import { useCurrency } from "@/context/CurrencyContext";
import { useColors } from "@/hooks/useColors";
import {
  deleteAlertRule,
  isContainerScope,
  listAlertRules,
  ruleAppliesTo,
  type AlertRule,
} from "@/lib/alertRules";
import { useRiskSettings } from "@/context/RiskSettingsContext";
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
  aprSeriesFor,
  aprStatsFor,
  getSnapshotsSince,
  type LoanSnapshot,
} from "@/lib/loanSnapshots";
import {
  useGetRateHistory,
  useListAccounts,
  useListInterest,
  useListLoanTransactions,
  useListLoans,
} from "@workspace/api-client-react";
import {
  getLoanAnnotation,
  setLoanAnnotation,
  subscribeLoanAnnotations,
  type GoalMode,
  type LoanAnnotation,
} from "@/lib/loanAnnotations";

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

// Simulate month-by-month payoff: interest compounds on the declining balance,
// the contribution is applied at month end. Returns months-to-settle (capped)
// or null when the contribution never outpaces interest.
function monthsToSettle(
  principal: number,
  monthlyRate: number,
  contribution: number,
): number | null {
  if (principal <= 0) return 0;
  if (contribution <= 0) return null;
  let balance = principal;
  for (let m = 1; m <= 600; m++) {
    balance = balance * (1 + monthlyRate) - contribution;
    if (balance <= 0) return m;
  }
  return null; // > 50 years ⇒ effectively never with this contribution
}

// Required monthly contribution to clear `principal` in `n` months at
// `monthlyRate` (standard amortization; falls back to straight-line at r≈0).
function requiredMonthly(
  principal: number,
  monthlyRate: number,
  n: number,
): number {
  if (n <= 0) return principal;
  if (monthlyRate <= 1e-9) return principal / n;
  const f = Math.pow(1 + monthlyRate, -n);
  return (principal * monthlyRate) / (1 - f);
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  d.setMonth(d.getMonth() + months);
  return d;
}

function monthsUntil(target: Date, from: Date): number {
  const ms = target.getTime() - from.getTime();
  return ms / (1000 * 60 * 60 * 24 * 30.44);
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function LoanDetailScreen() {
  const colors = useColors();
  const { targetForAccountId, containerForAccountId } = useRiskSettings();
  const router = useRouter();
  const { currency } = useCurrency();
  const { id } = useLocalSearchParams<{ id: string }>();
  const loansQ = useListLoans();
  const accountsQ = useListAccounts();
  const interestQ = useListInterest();

  const [rateWindow, setRateWindow] = useState<30 | 90>(30);
  const rateHistQ = useGetRateHistory(
    { loanId: id ?? "", days: rateWindow },
    { query: { enabled: !!id } as never },
  );

  const [rules, setRules] = useState<AlertRule[]>([]);
  const refreshRules = () => {
    void listAlertRules().then(setRules);
  };
  useEffect(refreshRules, []);

  const [snapshots, setSnapshots] = useState<LoanSnapshot[]>([]);
  useEffect(() => {
    void getSnapshotsSince(30).then(setSnapshots);
  }, [interestQ.dataUpdatedAt]);

  const txQ = useListLoanTransactions(
    { loanId: id ?? "" },
    { query: { enabled: !!id } as never },
  );

  // Per-loan user annotations (manual sell rate + repayment goal), synced
  // cross-device. Hydrate on mount and react to remote updates.
  const [annotation, setAnnotation] = useState<LoanAnnotation>({});
  useEffect(() => {
    if (!id) return;
    void getLoanAnnotation(id).then(setAnnotation);
    return subscribeLoanAnnotations(() => {
      void getLoanAnnotation(id).then(setAnnotation);
    });
  }, [id]);
  // Local draft strings for the numeric/date inputs (committed on blur).
  const [sellRateDraft, setSellRateDraft] = useState("");
  const [contribDraft, setContribDraft] = useState("");
  const [targetDraft, setTargetDraft] = useState("");
  useEffect(() => {
    setSellRateDraft(
      annotation.sellRate != null ? String(annotation.sellRate) : "",
    );
    setContribDraft(
      annotation.monthlyContribution != null
        ? String(annotation.monthlyContribution)
        : "",
    );
    setTargetDraft(annotation.targetSettleDate ?? "");
  }, [
    annotation.sellRate,
    annotation.monthlyContribution,
    annotation.targetSettleDate,
  ]);

  if (loansQ.isLoading || accountsQ.isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: "Loan" }} />
        <ScreenSkeleton kind="loanDetail" />
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
  const targetLtv = targetForAccountId(loan.accountId);
  const status = statusFromLtv(loan.ltv, targetLtv);
  const headroom = headroomToTarget(loan, targetLtv);
  const warnPrice = priceAtLtv(loan, WARNING_LTV);
  const liqPrice = priceAtLtv(loan, LIQ_LTV);
  const warnDrop = priceDropPctTo(loan, WARNING_LTV);
  const liqDrop = priceDropPctTo(loan, LIQ_LTV);
  // Binance sometimes returns a 0/absent hourly rate even when the loan's APR
  // is known (the two ship on different endpoints). Derive the hourly rate
  // from the reliable APR in that case so the "Hourly rate" row and the
  // debt-growth projections never collapse to a misleading 0.
  const HOURS_PER_YEAR = 365 * 24;
  const effectiveHourlyRate =
    loan.hourlyInterestRate > 0
      ? loan.hourlyInterestRate
      : loan.apr > 0
        ? loan.apr / 100 / HOURS_PER_YEAR
        : 0;
  const hourly = loan.debt * effectiveHourlyRate;
  const daily = hourly * 24;

  // ── Repayment forecasting ──
  // Work in USD (these loans are stablecoin-borrowed, so debt ≈ debtUsd). The
  // monthly rate compounds the declining balance against ongoing accrual.
  const goalMode: GoalMode = annotation.goalMode ?? "contribution";
  const monthlyRate = effectiveHourlyRate * 24 * 30.44;
  const monthlyInterestUsd = loan.debtUsd * monthlyRate;
  const contribution = annotation.monthlyContribution ?? 0;
  const settleMonths = monthsToSettle(loan.debtUsd, monthlyRate, contribution);
  const payoffDate =
    settleMonths != null && settleMonths > 0
      ? addMonths(new Date(), settleMonths)
      : null;
  const targetDate = annotation.targetSettleDate
    ? new Date(annotation.targetSettleDate)
    : null;
  const targetMonths =
    targetDate && !Number.isNaN(targetDate.getTime())
      ? Math.max(1, Math.round(monthsUntil(targetDate, new Date())))
      : null;
  const requiredPerMonth =
    targetMonths != null
      ? requiredMonthly(loan.debtUsd, monthlyRate, targetMonths)
      : null;

  // ── Real borrow/repay events for this loan ──
  const loanTxs = txQ.data?.transactions ?? [];
  const repayments = loanTxs.filter((t) => t.type === "repay");

  const byLoan = interestQ.data?.byLoan.find((b) => b.loanId === loan.id);

  // Interest-rate history. The server now serves REAL per-day rates for margin
  // loans (cross + isolated) from Binance's interest history; crypto loans have
  // no such endpoint, so it returns a flat series. We overlay the app's own
  // locally-recorded nominal-APR snapshots so "actual charged" vs "quoted" can
  // be compared, and fall back to the local series entirely when the server is
  // flat. 30d stats stay on a 30-day basis regardless of the chart window.
  const rateData = rateHistQ.data;
  const serverSeries = rateData?.points.map((p) => p.apr) ?? [];
  const serverIsMargin =
    rateData?.source === "margin" && serverSeries.length >= 2;

  const localStats = aprStatsFor(snapshots, loan.id, 30);
  const localWindowSeries = aprSeriesFor(snapshots, loan.id, rateWindow);

  const chartKind: "margin" | "local" | "flat" | null = serverIsMargin
    ? "margin"
    : localWindowSeries.length >= 2
      ? "local"
      : serverSeries.length >= 2
        ? "flat"
        : null;
  const chartValues =
    chartKind === "margin"
      ? serverSeries
      : chartKind === "local"
        ? localWindowSeries
        : chartKind === "flat"
          ? serverSeries
          : [];
  const overlayValues =
    serverIsMargin && localWindowSeries.length >= 2
      ? localWindowSeries
      : undefined;

  const avg30 = serverIsMargin
    ? rateData.avg30dApr
    : (localStats?.avg ?? rateData?.avg30dApr ?? loan.apr);
  const min30 = serverIsMargin
    ? rateData.min30dApr
    : (localStats?.min ?? rateData?.min30dApr ?? loan.apr);
  const max30 = serverIsMargin
    ? rateData.max30dApr
    : (localStats?.max ?? rateData?.max30dApr ?? loan.apr);
  // Server always returns a trailing-30d avg/min/max (real for margin, the
  // current rate for flat-fallback products), so surface stats whenever we
  // have *any* source — server flat data included, not just margin/local.
  const hasStats = serverIsMargin || localStats !== null || rateData != null;
  // A flat series collapses min===max; a "30d range: X – X" row is just noise.
  const hasRange = min30 !== max30;
  const aprDelta = avg30 > 0 ? ((loan.apr - avg30) / avg30) * 100 : 0;
  const hasRealHistory = chartValues.length >= 2;

  const loanContainer = containerForAccountId(loan.accountId);
  const relevantRules = rules.filter((r) =>
    ruleAppliesTo(r, loan.id, loanContainer?.id),
  );

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
        <RiskGauge ltv={loan.ltv} size={220} target={targetLtv} />
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
          label={headroom >= 0 ? "Headroom to target" : "Over target by"}
          value={
            headroom >= 0
              ? `+${fmtMoney(headroom, currency)}`
              : `−${fmtMoney(-headroom, currency)}`
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
          <View style={[styles.seg, { borderColor: colors.border }]}>
            {([30, 90] as const).map((d) => {
              const on = rateWindow === d;
              return (
                <Pressable
                  key={d}
                  onPress={() => setRateWindow(d)}
                  hitSlop={6}
                  style={[
                    styles.segBtn,
                    on && { backgroundColor: colors.primary + "22" },
                  ]}
                >
                  <Text
                    style={[
                      styles.segText,
                      { color: on ? colors.primary : colors.mutedForeground },
                    ]}
                  >
                    {d}D
                  </Text>
                </Pressable>
              );
            })}
          </View>
        }
      >
        <View style={styles.bigRow}>
          <Text style={[styles.bigValue, { color: colors.foreground }]}>
            {fmtPct(loan.apr, 2)}
          </Text>
          <Text style={[styles.bigUnit, { color: colors.mutedForeground }]}>
            APR
          </Text>
          {aprDelta !== 0 && hasStats ? (
            <Text
              style={[
                styles.delta,
                { color: aprDelta > 0 ? colors.warn : colors.ok },
              ]}
            >
              {aprDelta > 0 ? "▲" : "▼"} {Math.abs(aprDelta).toFixed(1)}% vs 30d
            </Text>
          ) : null}
        </View>
        {rateHistQ.isLoading && !hasRealHistory ? (
          <Text style={[styles.simHint, { color: colors.mutedForeground }]}>
            Loading rate history…
          </Text>
        ) : hasRealHistory ? (
          <View style={{ marginVertical: 4 }}>
            <Sparkline
              values={chartValues}
              overlay={overlayValues}
              height={56}
              reference={avg30}
              formatValue={(v) => fmtPct(v, 2)}
            />
            <View style={styles.sparkAxis}>
              <Text
                style={[styles.sparkAxisText, { color: colors.mutedForeground }]}
              >
                {rateWindow}d ago
              </Text>
              <Text
                style={[styles.sparkAxisText, { color: colors.mutedForeground }]}
              >
                today
              </Text>
            </View>
            {overlayValues ? (
              <View style={styles.legend}>
                <View style={styles.legendItem}>
                  <View
                    style={[styles.legendDot, { backgroundColor: colors.primary }]}
                  />
                  <Text
                    style={[styles.legendText, { color: colors.mutedForeground }]}
                  >
                    Actual charged
                  </Text>
                </View>
                <View style={styles.legendItem}>
                  <View
                    style={[
                      styles.legendDot,
                      { backgroundColor: colors.mutedForeground },
                    ]}
                  />
                  <Text
                    style={[styles.legendText, { color: colors.mutedForeground }]}
                  >
                    Nominal (quoted)
                  </Text>
                </View>
              </View>
            ) : null}
          </View>
        ) : null}
        {hasStats ? (
          <>
            <Row label="30d average" value={fmtPct(avg30, 2)} />
            {hasRange ? (
              <Row
                label="30d range"
                value={`${fmtPct(min30, 2)} – ${fmtPct(max30, 2)}`}
              />
            ) : null}
          </>
        ) : (
          <Text style={[styles.simHint, { color: colors.mutedForeground }]}>
            Building rate history locally — 30d stats appear after a few refreshes.
          </Text>
        )}
        {chartKind === "margin" ? (
          <Text style={[styles.simHint, { color: colors.mutedForeground }]}>
            Actual rate charged, from Binance interest history.
          </Text>
        ) : chartKind === "local" ? (
          <Text style={[styles.simHint, { color: colors.mutedForeground }]}>
            Nominal APR recorded by this app on each refresh.
          </Text>
        ) : null}
        <Row
          label="Hourly rate"
          value={`${(effectiveHourlyRate * 100).toFixed(5)}%`}
        />
        <Row label="Hourly interest" value={fmtMoney(hourly, currency)} />
      </Card>

      <Card title="Price simulator">
        <View style={styles.simPriceRow}>
          <Text style={[styles.simPriceLabel, { color: colors.mutedForeground }]}>
            {loan.collateral.asset} price now
          </Text>
          <Text style={[styles.simPriceValue, { color: colors.foreground }]}>
            {loan.collateral.qty > 0
              ? fmtMoney(
                  loan.collateral.valueUsd / loan.collateral.qty,
                  currency,
                )
              : "—"}
          </Text>
        </View>

        <Text style={[styles.simCaption, { color: colors.mutedForeground }]}>
          If {loan.collateral.asset} falls
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
                  { borderColor: colors.border, borderRadius: 8 },
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

        <Text style={[styles.simCaption, { color: colors.mutedForeground }]}>
          If {loan.collateral.asset} rises
        </Text>
        <View style={styles.simRow}>
          {[5, 10, 20, 30, 40].map((pct) => {
            const projectedLtv = loan.ltv / (1 + pct / 100);
            const projectedStatus = statusFromLtv(projectedLtv, targetLtv);
            const tone =
              projectedStatus === "ok"
                ? colors.ok
                : projectedStatus === "warn"
                  ? colors.warn
                  : colors.danger;
            return (
              <View
                key={pct}
                style={[
                  styles.simCell,
                  { borderColor: colors.border, borderRadius: 8 },
                ]}
              >
                <Text
                  style={[styles.simPct, { color: colors.mutedForeground }]}
                >
                  +{pct}%
                </Text>
                <Text style={[styles.simLtv, { color: tone }]}>
                  {fmtPct(projectedLtv, 0)}
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
          {repayments.length > 0
            ? "Interest accrues into the debt; repayments reduce the amount due."
            : "Interest accrues into the debt. No repayments recorded yet."}
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

      <Card title="Repayments">
        {txQ.isLoading ? (
          <Text style={[styles.simHint, { color: colors.mutedForeground }]}>
            Loading repayment history…
          </Text>
        ) : repayments.length === 0 ? (
          <Text style={[styles.empty, { color: colors.mutedForeground }]}>
            No repayments recorded for this loan.
          </Text>
        ) : (
          repayments.map((t, i) => (
            <View key={`${t.ts}-${i}`} style={styles.txRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.txAmount, { color: colors.ok }]}>
                  −{fmtQty(t.amount, t.asset)}
                </Text>
                <Text
                  style={[styles.txDate, { color: colors.mutedForeground }]}
                >
                  {fmtDate(new Date(t.ts))}
                </Text>
              </View>
              <Text style={[styles.txUsd, { color: colors.foreground }]}>
                {fmtMoney(t.amountUsd, currency)}
              </Text>
            </View>
          ))
        )}
      </Card>

      <Card title="Repayment plan">
        <View style={styles.fieldRow}>
          <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
            Luno sell rate (ZAR)
          </Text>
          <TextInput
            value={sellRateDraft}
            onChangeText={setSellRateDraft}
            onEndEditing={() => {
              const n = Number(sellRateDraft);
              void setLoanAnnotation(loan.id, {
                sellRate:
                  sellRateDraft.trim() === "" || !Number.isFinite(n) ? null : n,
              });
            }}
            keyboardType="decimal-pad"
            placeholder="—"
            placeholderTextColor={colors.mutedForeground}
            style={[
              styles.input,
              {
                color: colors.foreground,
                borderColor: colors.border,
                borderRadius: 8,
              },
            ]}
          />
        </View>

        <View style={[styles.seg, { borderColor: colors.border, marginTop: 4 }]}>
          {(
            [
              ["contribution", "Monthly → date"],
              ["target", "Date → monthly"],
            ] as const
          ).map(([mode, label]) => {
            const on = goalMode === mode;
            return (
              <Pressable
                key={mode}
                onPress={() =>
                  void setLoanAnnotation(loan.id, { goalMode: mode })
                }
                style={[
                  styles.segBtn,
                  { flex: 1, alignItems: "center" },
                  on && { backgroundColor: colors.primary + "22" },
                ]}
              >
                <Text
                  style={[
                    styles.segText,
                    { color: on ? colors.primary : colors.mutedForeground },
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {goalMode === "contribution" ? (
          <>
            <View style={styles.fieldRow}>
              <Text
                style={[styles.fieldLabel, { color: colors.mutedForeground }]}
              >
                Monthly contribution ({currency})
              </Text>
              <TextInput
                value={contribDraft}
                onChangeText={setContribDraft}
                onEndEditing={() => {
                  const n = Number(contribDraft);
                  void setLoanAnnotation(loan.id, {
                    monthlyContribution:
                      contribDraft.trim() === "" || !Number.isFinite(n)
                        ? null
                        : n,
                  });
                }}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={colors.mutedForeground}
                style={[
                  styles.input,
                  {
                    color: colors.foreground,
                    borderColor: colors.border,
                    borderRadius: 8,
                  },
                ]}
              />
            </View>
            <Row
              label="Monthly interest"
              value={fmtMoney(monthlyInterestUsd, currency)}
            />
            {contribution > 0 ? (
              settleMonths != null && payoffDate ? (
                <>
                  <Row
                    label="Settles in"
                    value={`${settleMonths} mo`}
                  />
                  <Row label="Projected payoff" value={fmtDate(payoffDate)} />
                </>
              ) : (
                <Text
                  style={[styles.simHint, { color: colors.warn, marginTop: 4 }]}
                >
                  Contribution must exceed monthly interest (
                  {fmtMoney(monthlyInterestUsd, currency)}) to ever settle.
                </Text>
              )
            ) : (
              <Text
                style={[
                  styles.simHint,
                  { color: colors.mutedForeground, marginTop: 4 },
                ]}
              >
                Enter a monthly contribution to project a payoff date.
              </Text>
            )}
          </>
        ) : (
          <>
            <View style={styles.fieldRow}>
              <Text
                style={[styles.fieldLabel, { color: colors.mutedForeground }]}
              >
                Target date (YYYY-MM-DD)
              </Text>
              <TextInput
                value={targetDraft}
                onChangeText={setTargetDraft}
                onEndEditing={() => {
                  const raw = targetDraft.trim();
                  const ok = /^\d{4}-\d{2}-\d{2}$/.test(raw);
                  void setLoanAnnotation(loan.id, {
                    targetSettleDate: ok ? raw : null,
                  });
                }}
                placeholder="2027-01-01"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                style={[
                  styles.input,
                  {
                    color: colors.foreground,
                    borderColor: colors.border,
                    borderRadius: 8,
                  },
                ]}
              />
            </View>
            {requiredPerMonth != null && targetMonths != null ? (
              <>
                <Row label="Months to target" value={`${targetMonths} mo`} />
                <Row
                  label="Required / month"
                  value={fmtMoney(requiredPerMonth, currency)}
                />
              </>
            ) : (
              <Text
                style={[
                  styles.simHint,
                  { color: colors.mutedForeground, marginTop: 4 },
                ]}
              >
                Enter a target date to compute the required monthly payment.
              </Text>
            )}
          </>
        )}
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
                  {r.label ??
                    (r.scope === "any"
                      ? "Any loan"
                      : isContainerScope(r.scope)
                        ? `${loanContainer?.name ?? "Account"} loans`
                        : "This loan only")}
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
  seg: {
    flexDirection: "row",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 7,
    overflow: "hidden",
  },
  segBtn: { paddingHorizontal: 9, paddingVertical: 3 },
  segText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.3,
  },
  legend: {
    flexDirection: "row",
    gap: 14,
    marginTop: 6,
    justifyContent: "center",
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 10, fontFamily: "Inter_400Regular" },
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
  txRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
  },
  txAmount: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    fontVariant: ["tabular-nums"],
  },
  txDate: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  txUsd: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    fontVariant: ["tabular-nums"],
  },
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingVertical: 4,
  },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  input: {
    minWidth: 110,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    fontVariant: ["tabular-nums"],
    textAlign: "right",
  },
  simHint: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 4 },
  simPriceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 12,
  },
  simPriceLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  simPriceValue: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    fontVariant: ["tabular-nums"],
  },
  simCaption: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.3,
    marginTop: 10,
    marginBottom: 6,
  },
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
