import type { LoanPosition, PortfolioAnalytics } from "@workspace/api-client-react";
import { useMemo, useState } from "react";

import { FanChart } from "@/charts/FanChart";
import { fmtDate, fmtNum, fmtPct } from "@/domain/format";
import type { ForecastDrift, ForecastResult } from "@/insights/forecast";
import { ConcentrationCard, ContributionsCard, CgtCard, DangerCard, InterestDragCard, RiskProfileCard, StressCard } from "@/insights/insightCards";
import { FORECAST_PATHS, forecastInput, HORIZONS, type HorizonKey } from "@/insights/insightsModel";
import { useForecast } from "@/insights/useForecast";
import { LoanIcon, loanTitle } from "@/loans/LoanDetail";
import { rankLoans } from "@/loans/loanModel";
import { ExpectedReturnsInsight } from "@/portfolio/ExpectedReturnCard";
import { PortfolioUnavailable } from "@/portfolio/PortfolioUnavailable";
import { isSavedSnapshot } from "@/portfolio/snapshotFlags";
import { useAnalytics, useAssets, useLoans } from "@/portfolio/queries";
import { useDiscreet } from "@/prefs/DiscreetMode";
import { usePrefs } from "@/prefs/PreferencesProvider";
import { Button, Card, cx, Notice, PageHeader, SectionHeader, Segmented, Skeleton, SourceTag } from "@/ui/primitives";

const DAY_MS = 24 * 60 * 60 * 1000;

export function InsightsPage() {
  const analytics = useAnalytics();
  const data = analytics.data;
  if (analytics.isPending) return <InsightsSkeleton />;
  if (analytics.isError && !data) {
    return (
      <Notice tone="danger" title="Insights could not be loaded" action={<Button size="sm" onClick={() => void analytics.refetch()}>Try again</Button>}>
        Ledger will keep retrying in the background.
      </Notice>
    );
  }
  if (!data || !data.available) return <PortfolioUnavailable title="Insights are not available yet" />;
  return <InsightsContent analytics={data} />;
}

function InsightsContent(props: { analytics: PortfolioAnalytics }) {
  const { analytics } = props;
  const loansQuery = useLoans("1M");
  const assetsQuery = useAssets();
  const loans = useMemo(() => rankLoans(loansQuery.data?.available ? loansQuery.data.loans : []), [loansQuery.data]);
  const assets = assetsQuery.data?.available ? assetsQuery.data.assets : null;
  const savedSnapshot = isSavedSnapshot(analytics);
  const [drift, setDrift] = useState<ForecastDrift>("none");
  const input = useMemo(() => (savedSnapshot ? null : forecastInput(analytics, drift)), [analytics, drift, savedSnapshot]);
  const forecast = useForecast(input);
  const hasLoans = analytics.loans.length > 0;

  return (
    <div>
      <PageHeader
        title="Insights"
        subtitle={
          savedSnapshot
            ? "From the saved snapshot: loan LTV, collateral, and interest. Not a forecast, and not financial advice."
            : "Estimates from your ledger and today's prices. Not financial advice."
        }
      />
      <div className="@container">
        <div className="grid gap-4 @[760px]:grid-cols-2">
          <ForecastCard
            className="@[760px]:col-span-2"
            asOf={analytics.asOf}
            forecast={forecast.result}
            running={forecast.running}
            failed={forecast.failed}
            drift={drift}
            onDrift={setDrift}
            savedSnapshot={savedSnapshot}
          />
          <ExpectedReturnsInsight assets={assets} savedSnapshot={savedSnapshot} className="@[760px]:col-span-2" />
          {hasLoans ? <OddsCard loans={loans} forecast={forecast.result} running={forecast.running} savedSnapshot={savedSnapshot} /> : null}
          <StressCard assets={savedSnapshot ? null : assets} loans={loans} savedSnapshot={savedSnapshot} />
          {loans.length > 0 ? <DangerCard loans={loans} /> : null}
          <InterestDragCard analytics={analytics} loans={loans} savedSnapshot={savedSnapshot} />
          <RiskProfileCard analytics={analytics} savedSnapshot={savedSnapshot} />
          <ConcentrationCard analytics={analytics} assets={assets} savedSnapshot={savedSnapshot} />
          <ContributionsCard analytics={analytics} savedSnapshot={savedSnapshot} className="@[760px]:col-span-2" />
          <CgtCard className="@[760px]:col-span-2" />
        </div>
      </div>
    </div>
  );
}

