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
import { fmtMoney, fmtPct, fmtQty, groupWithSpaces } from "@/utils/format";
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
  useGetLunoTickers,
  useGetRateHistory,
  useListAccounts,
  useListInterest,
  useListLoanTransactions,
  useListLoans,
  useListLunoTransactions,
} from "@workspace/api-client-react";
import {
  averageBuyRate,
  filterLunoTxsForContainer,
  lunoFundingForAsset,
  matchRepaymentsToBuys,
} from "@/lib/lunoFunding";
import {
  buildCollateralSchedule,
  buildSchedule,
  monthsToSettle,
  monthsToTargetLtv,
  requiredMonthly,
  type CollateralRow,
  type ScheduleRow,
} from "@/lib/loanRepaymentPlan";
import { pairsForAssets, quoteWalletInFiat } from "@/lib/lunoPricing";
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

function fmtMonthLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

// Expandable month-by-month amortisation table for the repayment plan. Collapsed
// by default; tapping the header reveals interest accrued, the payment applied,
// and the remaining balance for each month until the loan is cleared.
function ScheduleBreakdown({
  rows,
  expanded,
  onToggle,
  fmt,
  startDate,
}: {
  rows: ScheduleRow[];
  expanded: boolean;
  onToggle: () => void;
  fmt: (assetAmount: number) => string;
  startDate: Date;
}) {
  const colors = useColors();
  if (rows.length === 0) return null;
  return (
    <View style={{ marginTop: 6 }}>
      <Pressable
        onPress={onToggle}
        style={styles.schedToggle}
        hitSlop={6}
        accessibilityRole="button"
      >
        <Feather
          name={expanded ? "chevron-down" : "chevron-right"}
          size={16}
          color={colors.primary}
        />
        <Text style={[styles.schedToggleText, { color: colors.primary }]}>
          {expanded
            ? "Hide monthly breakdown"
            : `Show monthly breakdown (${rows.length} mo)`}
        </Text>
      </Pressable>
      {expanded ? (
        <View style={{ marginTop: 4 }}>
          <View
            style={[styles.schedHeadRow, { borderBottomColor: colors.border }]}
          >
            <Text
              style={[
                styles.schedHcell,
                styles.schedMonthCol,
                { color: colors.mutedForeground },
              ]}
            >
              Month
            </Text>
            <Text
              style={[
                styles.schedHcell,
                styles.schedNumCol,
                { color: colors.mutedForeground },
              ]}
            >
              Interest
            </Text>
            <Text
              style={[
                styles.schedHcell,
                styles.schedNumCol,
                { color: colors.mutedForeground },
              ]}
            >
              Payment
            </Text>
            <Text
              style={[
                styles.schedHcell,
                styles.schedNumCol,
                { color: colors.mutedForeground },
              ]}
            >
              Balance
            </Text>
          </View>
          {rows.map((r) => (
            <View key={r.month} style={styles.schedRow}>
              <Text
                style={[
                  styles.schedCell,
                  styles.schedMonthCol,
                  { color: colors.foreground },
                ]}
                numberOfLines={1}
              >
                {fmtMonthLabel(addMonths(startDate, r.month))}
              </Text>
              <Text
                style={[
                  styles.schedCell,
                  styles.schedNumCol,
                  { color: colors.mutedForeground },
                ]}
                numberOfLines={1}
              >
                {fmt(r.interest)}
              </Text>
              <Text
                style={[
                  styles.schedCell,
                  styles.schedNumCol,
                  { color: colors.foreground },
                ]}
                numberOfLines={1}
              >
                {fmt(r.payment)}
              </Text>
              <Text
                style={[
                  styles.schedCell,
                  styles.schedNumCol,
                  { color: colors.foreground },
                ]}
                numberOfLines={1}
              >
                {fmt(r.endBalance)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// Expandable month-by-month projection for the "Build collateral" plan: how
// much collateral is added, the running collateral value, and the resulting
// LTV each month until the target is reached.
function CollateralBreakdown({
  rows,
  expanded,
  onToggle,
  fmt,
  startDate,
}: {
  rows: CollateralRow[];
  expanded: boolean;
  onToggle: () => void;
  fmt: (usd: number) => string;
  startDate: Date;
}) {
  const colors = useColors();
  if (rows.length === 0) return null;
  return (
    <View style={{ marginTop: 6 }}>
      <Pressable
        onPress={onToggle}
        style={styles.schedToggle}
        hitSlop={6}
        accessibilityRole="button"
      >
        <Feather
          name={expanded ? "chevron-down" : "chevron-right"}
          size={16}
          color={colors.primary}
        />
        <Text style={[styles.schedToggleText, { color: colors.primary }]}>
          {expanded
            ? "Hide monthly breakdown"
            : `Show monthly breakdown (${rows.length} mo)`}
        </Text>
      </Pressable>
      {expanded ? (
        <View style={{ marginTop: 4 }}>
          <View
            style={[styles.schedHeadRow, { borderBottomColor: colors.border }]}
          >
            <Text
              style={[
                styles.schedHcell,
                styles.schedMonthCol,
                { color: colors.mutedForeground },
              ]}
            >
              Month
            </Text>
            <Text
              style={[
                styles.schedHcell,
                styles.schedNumCol,
                { color: colors.mutedForeground },
              ]}
            >
              +Coll.
            </Text>
            <Text
              style={[
                styles.schedHcell,
                styles.schedNumCol,
                { color: colors.mutedForeground },
              ]}
            >
              Coll. value
            </Text>
            <Text
              style={[
                styles.schedHcell,
                styles.schedNumCol,
                { color: colors.mutedForeground },
              ]}
            >
              LTV
            </Text>
          </View>
          {rows.map((r) => (
            <View key={r.month} style={styles.schedRow}>
              <Text
                style={[
                  styles.schedCell,
                  styles.schedMonthCol,
                  { color: colors.foreground },
                ]}
                numberOfLines={1}
              >
                {fmtMonthLabel(addMonths(startDate, r.month))}
              </Text>
              <Text
                style={[
                  styles.schedCell,
                  styles.schedNumCol,
                  { color: colors.mutedForeground },
                ]}
                numberOfLines={1}
              >
                {fmt(r.collateralAdded)}
              </Text>
              <Text
                style={[
                  styles.schedCell,
                  styles.schedNumCol,
                  { color: colors.foreground },
                ]}
                numberOfLines={1}
              >
                {fmt(r.collateralValue)}
              </Text>
              <Text
                style={[
                  styles.schedCell,
                  styles.schedNumCol,
                  { color: colors.foreground },
                ]}
                numberOfLines={1}
              >
                {r.ltv.toFixed(0)}%
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// Simulate month-by-month payoff: interest compounds on the declining balance,
// the contribution is applied at month end. Returns months-to-settle (capped)
// or null when the contribution never outpaces interest.
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

export function LoanDetailView({
  loanId,
  embedded = false,
}: {
  loanId: string;
  /**
   * When true the view renders as a plain content block (no ScrollView, no
   * navigation header) so it can be embedded inside another scroll container,
   * e.g. the iPad master–detail dashboard pane.
   */
  embedded?: boolean;
}) {
  const colors = useColors();
  const { targetForAccountId, containerForAccountId } = useRiskSettings();
  const router = useRouter();
  const { currency, usdToZar } = useCurrency();
  const id = loanId;
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
  // Scope the Luno pull to the loan's own profile (Personal/Trust) when that
  // container has exactly one Luno link, so the entire fetch budget goes to the
  // relevant account instead of being split across every linked profile. Read
  // from the already-cached loans/risk settings (undefined until they load —
  // react-query refetches once the id resolves).
  const scopedLoan = loansQ.data?.loans.find((l) => l.id === id);
  const scopedLunoLinkIds = scopedLoan
    ? (containerForAccountId(scopedLoan.accountId)?.links ?? [])
        .filter((l) => l.exchange === "luno")
        .map((l) => l.id)
    : [];
  const scopedLunoAccountId =
    scopedLunoLinkIds.length === 1 ? scopedLunoLinkIds[0] : undefined;
  // Luno wallet history, used to surface the real ZAR→asset buys that funded
  // this loan's repayments and the subsequent moves to Binance. We pull a wide
  // window (both asset + ZAR wallets) so buys can be paired into a rate.
  const lunoTxQ = useListLunoTransactions({
    limit: 200,
    ...(scopedLunoAccountId ? { accountId: scopedLunoAccountId } : {}),
  });
  // Live BTC price (display currency) for the "Build collateral" plan, which
  // assumes the borrower keeps buying Bitcoin on Luno and adding it to the
  // collateral. Quoted the same currency-aware way as the dashboard tiles.
  const btcPair = pairsForAssets(["XBT"], currency)[0] ?? "XBTZAR";
  const btcTickersQ = useGetLunoTickers(
    { pairs: btcPair },
    { query: { enabled: !!btcPair } as never },
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
  const [borrowedValueDraft, setBorrowedValueDraft] = useState("");
  const [contribDraft, setContribDraft] = useState("");
  const [targetDraft, setTargetDraft] = useState("");
  const [collateralContribDraft, setCollateralContribDraft] = useState("");
  const [showSchedule, setShowSchedule] = useState(false);
  useEffect(() => {
    setBorrowedValueDraft(
      annotation.borrowedValueZar != null
        ? String(annotation.borrowedValueZar)
        : "",
    );
    setContribDraft(
      annotation.monthlyContribution != null
        ? String(annotation.monthlyContribution)
        : "",
    );
    setTargetDraft(annotation.targetSettleDate ?? "");
    setCollateralContribDraft(
      annotation.monthlyCollateralContribution != null
        ? String(annotation.monthlyCollateralContribution)
        : "",
    );
  }, [
    annotation.borrowedValueZar,
    annotation.monthlyContribution,
    annotation.targetSettleDate,
    annotation.monthlyCollateralContribution,
  ]);

  if (loansQ.isLoading || accountsQ.isLoading) {
    if (embedded) {
      return (
        <View style={styles.embeddedState}>
          <Text style={{ color: colors.mutedForeground }}>Loading loan…</Text>
        </View>
      );
    }
    return (
      <>
        <Stack.Screen options={{ title: "Loan" }} />
        <ScreenSkeleton kind="loanDetail" />
      </>
    );
  }

  if (loansQ.isError || accountsQ.isError) {
    const errBody = (
      <ErrorView
        message={(loansQ.error ?? accountsQ.error)?.message}
        onRetry={() => {
          loansQ.refetch();
          accountsQ.refetch();
        }}
      />
    );
    if (embedded) return <View style={styles.embeddedState}>{errBody}</View>;
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: "Loan" }} />
        {errBody}
      </View>
    );
  }

  const loan = loansQ.data?.loans.find((l) => l.id === id);
  if (!loan) {
    if (embedded) {
      return (
        <View style={styles.embeddedState}>
          <Text style={{ color: colors.mutedForeground }}>Loan not found</Text>
        </View>
      );
    }
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: "Loan" }} />
        <Text style={{ color: colors.mutedForeground }}>Loan not found</Text>
      </View>
    );
  }
  const account = accountsQ.data?.accounts.find((a) => a.id === loan.accountId);
  const loanContainer = containerForAccountId(loan.accountId);
  const targetLtv = targetForAccountId(loan.accountId);
  const status = statusFromLtv(loan.ltv, targetLtv);
  const headroom = headroomToTarget(loan, targetLtv);
  const warnPrice = priceAtLtv(loan, WARNING_LTV);
  const liqPrice = priceAtLtv(loan, LIQ_LTV);
  const warnDrop = priceDropPctTo(loan, WARNING_LTV);
  const liqDrop = priceDropPctTo(loan, LIQ_LTV);
  // Asset-denominated debt drives every projection (not debtUsd, which can be
  // 0 when the server price lookup fails while loan.debt is still valid).
  const planPrincipal = loan.debt;
  const assetToUsd =
    planPrincipal > 0 && loan.debtUsd > 0 ? loan.debtUsd / planPrincipal : 1;
  const borrowedUsd =
    loan.debtUsd > 0 ? loan.debtUsd : planPrincipal * assetToUsd;

  // ── Interest-rate history ──
  // Computed up here (ahead of the hourly/daily interest) so those projections
  // can fall back to the REAL charged rate when Binance's per-loan hourly/APR
  // fields come back 0. The server serves real per-day rates for margin loans
  // (cross + isolated) from Binance's interest history; crypto loans have no
  // such endpoint, so it returns a flat series. We overlay the app's own
  // locally-recorded nominal-APR snapshots so "actual charged" vs "quoted" can
  // be compared, and fall back to the local series entirely when the server is
  // flat. 30d stats stay on a 30-day basis regardless of the chart window.
  const byLoan = interestQ.data?.byLoan.find((b) => b.loanId === loan.id);
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
  const hasRealHistory = chartValues.length >= 2;

  // Binance sometimes returns a 0/absent hourly rate AND a 0 APR for margin
  // loans (the rate ships on a different endpoint that can come back empty).
  // Fall back through every reliable source — quoted APR, quoted hourly rate,
  // then the real 30d-average charged rate from interest history — so the APR
  // headline, the "Hourly rate" / "Hourly interest" rows and the debt-growth
  // projections never collapse to a misleading 0.
  const HOURS_PER_YEAR = 365 * 24;
  const effectiveApr =
    loan.apr > 0
      ? loan.apr
      : loan.hourlyInterestRate > 0
        ? loan.hourlyInterestRate * HOURS_PER_YEAR * 100
        : avg30 > 0
          ? avg30
          : 0;
  const effectiveHourlyRate =
    loan.hourlyInterestRate > 0
      ? loan.hourlyInterestRate
      : effectiveApr > 0
        ? effectiveApr / 100 / HOURS_PER_YEAR
        : 0;
  // `aprDelta` compares the headline rate against the trailing-30d average.
  const aprDelta = avg30 > 0 ? ((effectiveApr - avg30) / avg30) * 100 : 0;
  // Interest amounts: asset units for the plan, USD-converted for the cards.
  const hourlyAsset = loan.debt * effectiveHourlyRate;
  const dailyAsset = hourlyAsset * 24;
  const hourlyUsd = hourlyAsset * assetToUsd;
  const dailyUsd = dailyAsset * assetToUsd;

  // ── Real borrow/repay events for this loan ──
  const loanTxs = txQ.data?.transactions ?? [];
  const repayments = loanTxs.filter((t) => t.type === "repay");

  // ── Luno funding for this loan's borrowed asset ──
  // The borrowed coin is bought on Luno with ZAR, then moved to Binance to
  // repay. Surface those real buys (with their rate) and the moves out.
  const borrowAsset =
    loanTxs.find((t) => t.type === "borrow")?.asset ??
    repayments[0]?.asset ??
    "";
  const scopedLunoTxs = filterLunoTxsForContainer(
    lunoTxQ.data?.transactions ?? [],
    loanContainer,
  );
  const lunoFunding = lunoFundingForAsset(scopedLunoTxs, borrowAsset);
  // Auto-match each repayment to the nearest preceding Luno buy so each row can
  // show the real ZAR cost/rate rather than a live-market FX conversion.
  const repaymentBuys = matchRepaymentsToBuys(
    repayments.map((t) => ({ ts: t.ts, amount: t.amount })),
    lunoFunding.buys,
  );
  // Plan rate is derived only from buys actually matched to THIS loan's
  // repayments (not all Luno history), so unrelated activity can't distort it.
  const matchedBuys = repaymentBuys.filter(
    (b): b is NonNullable<typeof b> => b != null,
  );
  const lunoBuyRate = averageBuyRate(matchedBuys);

  // ── Fixed Luno sell rate ──
  // The user enters the TOTAL ZAR they received for the borrowed asset; dividing
  // by the total quantity borrowed yields a fixed ZAR-per-asset-unit rate. We
  // use this rate (not the live FX rate) to drive the repayment plan, converting
  // between the user's ZAR contributions and the asset-denominated debt.
  const totalBorrowedQty = loanTxs
    .filter((t) => t.type === "borrow")
    .reduce((sum, t) => sum + t.amount, 0);
  const borrowedValueZar = annotation.borrowedValueZar ?? null;
  const fixedSellRate =
    borrowedValueZar != null && borrowedValueZar > 0 && totalBorrowedQty > 0
      ? borrowedValueZar / totalBorrowedQty
      : null;
  // ── Repayment forecasting ──
  // The debt is asset-denominated (≈ USD for stablecoin loans). The monthly rate
  // compounds the declining balance against ongoing accrual. The user budgets in
  // the display currency: in ZAR we convert that budget to asset units at the
  // CURRENT MARKET RATE — what the money actually buys today and going forward —
  // not the historical Luno buy/sell rate, which only reflects past cost. In USD
  // the stablecoin asset maps ~1:1, so no conversion is needed.
  const marketRate = usdToZar; // ZAR per USD (asset ≈ USD via assetToUsd)
  const now = new Date();
  const goalMode: GoalMode = annotation.goalMode ?? "contribution";
  const monthlyRate = effectiveHourlyRate * 24 * 30.44;
  const monthlyInterestAsset = planPrincipal * monthlyRate;
  const fmtPlanMoney = (assetAmount: number): string => {
    const usd = assetAmount * assetToUsd;
    return currency === "ZAR"
      ? `R${groupWithSpaces(usd * marketRate, 2)}`
      : fmtMoney(usd, currency);
  };
  const contributionInput = annotation.monthlyContribution ?? 0;
  // Monthly contribution in asset units, converted from the ZAR budget at the
  // current market rate (USD budgets map ~1:1 to the stablecoin asset).
  const contributionAsset =
    currency === "ZAR"
      ? contributionInput / (marketRate * assetToUsd)
      : contributionInput / assetToUsd;
  const settleMonths = monthsToSettle(
    planPrincipal,
    monthlyRate,
    contributionAsset,
  );
  const payoffDate =
    settleMonths != null && settleMonths > 0
      ? addMonths(now, settleMonths)
      : null;
  // Month-by-month schedule for the expandable breakdown (contribution mode).
  const contributionSchedule =
    settleMonths != null && contributionAsset > 0
      ? buildSchedule(planPrincipal, monthlyRate, contributionAsset, settleMonths)
      : [];
  const targetDate = annotation.targetSettleDate
    ? new Date(annotation.targetSettleDate)
    : null;
  const targetMonths =
    targetDate && !Number.isNaN(targetDate.getTime())
      ? Math.max(1, Math.round(monthsUntil(targetDate, now)))
      : null;
  // Required monthly payment to clear the debt by the target date, in asset units.
  const requiredPerMonthAsset =
    targetMonths != null
      ? requiredMonthly(planPrincipal, monthlyRate, targetMonths)
      : null;
  // Month-by-month schedule for the expandable breakdown (target mode).
  const targetSchedule =
    requiredPerMonthAsset != null && targetMonths != null
      ? buildSchedule(
          planPrincipal,
          monthlyRate,
          requiredPerMonthAsset,
          targetMonths,
        )
      : [];

  // ── "Build collateral" plan ──
  // The borrower keeps buying BTC at today's rate and adds it to collateral
  // instead of repaying. Interest still accrues on the debt, but the growing
  // collateral lowers LTV until the target is reached. Math is done in USD
  // (fmtMoney converts to the display currency); BTC quantity uses the live
  // Luno price in the display currency.
  const btcTickerMap = new Map<string, number>();
  for (const t of btcTickersQ.data?.tickers ?? []) {
    btcTickerMap.set(t.pair, t.lastTrade);
  }
  const btcPriceDisplay = quoteWalletInFiat("XBT", 1, btcTickerMap, currency);
  const btcPriceUsd =
    currency === "ZAR"
      ? usdToZar > 0
        ? btcPriceDisplay / usdToZar
        : 0
      : btcPriceDisplay;
  const collateralContribInput = annotation.monthlyCollateralContribution ?? 0;
  const collateralContribUsd =
    currency === "ZAR"
      ? usdToZar > 0
        ? collateralContribInput / usdToZar
        : 0
      : collateralContribInput;
  const btcPerMonth = btcPriceUsd > 0 ? collateralContribUsd / btcPriceUsd : 0;
  const collateralPlanInput = {
    debt: borrowedUsd,
    collateralValue: loan.collateral.valueUsd,
    monthlyRate,
    monthlyContribution: collateralContribUsd,
    targetLtv,
  };
  const collateralMonths =
    collateralContribUsd > 0 ? monthsToTargetLtv(collateralPlanInput) : null;
  const collateralPayoffDate =
    collateralMonths != null && collateralMonths > 0
      ? addMonths(now, collateralMonths)
      : null;
  const collateralSchedule: CollateralRow[] =
    collateralContribUsd > 0 ? buildCollateralSchedule(collateralPlanInput) : [];

  const relevantRules = rules.filter((r) =>
    ruleAppliesTo(r, loan.id, loanContainer?.id),
  );

  const content = (
    <>
      <View style={styles.head}>
        <Text style={[styles.asset, { color: colors.foreground }]}>
          {loan.collateral.asset}/{loan.asset}
        </Text>
        <Pill status={status} label={statusLabel(status)} />
      </View>

      <View style={{ alignItems: "center", marginVertical: 6 }}>
        <RiskGauge
          ltv={loan.ltv}
          size={220}
          target={targetLtv}
          loan={loan}
          currency={currency}
        />
      </View>

      <Card title="Position">
        <Row
          label="Borrowed"
          value={`${fmtQty(loan.debt, loan.asset)} · ${fmtMoney(borrowedUsd, currency)}`}
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
            {fmtPct(effectiveApr, 2)}
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
        <Row label="Hourly interest" value={fmtMoney(hourlyUsd, currency)} />
        <Row label="Daily interest" value={fmtMoney(dailyUsd, currency)} />
        {loan.apr <= 0 && effectiveApr > 0 ? (
          <Text style={[styles.simHint, { color: colors.mutedForeground }]}>
            Binance didn&apos;t return a live rate for this loan; APR shown is
            the trailing-30d average actually charged.
          </Text>
        ) : null}
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
        <Row label="Today" value={fmtMoney(borrowedUsd, currency)} />
        <Row
          label="In 30 days"
          value={fmtMoney(borrowedUsd + dailyUsd * 30, currency)}
        />
        <Row
          label="In 90 days"
          value={fmtMoney(borrowedUsd + dailyUsd * 90, currency)}
        />
        <Row
          label="In 365 days"
          value={fmtMoney(borrowedUsd + dailyUsd * 365, currency)}
        />
        <Row label="Daily interest" value={fmtMoney(dailyUsd, currency)} />
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

      <Card
        title="Repayments"
        right={
          repayments.length > 0 ? (
            <Text style={[styles.countBadge, { color: colors.mutedForeground }]}>
              {repayments.length}
            </Text>
          ) : null
        }
      >
        {txQ.isLoading ? (
          <Text style={[styles.simHint, { color: colors.mutedForeground }]}>
            Loading repayment history…
          </Text>
        ) : repayments.length === 0 ? (
          <Text style={[styles.empty, { color: colors.mutedForeground }]}>
            No repayments recorded for this loan.
          </Text>
        ) : (
          <>
            <Text
              style={[
                styles.simHint,
                { color: colors.mutedForeground, marginBottom: 10 },
              ]}
            >
              Repayments are from Binance loan history. Amounts shown are what
              Binance recorded for each repay event. When a matching Luno buy is
              found, its buy rate and ZAR spent appear below as funding context
              only — not as the repayment figure.
            </Text>
            <ScrollView
              style={styles.txScroll}
              nestedScrollEnabled
              showsVerticalScrollIndicator
            >
              {repayments.map((t, i) => {
                const buy = repaymentBuys[i];
                return (
                  <View key={`${t.ts}-${i}`} style={styles.txRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.txAmount, { color: colors.ok }]}>
                        +{fmtQty(Math.abs(t.amount), t.asset)}
                      </Text>
                      <Text
                        style={[styles.txDate, { color: colors.mutedForeground }]}
                        numberOfLines={2}
                      >
                        {buy
                          ? `Luno buy R${groupWithSpaces(buy.rate, 2)}/${t.asset} · spent R${groupWithSpaces(buy.zarSpent, 2)} · `
                          : ""}
                        {fmtDate(new Date(t.ts))}
                      </Text>
                    </View>
                    <Text style={[styles.txUsd, { color: colors.foreground }]}>
                      {fmtMoney(t.amountUsd, currency)}
                    </Text>
                  </View>
                );
              })}
            </ScrollView>
          </>
        )}
      </Card>

      <Card
        title="Luno funding"
        right={
          lunoFunding.buys.length + lunoFunding.moves.length > 0 ? (
            <Text style={[styles.countBadge, { color: colors.mutedForeground }]}>
              {lunoFunding.buys.length + lunoFunding.moves.length}
            </Text>
          ) : null
        }
      >
        {lunoTxQ.isLoading ? (
          <Text style={[styles.simHint, { color: colors.mutedForeground }]}>
            Loading Luno activity…
          </Text>
        ) : lunoFunding.buys.length === 0 && lunoFunding.moves.length === 0 ? (
          <Text style={[styles.empty, { color: colors.mutedForeground }]}>
            No Luno buys or transfers found for {borrowAsset || "this asset"}.
          </Text>
        ) : (
          <>
            <Text
              style={[
                styles.simHint,
                { color: colors.mutedForeground, marginBottom: 10 },
              ]}
            >
              The {borrowAsset} used to repay this loan was bought on Luno with
              rand, then transferred out (typically to Binance). Rates shown are
              the real Luno buy rates.
              {loanContainer
                ? ` Showing ${loanContainer.name} activity only.`
                : ""}{" "}
              Reflects recent Luno activity, so older entries may not appear.
            </Text>

            <ScrollView
              style={styles.txScroll}
              nestedScrollEnabled
              showsVerticalScrollIndicator
            >
              {lunoFunding.buys.length > 0 && (
                <>
                  <Text
                    style={[styles.fundingHeading, { color: colors.foreground }]}
                  >
                    Bought on Luno ({lunoFunding.buys.length})
                  </Text>
                  {lunoFunding.buys.map((b, i) => (
                    <View key={`buy-${b.ts}-${i}`} style={styles.txRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.txAmount, { color: colors.ok }]}>
                          +{fmtQty(b.assetQty, borrowAsset)}
                        </Text>
                        <Text
                          style={[
                            styles.txDate,
                            { color: colors.mutedForeground },
                          ]}
                        >
                          R{groupWithSpaces(b.rate, 2)}/{borrowAsset} ·{" "}
                          {b.accountName} · {fmtDate(new Date(b.ts))}
                        </Text>
                      </View>
                      <Text style={[styles.txUsd, { color: colors.foreground }]}>
                        R{groupWithSpaces(b.zarSpent, 2)}
                      </Text>
                    </View>
                  ))}
                </>
              )}

              {lunoFunding.moves.length > 0 && (
                <>
                  <Text
                    style={[
                      styles.fundingHeading,
                      { color: colors.foreground, marginTop: 12 },
                    ]}
                  >
                    Transferred out ({lunoFunding.moves.length})
                  </Text>
                  {lunoFunding.moves.map((m, i) => (
                    <View key={`move-${m.ts}-${i}`} style={styles.txRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.txAmount, { color: colors.warn }]}>
                          −{fmtQty(m.assetQty, borrowAsset)}
                        </Text>
                        <Text
                          style={[
                            styles.txDate,
                            { color: colors.mutedForeground },
                          ]}
                          numberOfLines={1}
                        >
                          {m.description ? `${m.description} · ` : ""}
                          {m.accountName} · {fmtDate(new Date(m.ts))}
                        </Text>
                      </View>
                    </View>
                  ))}
                </>
              )}
            </ScrollView>
          </>
        )}
      </Card>

      <Card title="Repayment plan">
        <View style={styles.fieldRow}>
          <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
            Borrowed asset value (ZAR)
          </Text>
          <TextInput
            value={borrowedValueDraft}
            onChangeText={setBorrowedValueDraft}
            onEndEditing={() => {
              const n = Number(borrowedValueDraft);
              void setLoanAnnotation(loan.id, {
                borrowedValueZar:
                  borrowedValueDraft.trim() === "" || !Number.isFinite(n)
                    ? null
                    : n,
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
        {currency === "ZAR" ? (
          <>
            <Row
              label="Market rate (now)"
              value={`R${groupWithSpaces(marketRate, 2)} / ${loan.asset}`}
            />
            {lunoBuyRate != null ? (
              <Row
                label="Avg Luno buy rate"
                value={`R${groupWithSpaces(lunoBuyRate, 2)} / ${loan.asset}`}
              />
            ) : null}
            {fixedSellRate != null ? (
              <Row
                label="Sell rate when borrowed"
                value={`R${groupWithSpaces(fixedSellRate, 2)} / ${loan.asset}`}
              />
            ) : null}
            <Text
              style={[
                styles.simHint,
                { color: colors.mutedForeground, marginTop: 4 },
              ]}
            >
              Projections convert your monthly Rand budget to {loan.asset} at the
              current market rate.
            </Text>
          </>
        ) : null}

        <View style={[styles.seg, { borderColor: colors.border, marginTop: 4 }]}>
          {(
            [
              ["contribution", "Monthly → date"],
              ["target", "Date → monthly"],
              ["collateral", "Build collateral"],
            ] as const
          ).map(([mode, label]) => {
            const on = goalMode === mode;
            return (
              <Pressable
                key={mode}
                onPress={() => {
                  setShowSchedule(false);
                  void setLoanAnnotation(loan.id, { goalMode: mode });
                }}
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
              value={fmtPlanMoney(monthlyInterestAsset)}
            />
            {contributionInput > 0 ? (
              settleMonths != null && payoffDate ? (
                <>
                  <Row label="Settles in" value={`${settleMonths} mo`} />
                  <Row label="Projected payoff" value={fmtDate(payoffDate)} />
                  <ScheduleBreakdown
                    rows={contributionSchedule}
                    expanded={showSchedule}
                    onToggle={() => setShowSchedule((v) => !v)}
                    fmt={fmtPlanMoney}
                    startDate={now}
                  />
                </>
              ) : (
                <Text
                  style={[styles.simHint, { color: colors.warn, marginTop: 4 }]}
                >
                  Contribution must exceed monthly interest (
                  {fmtPlanMoney(monthlyInterestAsset)}) to ever settle.
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
        ) : goalMode === "target" ? (
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
            {requiredPerMonthAsset != null && targetMonths != null ? (
              <>
                <Row label="Months to target" value={`${targetMonths} mo`} />
                <Row
                  label="Required / month"
                  value={fmtPlanMoney(requiredPerMonthAsset)}
                />
                <ScheduleBreakdown
                  rows={targetSchedule}
                  expanded={showSchedule}
                  onToggle={() => setShowSchedule((v) => !v)}
                  fmt={fmtPlanMoney}
                  startDate={now}
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
        ) : (
          <>
            <View style={styles.fieldRow}>
              <Text
                style={[styles.fieldLabel, { color: colors.mutedForeground }]}
              >
                Monthly contribution ({currency})
              </Text>
              <TextInput
                value={collateralContribDraft}
                onChangeText={setCollateralContribDraft}
                onEndEditing={() => {
                  const n = Number(collateralContribDraft);
                  void setLoanAnnotation(loan.id, {
                    monthlyCollateralContribution:
                      collateralContribDraft.trim() === "" ||
                      !Number.isFinite(n)
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
            <Text
              style={[
                styles.simHint,
                { color: colors.mutedForeground, marginBottom: 4 },
              ]}
            >
              Keep your debt and instead buy BTC each month at today&apos;s Luno
              rate, adding it to collateral. Interest still accrues, but the
              growing collateral lowers your LTV.
            </Text>
            <Row
              label="BTC price now"
              value={btcPriceUsd > 0 ? fmtMoney(btcPriceUsd, currency) : "—"}
            />
            <Row
              label="Monthly interest"
              value={fmtPlanMoney(monthlyInterestAsset)}
            />
            {collateralContribInput > 0 ? (
              btcPriceUsd <= 0 ? (
                <Text
                  style={[
                    styles.simHint,
                    { color: colors.mutedForeground, marginTop: 4 },
                  ]}
                >
                  Waiting for a live BTC price to project collateral growth.
                </Text>
              ) : collateralMonths != null && collateralPayoffDate ? (
                <>
                  <Row
                    label="BTC added / month"
                    value={`${btcPerMonth.toFixed(6)} BTC`}
                  />
                  <Row
                    label={`Reach ${targetLtv}% LTV in`}
                    value={`${collateralMonths} mo`}
                  />
                  <Row
                    label="Projected date"
                    value={fmtDate(collateralPayoffDate)}
                  />
                  <CollateralBreakdown
                    rows={collateralSchedule}
                    expanded={showSchedule}
                    onToggle={() => setShowSchedule((v) => !v)}
                    fmt={(usd) => fmtMoney(usd, currency)}
                    startDate={now}
                  />
                </>
              ) : (
                <>
                  <Row
                    label="BTC added / month"
                    value={`${btcPerMonth.toFixed(6)} BTC`}
                  />
                  <Text
                    style={[
                      styles.simHint,
                      { color: colors.warn, marginTop: 4 },
                    ]}
                  >
                    At this contribution the collateral does not grow fast
                    enough to reach {targetLtv}% LTV within 50 years — interest
                    outpaces it.
                  </Text>
                </>
              )
            ) : (
              <Text
                style={[
                  styles.simHint,
                  { color: colors.mutedForeground, marginTop: 4 },
                ]}
              >
                Enter a monthly contribution to project how fast buying BTC into
                collateral lowers your LTV.
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
    </>
  );

  if (embedded) {
    return <View style={styles.embedded}>{content}</View>;
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.wrap}
    >
      <Stack.Screen
        options={{ title: `${loan.collateral.asset} · ${account?.name ?? ""}` }}
      />
      <Container style={{ gap: 14 }}>{content}</Container>
    </ScrollView>
  );
}

export default function LoanDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <LoanDetailView loanId={id ?? ""} />;
}

const styles = StyleSheet.create({
  wrap: { padding: 16, gap: 14, paddingBottom: 40 },
  embedded: { gap: 14 },
  embeddedState: { paddingVertical: 24, alignItems: "center" },
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
  txScroll: { maxHeight: 320 },
  countBadge: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    fontVariant: ["tabular-nums"],
  },
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
  schedToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
  },
  schedToggleText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  schedHeadRow: {
    flexDirection: "row",
    paddingBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  schedHcell: { fontSize: 11, fontFamily: "Inter_500Medium" },
  schedRow: { flexDirection: "row", paddingVertical: 3 },
  schedCell: { fontSize: 12, fontFamily: "Inter_400Regular" },
  schedMonthCol: { flex: 1.1 },
  schedNumCol: { flex: 1.3, textAlign: "right" },
  fundingHeading: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
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
