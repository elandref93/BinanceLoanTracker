import {
  getCredentials,
  getListLoanTransactionsQueryKey,
  getListLunoTransactionsQueryKey,
  listLoanTransactions,
  listLunoTransactions,
  type LoanHistoryPoint,
  type LoanPosition,
  type PerformanceRange,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { accountSyncQueryKey, loadAccountSync } from "@/accounts/accountApi";
import { errorStatus, type SyncContainer } from "@/accounts/accountModel";
import { LtvChart } from "@/charts/LtvChart";
import { parseDecimalInput } from "@/domain/decimalInput";
import { fmtDateTime, fmtDayMonth, fmtNum, fmtPct, fmtQty, fmtSignedPct, fmtUsd, MINUS } from "@/domain/format";
import { annotationFor, annotationsEqual, draftsFromAnnotation, type AnnotationDrafts, type LoanAnnotation } from "@/domain/loanAnnotations";
import {
  buildLoanDetail,
  COLLATERAL_PLAN_UNAVAILABLE,
  payoffProjection,
  sumBorrowedQuantity,
  type FundingRow,
  type LoanEvent,
  type SectionGate,
} from "@/domain/loanDetail";
import { LIQ_LTV, WARNING_LTV, riskBand, riskBandLabel } from "@/domain/risk";
import { loadAnnotationMap, loanAnnotationsKey, saveLoanAnnotation } from "@/loans/loanApi";
import { dropToPct, loanTarget, ltvSeries, seriesSummary, stressedLtv, toTarget, USD_STABLES } from "@/loans/loanModel";
import { LtvGauge } from "@/loans/LtvGauge";
import { Balance } from "@/prefs/DiscreetMode";
import { usePrefs } from "@/prefs/PreferencesProvider";
import { AssetIcon, displaySymbol } from "@/ui/AssetIcon";
import { BAND_SHAPES, Button, Card, cx, Notice, PageHeader, riskTextClass, SectionHeader, Segmented, SourceTag } from "@/ui/primitives";

export const LOAN_RANGES: ReadonlyArray<{ value: PerformanceRange; label: string }> = [
  { value: "1W", label: "1W" },
  { value: "1M", label: "1M" },
  { value: "3M", label: "3M" },
  { value: "1Y", label: "1Y" },
];

export function loanTransitionName(loanId: string): string {
  return `loan-${loanId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

export function loanTitle(loan: Pick<LoanPosition, "asset">): string {
  return `${displaySymbol(loan.asset)} loan`;
}

/** Collateral icon with the borrowed asset as a small badge. */
export function LoanIcon(props: { loan: Pick<LoanPosition, "asset" | "collateralAsset">; size?: number; transitionName?: string }) {
  const size = props.size ?? 36;
  const badge = Math.round(size * 0.5);
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size, viewTransitionName: props.transitionName }}>
      <AssetIcon asset={props.loan.collateralAsset} size={size} />
      <span className="absolute -bottom-0.5 -right-1 rounded-full ring-2 ring-card">
        <AssetIcon asset={props.loan.asset} size={badge} />
      </span>
    </span>
  );
}

/** Display-currency amount with the native USD amount underneath for stablecoin debt shown in rand. */
export function DebtAmount(props: { loan: Pick<LoanPosition, "asset" | "debtUsd" | "debtQty">; className?: string; compact?: boolean }) {
  const prefs = usePrefs();
  const native = USD_STABLES.has(displaySymbol(props.loan.asset)) && prefs.currency === "ZAR";
  return (
    <span className={cx("block text-right", props.className)}>
      <span className="block font-semibold tabular">{prefs.money(props.loan.debtUsd, { whole: true, compact: props.compact })}</span>
      {native ? (
        <span className="block text-micro text-muted-foreground tabular">
          <Balance text={fmtUsd(props.loan.debtQty, { whole: true })} />
        </span>
      ) : null}
    </span>
  );
}

export function LoanDetail(props: {
  loan: LoanPosition;
  history: LoanHistoryPoint[];
  range: PerformanceRange;
  onRange: (range: PerformanceRange) => void;
  showBack?: boolean;
  backTo?: string;
}) {
  const { loan } = props;
  const prefs = usePrefs();
  const target = loanTarget(loan);
  const band = riskBand(loan.ltv, target);
  const subtitle = [`${displaySymbol(loan.collateralAsset)} collateral`, loan.profileName ?? "Not in a profile", loan.linkName].join(" · ");

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={loanTitle(loan)}
        subtitle={subtitle}
        back={props.showBack ? { to: props.backTo ?? "/loans", label: "Loans" } : undefined}
        leading={<LoanIcon loan={loan} size={44} transitionName={props.showBack ? loanTransitionName(loan.loanId) : undefined} />}
        actions={
          <span className={cx("hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-semibold sm:inline-flex", riskTextClass(band), "bg-card-elevated")}>
            <span aria-hidden="true" className="text-[0.7em]">
              {BAND_SHAPES[band]}
            </span>
            {riskBandLabel(band)}
          </span>
        }
      />
      <div className="@container">
        <div className="grid gap-4 @[680px]:grid-cols-2">
          <RiskCard loan={loan} />
          <HistoryCard loan={loan} history={props.history} range={props.range} onRange={props.onRange} />
          <TriggersCard loan={loan} />
          <StressCard loan={loan} />
          <InterestCard loan={loan} />
          <LoanActivity loan={loan} currency={prefs.currency} fx={prefs.fx} />
        </div>
      </div>
    </div>
  );
}

function Rows(props: { rows: Array<{ label: ReactNode; value: ReactNode; hint?: ReactNode }> }) {
  return (
    <dl className="divide-y divide-border">
      {props.rows.map((row, index) => (
        <div key={index} className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
          <dt className="text-caption text-muted-foreground">{row.label}</dt>
          <dd className="text-right text-body tabular">
            {row.value}
            {row.hint ? <span className="block text-micro text-muted-foreground">{row.hint}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function RiskCard(props: { loan: LoanPosition }) {
  const { loan } = props;
  const prefs = usePrefs();
  const target = loanTarget(loan);
  const gap = toTarget(loan);
  const collateral = displaySymbol(loan.collateralAsset);
  const change = loan.ltvChange7d;
  return (
    <Card className="animate-rise-in @[680px]:row-span-2" aria-label="Risk">
      <SectionHeader title="Risk" caption={loan.profileName ? `${loan.profileName} target ${fmtPct(target, 0)}` : `Default target ${fmtPct(target, 0)}`} />
      <LtvGauge ltv={loan.ltv} target={target} caption={change != null ? `${change > 0 ? "+" : change < 0 ? MINUS : ""}${fmtNum(Math.abs(change), 1)} points over 7 days` : undefined} />
      <div className="mt-5">
        <Rows
          rows={[
            { label: "Borrowed", value: <DebtAmount loan={loan} />, hint: <Balance text={fmtQty(loan.debtQty, displaySymbol(loan.asset))} /> },
            { label: "Collateral", value: prefs.money(loan.collateralUsd, { whole: true }), hint: <Balance text={fmtQty(loan.collateralQty, collateral)} /> },
            gap.addCollateralUsd > 0
              ? {
                  label: `Back to ${fmtPct(target, 0)}`,
                  value: <span className="text-warn">Add {prefs.money(gap.addCollateralUsd, { whole: true })}</span>,
                  hint: <>or repay {prefs.money(gap.repayUsd, { whole: true })}</>,
                }
              : {
                  label: `Headroom to ${fmtPct(target, 0)}`,
                  value: prefs.money(gap.spareCollateralUsd, { whole: true }),
                  hint: "collateral that could come out",
                },
          ]}
        />
      </div>
    </Card>
  );
}

function HistoryCard(props: { loan: LoanPosition; history: LoanHistoryPoint[]; range: PerformanceRange; onRange: (range: PerformanceRange) => void }) {
  const target = loanTarget(props.loan);
  const points = useMemo(() => ltvSeries(props.history, { kind: "loan", id: props.loan.loanId }), [props.history, props.loan.loanId]);
  const summary = seriesSummary(points);
  const [scrub, setScrub] = useState<number | null>(null);
  const shown = scrub != null ? points[scrub] : points[points.length - 1];
  const shownBand = shown ? riskBand(shown.v, target) : null;
  const label = summary
    ? `LTV history for this loan from ${fmtPct(summary.start)} to ${fmtPct(summary.end)}, low ${fmtPct(summary.low)}, high ${fmtPct(summary.high)}. Target ${fmtPct(target, 0)}, margin call ${fmtPct(WARNING_LTV, 0)}, liquidation ${fmtPct(LIQ_LTV, 0)}.`
    : "No LTV history yet";
  return (
    <Card className="animate-rise-in [animation-delay:40ms]" aria-label="LTV history">
      <SectionHeader
        title="LTV history"
        action={<Segmented label="History range" size="sm" options={LOAN_RANGES} value={props.range} onChange={props.onRange} className="w-48" />}
      />
      {points.length >= 2 && shown ? (
        <>
          <p className="flex items-baseline gap-2 text-caption text-muted-foreground tabular" aria-live="polite">
            <span className={cx("text-heading font-semibold", shownBand ? riskTextClass(shownBand) : "")}>{fmtPct(shown.v)}</span>
            {scrub != null ? fmtDateTime(shown.t) : summary ? <>High {fmtPct(summary.high)} · Low {fmtPct(summary.low)}</> : null}
          </p>
          <LtvChart key={props.range} points={points} target={target} label={label} onScrub={setScrub} className="mt-3 h-44" />
          <div className="mt-1.5 flex justify-between text-micro text-subtle tabular">
            <span>{fmtDayMonth(points[0]?.t ?? 0)}</span>
            <span>{fmtDayMonth(points[points.length - 1]?.t ?? 0)}</span>
          </div>
        </>
      ) : (
        <p className="py-6 text-center text-caption text-muted-foreground">
          This loan's history builds up from the 15-minute snapshots. Check back after a few have been recorded.
        </p>
      )}
    </Card>
  );
}

function TriggersCard(props: { loan: LoanPosition }) {
  const { loan } = props;
  const prefs = usePrefs();
  const collateral = displaySymbol(loan.collateralAsset);
  const target = loanTarget(loan);
  const rows = [
    { key: "target", label: `Target ${fmtPct(target, 0)}`, price: loan.priceAtTargetUsd, band: "above" as const },
    { key: "margin", label: `Margin call ${fmtPct(loan.marginCallLtv, 0)}`, price: loan.priceAtMarginCallUsd, band: "margin" as const },
    { key: "liq", label: `Liquidation ${fmtPct(loan.liqLtv, 0)}`, price: loan.priceAtLiquidationUsd, band: "liquidation" as const },
  ];
  return (
    <Card className="animate-rise-in [animation-delay:80ms]" aria-label="Price triggers">
      <SectionHeader
        title="Price triggers"
        caption={loan.collateralPriceUsd != null ? <>{collateral} now {prefs.money(loan.collateralPriceUsd)}</> : `${collateral} price unavailable`}
      />
      <ul className="divide-y divide-border">
        {rows.map((row) => {
          const drop = dropToPct(loan.collateralPriceUsd, row.price);
          return (
            <li key={row.key} className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
              <span className="min-w-0">
                <span className={cx("flex items-center gap-1.5 text-body font-medium", riskTextClass(row.band))}>
                  <span aria-hidden="true" className="text-[0.7em]">
                    {BAND_SHAPES[row.band]}
                  </span>
                  {row.label}
                </span>
                <span className="mt-0.5 block text-caption text-muted-foreground tabular">
                  {drop == null ? "Not available" : drop > 0 ? `${collateral} can fall ${fmtPct(drop)}` : `Already past this level`}
                </span>
              </span>
              <span className="shrink-0 text-right text-body font-semibold tabular">{row.price != null ? prefs.money(row.price) : "—"}</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-micro text-muted-foreground">Prices hold the debt at today's value. Interest slowly raises them.</p>
    </Card>
  );
}

const STRESS_PRESETS = [-10, -20, -30, -50];

function StressCard(props: { loan: LoanPosition }) {
  const { loan } = props;
  const prefs = usePrefs();
  const [move, setMove] = useState(0);
  const collateral = displaySymbol(loan.collateralAsset);
  const target = loanTarget(loan);
  const ltv = stressedLtv(loan.ltv, move);
  const band = riskBand(ltv, target);
  const marginAt = dropToPct(loan.collateralPriceUsd, loan.priceAtMarginCallUsd);
  const price = loan.collateralPriceUsd != null ? loan.collateralPriceUsd * (1 + move / 100) : null;
  const headline = move === 0 ? `At today's ${collateral} price` : `If ${collateral} ${move < 0 ? "falls" : "rises"} ${fmtPct(Math.abs(move), 0)}`;
  return (
    <Card className="animate-rise-in [animation-delay:120ms]" aria-label="Stress test">
      <SectionHeader title="Stress test" caption={marginAt != null && marginAt > 0 ? `Margin call if ${collateral} falls ${fmtPct(marginAt)}` : undefined} />
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-caption text-muted-foreground">{headline}</p>
          <p className={cx("mt-1 text-[26px] font-semibold leading-8 tracking-tight tabular transition-colors", riskTextClass(band))}>
            {Number.isFinite(ltv) ? fmtPct(ltv) : "—"}
          </p>
          <p className={cx("flex items-center gap-1.5 text-caption font-semibold", riskTextClass(band))}>
            <span aria-hidden="true" className="text-[0.7em]">
              {BAND_SHAPES[band]}
            </span>
            {riskBandLabel(band)}
          </p>
        </div>
        <p className="shrink-0 text-right text-caption text-muted-foreground tabular">
          {collateral} {price != null ? prefs.money(price) : "—"}
          <span className="block">Collateral {prefs.money(loan.collateralUsd * (1 + move / 100), { whole: true })}</span>
        </p>
      </div>
      <label className="mt-4 block">
        <span className="sr-only">{collateral} price change, percent</span>
        <input
          type="range"
          min={-70}
          max={50}
          step={1}
          value={move}
          onChange={(event) => setMove(Number(event.target.value))}
          aria-valuetext={`${fmtSignedPct(move, 0)}, LTV ${fmtPct(ltv)}, ${riskBandLabel(band)}`}
          className="ledger-range w-full"
          data-no-pull
        />
      </label>
      <div className="mt-1 flex justify-between text-micro text-subtle tabular">
        <span>{MINUS}70%</span>
        <span>0</span>
        <span>+50%</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {STRESS_PRESETS.map((preset) => (
          <Button key={preset} size="sm" variant={move === preset ? "primary" : "secondary"} onClick={() => setMove(preset)}>
            {fmtSignedPct(preset, 0)}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setMove(0)} disabled={move === 0}>
          Reset
        </Button>
      </div>
    </Card>
  );
}

function InterestCard(props: { loan: LoanPosition }) {
  const { loan } = props;
  const prefs = usePrefs();
  const daily = loan.dailyInterestUsd;
  return (
    <Card className="animate-rise-in [animation-delay:160ms]" aria-label="Interest">
      <SectionHeader title="Interest" caption={`${fmtPct(loan.apr, 2)} a year at the current rate`} />
      <dl className="grid grid-cols-3 gap-3">
        {[
          { label: "Day", usd: daily },
          { label: "Month", usd: daily * 30 },
          { label: "Year", usd: daily * 365 },
        ].map((item) => (
          <div key={item.label} className="rounded-xl bg-card-elevated px-3 py-2.5">
            <dt className="text-micro font-medium uppercase tracking-wider text-muted-foreground">{item.label}</dt>
            <dd className="mt-1 truncate text-body font-semibold tabular">{prefs.money(item.usd, { whole: item.usd >= 100 })}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4">
        <p className="mb-2 text-caption font-medium text-muted-foreground">If nothing is repaid</p>
        <Rows
          rows={[30, 90, 365].map((days) => ({
            label: `In ${days} days`,
            value: prefs.money(loan.debtUsd + daily * days, { whole: true }),
          }))}
        />
      </div>
    </Card>
  );
}

type CredentialGate = { kind: "ready"; binance: boolean; luno: boolean } | { kind: "storage" };

async function loadCredentialGate(): Promise<CredentialGate> {
  try {
    const meta = await getCredentials();
    return {
      kind: "ready",
      binance: meta.accounts.some((account) => account.exchange === "binance"),
      luno: meta.accounts.some((account) => account.exchange === "luno"),
    };
  } catch (error) {
    if (errorStatus(error) === 503) return { kind: "storage" };
    throw error;
  }
}

function gateForRepayments(input: {
  credentialsPending: boolean;
  credentialsError: boolean;
  credentials: CredentialGate | undefined;
  transactionsPending: boolean;
  transactionsError: boolean;
}): SectionGate {
  if (input.credentialsPending) return { status: "pending" };
  if (input.credentialsError || !input.credentials) return { status: "error" };
  if (input.credentials.kind === "storage") return { status: "blocked", reason: "storage" };
  if (!input.credentials.binance) return { status: "blocked", reason: "no-key" };
  if (input.transactionsPending) return { status: "pending" };
  if (input.transactionsError) return { status: "error" };
  return { status: "ready" };
}

function gateForLuno(input: {
  accountsPending: boolean;
  accountsError: boolean;
  container: SyncContainer | null;
  credentialsPending: boolean;
  credentialsError: boolean;
  credentials: CredentialGate | undefined;
  transactionsPending: boolean;
  transactionsError: boolean;
}): SectionGate {
  if (input.accountsPending || input.credentialsPending) return { status: "pending" };
  if (input.accountsError || input.credentialsError || !input.credentials) return { status: "error" };
  if (input.credentials.kind === "storage") return { status: "blocked", reason: "storage" };
  if (!input.container) return { status: "blocked", reason: "no-profile" };
  if (!input.container.links.some((link) => link.exchange === "luno")) return { status: "blocked", reason: "no-link" };
  if (!input.credentials.luno) return { status: "blocked", reason: "no-key" };
  if (input.transactionsPending) return { status: "pending" };
  if (input.transactionsError) return { status: "error" };
  return { status: "ready" };
}

/** Repayments, Luno funding and repayment notes: the parts that need extra server calls. */
function LoanActivity(props: { loan: LoanPosition; currency: "USD" | "ZAR"; fx: number | null }) {
  const { loan } = props;
  const accounts = useQuery({ queryKey: accountSyncQueryKey, queryFn: loadAccountSync });
  const credentials = useQuery({ queryKey: ["credential-gate"], queryFn: loadCredentialGate });
  const annotations = useQuery({ queryKey: loanAnnotationsKey, queryFn: loadAnnotationMap });
  const container = accounts.data?.find((item) => item.id === loan.containerId) ?? null;
  const lunoLinks = container?.links.filter((link) => link.exchange === "luno") ?? [];
  const binanceLinked = credentials.data?.kind === "ready" && credentials.data.binance;
  const lunoLinked = credentials.data?.kind === "ready" && credentials.data.luno && lunoLinks.length > 0;
  const transactionParams = { loanId: loan.loanId };
  const lunoParams = { limit: 200, ...(lunoLinks.length === 1 && lunoLinks[0] ? { accountId: lunoLinks[0].id } : {}) };
  const transactions = useQuery({
    queryKey: getListLoanTransactionsQueryKey(transactionParams),
    queryFn: () => listLoanTransactions(transactionParams),
    enabled: binanceLinked,
  });
  const lunoTransactions = useQuery({
    queryKey: getListLunoTransactionsQueryKey(lunoParams),
    queryFn: () => listLunoTransactions(lunoParams),
    enabled: lunoLinked,
  });

  const events: LoanEvent[] =
    transactions.data?.transactions.flatMap((event) => {
      if ((event.type !== "borrow" && event.type !== "repay") || !Number.isFinite(event.amount)) return [];
      return [{ type: event.type, ts: event.ts, asset: event.asset, amount: event.amount, amountUsd: Number.isFinite(event.amountUsd) ? event.amountUsd : null }];
    }) ?? [];

  const detail = buildLoanDetail({
    loanId: loan.loanId,
    currency: props.currency,
    targetLtv: loanTarget(loan),
    fx: props.fx,
    asOf: null,
    snapshotStatus: "missing",
    loansIncluded: false,
    snapshotLoan: null,
    liveStatus: "ready",
    liveLoan: {
      accountId: loan.linkId,
      asset: loan.asset,
      collateralAsset: loan.collateralAsset,
      debtQty: loan.debtQty,
      debtUsd: loan.debtUsd,
      collateralQty: loan.collateralQty,
      collateralValueUsd: loan.collateralUsd,
      ltv: loan.ltv,
      apr: loan.apr,
      hourlyInterestRate: loan.hourlyRate > 0 ? loan.hourlyRate : null,
    },
    accountLabel: loan.profileName,
    repayments: gateForRepayments({
      credentialsPending: credentials.isPending,
      credentialsError: credentials.isError,
      credentials: credentials.data,
      transactionsPending: transactions.isPending,
      transactionsError: transactions.isError,
    }),
    events,
    luno: gateForLuno({
      accountsPending: accounts.isPending,
      accountsError: accounts.isError,
      container,
      credentialsPending: credentials.isPending,
      credentialsError: credentials.isError,
      credentials: credentials.data,
      transactionsPending: lunoTransactions.isPending,
      transactionsError: lunoTransactions.isError,
    }),
    lunoTransactions: lunoTransactions.data?.transactions ?? [],
    container,
    containerName: container?.name ?? null,
  });
  if (detail.kind !== "loan") return null;
  const view = detail.view;
  const stored = annotationFor(annotations.data ?? {}, loan.loanId);
  const quantities = {
    totalBorrowedQty: transactions.isSuccess ? sumBorrowedQuantity(events) : null,
    planPrincipal: view.debtQty,
  };

  return (
    <>
      <Card className="animate-rise-in [animation-delay:200ms]" aria-label="Repayments">
        <SectionHeader title="Repayments" />
        {view.repaymentsNote ? <p className="text-caption text-muted-foreground">{view.repaymentsNote}</p> : null}
        {view.repayments && view.repayments.length > 0 ? (
          <ul className="divide-y divide-border">
            {view.repayments.map((row) => (
              <li key={`${row.when}-${row.amount}`} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className="min-w-0">
                  <span className="block text-body font-medium text-gain tabular">
                    <Balance text={row.amount} />
                  </span>
                  <span className="mt-0.5 block text-caption text-muted-foreground">
                    {row.funding ? (
                      <>
                        <Balance text={row.funding} /> ·{" "}
                      </>
                    ) : null}
                    {row.when}
                  </span>
                </span>
                {row.value ? (
                  <span className="shrink-0 text-body tabular">
                    <Balance text={row.value} />
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
      <Card className="animate-rise-in [animation-delay:240ms]" aria-label="Luno funding">
        <SectionHeader title="Luno funding" caption={view.lunoScope ?? undefined} />
        {view.lunoNote ? <p className="text-caption text-muted-foreground">{view.lunoNote}</p> : null}
        {view.lunoBuys && view.lunoBuys.length > 0 ? <FundingList title="Bought on Luno" rows={view.lunoBuys} /> : null}
        {view.lunoMoves && view.lunoMoves.length > 0 ? <FundingList title="Transferred out" rows={view.lunoMoves} /> : null}
      </Card>
      {annotations.isPending ? null : annotations.isError ? (
        <Notice tone="warn" title="Repayment notes could not be loaded" />
      ) : (
        <NotesForm
          loanId={loan.loanId}
          stored={stored}
          quantities={quantities}
          debtQty={view.debtQty}
          debtUsd={view.debtUsd}
          hourlyRate={view.rateDecimal}
          currency={props.currency}
          fx={props.fx}
        />
      )}
    </>
  );
}

function FundingList(props: { title: string; rows: FundingRow[] }) {
  return (
    <div className="mt-3 first:mt-0">
      <h3 className="text-caption font-semibold text-muted-foreground">{props.title}</h3>
      <ul className="mt-1 divide-y divide-border">
        {props.rows.map((row) => (
          <li key={`${row.detail}-${row.amount}`} className="flex items-start justify-between gap-3 py-2.5">
            <span className="min-w-0">
              <span className="block text-body font-medium tabular">
                <Balance text={row.amount} />
              </span>
              <span className="mt-0.5 block text-caption text-muted-foreground">
                <Balance text={row.detail} />
              </span>
            </span>
            {row.value ? (
              <span className="shrink-0 text-body tabular">
                <Balance text={row.value} />
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function numberOrNull(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  return parseDecimalInput(trimmed);
}

const INPUT =
  "mt-1 min-h-11 w-full rounded-xl border border-border bg-background px-3.5 text-body text-foreground placeholder:text-subtle focus:border-primary/50 focus:outline-none";

function Field(props: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-caption text-muted-foreground">{props.label}</span>
      <input value={props.value} inputMode="decimal" onChange={(event) => props.onChange(event.target.value)} className={INPUT} />
    </label>
  );
}

function NotesForm(props: {
  loanId: string;
  stored: LoanAnnotation;
  quantities: { totalBorrowedQty: number | null; planPrincipal: number | null };
  debtQty: number | null;
  debtUsd: number;
  hourlyRate: number | null;
  currency: "USD" | "ZAR";
  fx: number | null;
}) {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<AnnotationDrafts>(() => draftsFromAnnotation(props.stored));
  const draftsRef = useRef(drafts);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const storedKey = JSON.stringify(props.stored);

  useEffect(() => {
    const next = draftsFromAnnotation(props.stored);
    draftsRef.current = next;
    setDrafts(next);
  }, [props.loanId, storedKey]);

  function edit(field: keyof AnnotationDrafts, value: string): void {
    const next = { ...draftsRef.current, [field]: value };
    draftsRef.current = next;
    setDrafts(next);
  }

  async function persist(): Promise<void> {
    const next = draftsRef.current;
    if (annotationsEqual(props.stored, next, props.quantities)) return;
    setSaving(true);
    setMessage(null);
    const result = await saveLoanAnnotation(props.loanId, next, props.quantities);
    if (result.ok) {
      await queryClient.invalidateQueries({ queryKey: loanAnnotationsKey });
      setMessage("Saved.");
    } else if (result.conflict) {
      await queryClient.invalidateQueries({ queryKey: loanAnnotationsKey });
      setMessage("A newer copy was saved from another device. These fields were reloaded.");
    } else {
      setMessage(result.message);
    }
    setSaving(false);
  }

  const projection = payoffProjection({
    debtQty: props.debtQty,
    debtUsd: props.debtUsd,
    hourlyRate: props.hourlyRate,
    contribution: numberOrNull(drafts.monthlyContribution),
    targetDate: drafts.targetSettleDate.trim() === "" ? null : drafts.targetSettleDate.trim(),
    currency: props.currency,
    fx: props.fx,
  });

  return (
    <Card className="animate-rise-in [animation-delay:280ms] @[680px]:col-span-2" aria-label="Repayment plan">
      <SectionHeader title="Repayment plan" caption="Saved to your account and shared across devices. Amounts are in the display currency." />
      <form
        className="grid gap-3 @[520px]:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void persist();
        }}
        onBlur={(event) => {
          const next = event.relatedTarget;
          if (next instanceof Node && event.currentTarget.contains(next)) return;
          void persist();
        }}
      >
        <Field label="Borrowed asset value (ZAR)" value={drafts.borrowedValueZar} onChange={(value) => edit("borrowedValueZar", value)} />
        <Field label="Conversion rate (ZAR per unit)" value={drafts.sellRate} onChange={(value) => edit("sellRate", value)} />
        <Field label="Target repayment rate (ZAR)" value={drafts.targetRepaymentUsdcZarRate} onChange={(value) => edit("targetRepaymentUsdcZarRate", value)} />
        <Field label="Monthly contribution" value={drafts.monthlyContribution} onChange={(value) => edit("monthlyContribution", value)} />
        <label className="block">
          <span className="text-caption text-muted-foreground">Settlement date</span>
          <input type="date" value={drafts.targetSettleDate} onChange={(event) => edit("targetSettleDate", event.target.value)} className={INPUT} />
        </label>
        <Field label="Monthly collateral amount" value={drafts.monthlyCollateralContribution} onChange={(value) => edit("monthlyCollateralContribution", value)} />
        <label className="block">
          <span className="text-caption text-muted-foreground">Goal</span>
          <select value={drafts.goalMode} onChange={(event) => edit("goalMode", event.target.value)} className={INPUT}>
            <option value="contribution">Monthly contribution</option>
            <option value="target">Settlement date</option>
            <option value="collateral">Build collateral</option>
          </select>
        </label>
        <div className="flex items-end gap-3">
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? "Saving…" : "Save plan"}
          </Button>
          {message ? (
            <p role="status" className="pb-3 text-caption text-muted-foreground">
              {message}
            </p>
          ) : null}
        </div>
      </form>
      <div className="mt-4 rounded-xl bg-card-elevated p-3.5 text-caption">
        {projection.available ? (
          <div className="space-y-1">
            <p className="flex items-center gap-2 text-foreground">
              Monthly interest {projection.monthlyInterest}
              <SourceTag tone="estimate">Estimate</SourceTag>
            </p>
            <p className="text-muted-foreground">{projection.monthsNote}</p>
            {projection.requiredForDate ? <p className="text-muted-foreground">Required each month for that date: {projection.requiredForDate}</p> : null}
          </div>
        ) : (
          <p className="text-muted-foreground">{projection.reason}</p>
        )}
        <p className="mt-2 text-micro text-subtle">{COLLATERAL_PLAN_UNAVAILABLE}</p>
      </div>
    </Card>
  );
}