function ForecastCard(props: {
  className?: string;
  asOf: string | null;
  forecast: ForecastResult | null;
  running: boolean;
  failed: boolean;
  drift: ForecastDrift;
  onDrift: (drift: ForecastDrift) => void;
  savedSnapshot?: boolean;
}) {
  const prefs = usePrefs();
  const discreet = useDiscreet();
  const [horizon, setHorizon] = useState<HorizonKey>("6M");
  const [scrub, setScrub] = useState<number | null>(null);
  const days = HORIZONS.find((option) => option.value === horizon)?.day ?? 182;
  const result = props.forecast?.ok ? props.forecast : null;
  const stats = result?.horizons.find((item) => item.day === days) ?? null;
  const startMs = props.asOf ? Date.parse(props.asOf) : Date.now();
  const shownDay = scrub ?? days;
  const shown = result ? { p10: result.p10[shownDay] ?? 0, p50: result.p50[shownDay] ?? 0, p90: result.p90[shownDay] ?? 0 } : null;
  const label =
    result && stats
      ? `Net worth forecast over ${horizon}. Middle outcome ${discreet.mask(prefs.formatMoney(stats.p50, { whole: true }))}, 8 in 10 outcomes between ${discreet.mask(prefs.formatMoney(stats.p10, { whole: true }))} and ${discreet.mask(prefs.formatMoney(stats.p90, { whole: true }))}. Today ${discreet.mask(prefs.formatMoney(result.start, { whole: true }))}.`
      : "Net worth forecast";

  return (
    <Card className={cx("animate-rise-in", props.className)} aria-label="Net worth forecast">
      <SectionHeader
        title="Net worth forecast"
        caption={<SourceTag tone="estimate">Estimate, not advice</SourceTag>}
        action={
          <Segmented
            label="Forecast horizon"
            size="sm"
            options={HORIZONS.map((option) => ({ value: option.value, label: option.label }))}
            value={horizon}
            onChange={(next) => {
              setScrub(null);
              setHorizon(next);
            }}
            className="w-40"
          />
        }
      />
      {props.savedSnapshot ? (
        <p className="py-8 text-center text-caption text-muted-foreground">A net-worth forecast is not in the saved snapshot.</p>
      ) : props.failed ? (
        <Notice tone="warn" title="The forecast could not run">
          Reload the page to try again.
        </Notice>
      ) : props.forecast && !props.forecast.ok ? (
        <p className="py-8 text-center text-caption text-muted-foreground">
          {props.forecast.reason === "no_history"
            ? "A forecast needs at least 30 days of prices for what you hold. It appears once that history has been fetched."
            : "There is nothing to forecast yet."}
        </p>
      ) : result && stats && shown ? (
        <div className={cx("transition-opacity duration-200", props.running ? "opacity-60" : "opacity-100")}>
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2" aria-live="polite">
            <div className="min-w-0">
              <p className="text-caption text-muted-foreground">
                {scrub != null ? `Middle outcome on ${fmtDate(startMs + scrub * DAY_MS)}` : `Middle outcome in ${horizon === "12M" ? "12 months" : horizon === "6M" ? "6 months" : "3 months"}`}
              </p>
              <p className="mt-1 text-[28px] font-semibold leading-9 tracking-tight tabular">{prefs.money(shown.p50, { whole: true })}</p>
              <p className="text-caption text-muted-foreground tabular">
                8 in 10 between {prefs.money(shown.p10, { whole: true })} and {prefs.money(shown.p90, { whole: true })}
              </p>
            </div>
            <dl className="flex gap-5 text-right">
              <div>
                <dt className="text-micro font-medium uppercase tracking-wider text-muted-foreground">Today</dt>
                <dd className="mt-1 text-body font-semibold tabular">{prefs.money(result.start, { whole: true })}</dd>
              </div>
              <div>
                <dt className="text-micro font-medium uppercase tracking-wider text-muted-foreground">Chance lower</dt>
                <dd className={cx("mt-1 text-body font-semibold tabular", stats.lowerProb >= 0.5 ? "text-warn" : "")}>{fmtPct(stats.lowerProb * 100, 0)}</dd>
              </div>
            </dl>
          </div>
          <FanChart
            key={`${horizon}-${props.drift}`}
            bands={result}
            days={days}
            start={result.start}
            label={label}
            formatTick={(value) => prefs.formatMoney(value, { compact: true })}
            onScrub={setScrub}
            className="mt-4 h-56 lg:h-64"
          />
          <div className="mt-1.5 flex justify-between pr-14 text-micro text-subtle tabular">
            <span>Today</span>
            <span>{fmtDate(startMs + days * DAY_MS)}</span>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-caption text-muted-foreground">Price trend</span>
              <Segmented
                label="Price trend"
                size="sm"
                options={[
                  { value: "none", label: "None" },
                  { value: "history", label: "Last year's" },
                ]}
                value={props.drift}
                onChange={props.onDrift}
                className="w-48"
              />
            </div>
            <p className="flex items-center gap-1.5 text-micro text-muted-foreground" aria-hidden={!props.running}>
              {props.running ? "Updating…" : null}
            </p>
          </div>
          <p className="mt-3 text-micro text-muted-foreground">
            {fmtNum(result.paths, 0)} simulations replaying {result.historyDays} days of real price moves, with assets moving together as they did.
            {props.drift === "none" ? " No trend is assumed: prices wander around today's level." : " Last year's average daily move is carried forward, which may not repeat."}{" "}
            Loan interest accrues at today's rates. Loans are not repaid, topped up or liquidated along the way. The shaded bands hold 8 in 10 and half of the outcomes.
          </p>
        </div>
      ) : (
        <div>
          <Skeleton className="h-9 w-48 rounded-lg" />
          <Skeleton className="mt-2 h-4 w-64 rounded" />
          <Skeleton className="mt-4 h-56 w-full rounded-xl lg:h-64" />
          <p className="mt-3 text-micro text-muted-foreground">Running {fmtNum(FORECAST_PATHS, 0)} simulations…</p>
        </div>
      )}
    </Card>
  );
}

function fmtOdds(probability: number): string {
  if (probability < 0.01) return "<1%";
  if (probability > 0.99) return ">99%";
  return fmtPct(probability * 100, 0);
}

function oddsTone(probability: number): string {
  if (probability >= 0.1) return "text-danger";
  if (probability >= 0.02) return "text-warn";
  return "text-muted-foreground";
}

function OddsCard(props: { loans: LoanPosition[]; forecast: ForecastResult | null; running: boolean; savedSnapshot?: boolean }) {
  const result = props.forecast?.ok ? props.forecast : null;
  const odds = new Map((result?.loans ?? []).map((item) => [item.id, item]));
  return (
    <Card className="animate-rise-in [animation-delay:40ms]" aria-label="Margin-call odds">
      <SectionHeader title="Margin-call odds" caption="Share of simulations where a loan reaches each level" />
      {props.savedSnapshot ? (
        <p className="py-4 text-caption text-muted-foreground">Margin-call odds are not in the saved snapshot.</p>
      ) : props.forecast && !props.forecast.ok ? (
        <p className="py-4 text-caption text-muted-foreground">Needs at least 30 days of prices.</p>
      ) : !result || props.loans.length === 0 ? (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)_repeat(2,4.25rem)] items-end gap-x-2 border-b border-border pb-2 text-micro font-medium uppercase tracking-wider text-muted-foreground">
            <span>Loan</span>
            <span className="text-right">30 days</span>
            <span className="text-right">90 days</span>
          </div>
          <ul className={cx("divide-y divide-border transition-opacity", props.running ? "opacity-60" : "")}>
            {props.loans.map((loan) => {
              const item = odds.get(loan.loanId);
              if (!item) return null;
              return (
                <li key={loan.loanId} className="py-3">
                  <div className="flex items-center gap-2.5">
                    <LoanIcon loan={loan} size={26} />
                    <span className="min-w-0 truncate text-body font-medium">{loanTitle(loan)}</span>
                    <span className="min-w-0 truncate text-caption text-muted-foreground">{loan.profileName ?? loan.linkName}</span>
                  </div>
                  <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_repeat(2,4.25rem)] gap-x-2 gap-y-1 text-caption tabular">
                    <dt className="text-muted-foreground">Margin call {fmtPct(loan.marginCallLtv, 0)}</dt>
                    <dd className={cx("text-right font-semibold", oddsTone(item.margin30))}>{fmtOdds(item.margin30)}</dd>
                    <dd className={cx("text-right font-semibold", oddsTone(item.margin90))}>{fmtOdds(item.margin90)}</dd>
                    <dt className="text-muted-foreground">Liquidation {fmtPct(loan.liqLtv, 0)}</dt>
                    <dd className={cx("text-right font-semibold", oddsTone(item.liq30))}>{fmtOdds(item.liq30)}</dd>
                    <dd className={cx("text-right font-semibold", oddsTone(item.liq90))}>{fmtOdds(item.liq90)}</dd>
                  </dl>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-micro text-muted-foreground">
            From the same simulations as the forecast, if nothing is repaid or added. The exchange acts at these levels, so treat anything above a few percent as a prompt to act.
          </p>
        </>
      )}
    </Card>
  );
}

function InsightsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading insights">
      <Skeleton className="mb-2 h-8 w-40 rounded-lg" />
      <Skeleton className="mb-5 h-4 w-72 rounded" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-96 rounded-ledger lg:col-span-2" />
        <Skeleton className="h-64 rounded-ledger" />
        <Skeleton className="h-64 rounded-ledger" />
      </div>
    </div>
  );
}
