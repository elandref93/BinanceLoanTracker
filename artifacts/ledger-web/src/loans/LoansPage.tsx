import type { LoanHistoryPoint, LoanPosition, LoanProfile, PerformanceRange, PortfolioLoans } from "@workspace/api-client-react";
import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { LtvChart } from "@/charts/LtvChart";
import { fmtDateTime, fmtDayMonth, fmtPct, fmtUsd } from "@/domain/format";
import { LIQ_LTV, WARNING_LTV, riskBand, riskBandLabel, type RiskBand } from "@/domain/risk";
import { DebtAmount, LOAN_RANGES, LoanDetail, LoanIcon, loanTitle, loanTransitionName } from "@/loans/LoanDetail";
import { bandCounts, combinedTarget, dropToPct, loanTarget, ltvSeries, rankLoans, seriesSummary, USD_STABLES } from "@/loans/loanModel";
import { LtvBar, LtvGauge } from "@/loans/LtvGauge";
import { PortfolioUnavailable } from "@/portfolio/PortfolioUnavailable";
import { useLoans } from "@/portfolio/queries";
import { Balance } from "@/prefs/DiscreetMode";
import { usePrefs } from "@/prefs/PreferencesProvider";
import { displaySymbol } from "@/ui/AssetIcon";
import { Icon } from "@/ui/Icon";
import { BAND_SHAPES, Button, Card, cx, EmptyState, Notice, PageHeader, riskTextClass, SectionHeader, Segmented, Skeleton, SourceTag } from "@/ui/primitives";
import { useSplitView } from "@/ui/useMediaQuery";

function isLoanRange(value: string | null): value is PerformanceRange {
  return LOAN_RANGES.some((option) => option.value === value);
}

function useLoanRange(): [PerformanceRange, (range: PerformanceRange) => void] {
  const [search, setSearch] = useSearchParams();
  const raw = search.get("range");
  const range: PerformanceRange = isLoanRange(raw) ? raw : "1M";
  const set = (next: PerformanceRange) => {
    const updated = new URLSearchParams(search);
    if (next === "1M") updated.delete("range");
    else updated.set("range", next);
    setSearch(updated, { replace: true, preventScrollReset: true });
  };
  return [range, set];
}

export function LoansPage() {
  const params = useParams();
  const selectedId = params.loanId ? decodeURIComponent(params.loanId) : null;
  const split = useSplitView();
  const [range, setRange] = useLoanRange();
  const [search] = useSearchParams();
  const query = useLoans(range);
  const data = query.data;
  const ranked = useMemo(() => rankLoans(data?.loans ?? []), [data?.loans]);
  const backTo = `/loans${search.toString() ? `?${search.toString()}` : ""}`;

  if (query.isPending) return <LoansSkeleton split={split} detail={!split && selectedId != null} />;
  if (query.isError && !data) {
    return (
      <Notice tone="danger" title="Loans could not be loaded" action={<Button size="sm" onClick={() => void query.refetch()}>Try again</Button>}>
        Ledger will keep retrying in the background.
      </Notice>
    );
  }
  if (!data || !data.available) return <PortfolioUnavailable reason={data?.reason} title="Loans are not available yet" />;

  if (!split && selectedId) {
    const loan = ranked.find((item) => item.loanId === selectedId);
    if (!loan) return <MissingLoan backTo={backTo} />;
    return <LoanDetail loan={loan} history={data.history} range={range} onRange={setRange} showBack backTo={backTo} />;
  }

  if (ranked.length === 0) return <NoLoans />;
  if (!split) return <LoansList data={data} ranked={ranked} activeId={null} range={range} onRange={setRange} stale={query.isPlaceholderData} split={false} />;

  const active = ranked.find((item) => item.loanId === selectedId) ?? ranked[0] ?? null;
  return (
    <div className="grid grid-cols-[minmax(320px,380px)_minmax(0,1fr)] items-start gap-6 wide:grid-cols-[400px_minmax(0,1fr)]">
      <div className="sticky top-[5.25rem] max-h-[calc(100dvh-6.75rem)] overflow-y-auto overscroll-contain rounded-ledger pb-2 [scrollbar-width:thin]">
        <LoansList data={data} ranked={ranked} activeId={active?.loanId ?? null} range={range} onRange={setRange} stale={query.isPlaceholderData} split />
      </div>
      <div className="min-w-0">
        {active ? <LoanDetail key={active.loanId} loan={active} history={data.history} range={range} onRange={setRange} /> : null}
      </div>
    </div>
  );
}

function LoansList(props: {
  data: PortfolioLoans;
  ranked: LoanPosition[];
  activeId: string | null;
  range: PerformanceRange;
  onRange: (range: PerformanceRange) => void;
  stale: boolean;
  split: boolean;
}) {
  const counts = bandCounts(props.ranked);
  const flagged = counts.above + counts.margin + counts.liquidation;
  const subtitle = `${props.ranked.length} open ${props.ranked.length === 1 ? "loan" : "loans"}${flagged > 0 ? ` · ${flagged} need attention` : " · all within target"}`;
  return (
    <div className={cx("flex flex-col gap-4 transition-opacity duration-200", props.stale ? "opacity-60" : "opacity-100")}>
      <PageHeader
        title="Loans"
        subtitle={subtitle}
        actions={
          <Link
            to="/loans/history"
            viewTransition
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-caption font-medium text-primary hover:bg-primary/10"
          >
            <Icon name="history" size={16} />
            Interest
          </Link>
        }
      />
      <OverviewCard data={props.data} counts={counts} />
      <Card padded={false} className="animate-rise-in px-2 py-2 [animation-delay:40ms]" aria-label="Loans ranked by risk">
        <p className="px-2 pb-1 pt-2 text-micro font-medium uppercase tracking-wider text-muted-foreground">Highest risk first</p>
        <ul>
          {props.ranked.map((loan) => (
            <li key={loan.loanId}>
              <LoanRow loan={loan} active={props.activeId === loan.loanId} split={props.split} />
            </li>
          ))}
        </ul>
      </Card>
      {props.data.profiles.length > 1 ? <ProfilesCard profiles={props.data.profiles} /> : null}
      <CombinedHistory data={props.data} range={props.range} onRange={props.onRange} />
    </div>
  );
}

function OverviewCard(props: { data: PortfolioLoans; counts: Record<RiskBand, number> }) {
  const prefs = usePrefs();
  const { totals, profiles, loans } = props.data;
  const target = combinedTarget(profiles);
  const weighted = profiles.filter((profile) => profile.debtUsd > 0).length > 1;
  const stableDebt = loans.filter((loan) => USD_STABLES.has(displaySymbol(loan.asset)));
  const allStable = stableDebt.length === loans.length && loans.length > 0;
  const nativeUsd = stableDebt.reduce((sum, loan) => sum + loan.debtQty, 0);
  const chips = (["liquidation", "margin", "above", "healthy"] as const).filter((band) => props.counts[band] > 0);
  return (
    <Card className="animate-rise-in" aria-label="Loans overview">
      <div className="grid items-center gap-4 @[360px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <LtvGauge ltv={totals.ltv} target={target} caption={weighted ? `Debt-weighted target ${fmtPct(target, 0)}` : `Target ${fmtPct(target, 0)}`} />
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 @[360px]:grid-cols-1">
          <div>
            <dt className="text-micro font-medium uppercase tracking-wider text-muted-foreground">Borrowed</dt>
            <dd className="mt-0.5 text-heading font-semibold tabular">{prefs.money(totals.debtUsd, { whole: true })}</dd>
            {allStable && prefs.currency === "ZAR" ? (
              <dd className="text-micro text-muted-foreground tabular">
                <Balance text={fmtUsd(nativeUsd, { whole: true })} />
              </dd>
            ) : null}
          </div>
          <div>
            <dt className="text-micro font-medium uppercase tracking-wider text-muted-foreground">Collateral</dt>
            <dd className="mt-0.5 text-heading font-semibold tabular">{prefs.money(totals.collateralUsd, { whole: true })}</dd>
          </div>
          <div className="col-span-2 @[360px]:col-span-1">
            <dt className="text-micro font-medium uppercase tracking-wider text-muted-foreground">Interest</dt>
            <dd className="mt-0.5 text-body font-semibold tabular">
              {prefs.money(totals.dailyInterestUsd)} <span className="font-normal text-muted-foreground">a day</span>
            </dd>
            <dd className="text-micro text-muted-foreground tabular">≈ {prefs.money(totals.dailyInterestUsd * 30, { whole: true })} a month</dd>
          </div>
        </dl>
      </div>
      {chips.length > 0 ? (
        <ul className="mt-4 flex flex-wrap gap-2" aria-label="Loans by risk band">
          {chips.map((band) => (
            <li key={band} className={cx("inline-flex items-center gap-1.5 rounded-full bg-card-elevated px-2.5 py-1 text-micro font-semibold", riskTextClass(band))}>
              <span aria-hidden="true" className="text-[0.75em]">
                {BAND_SHAPES[band]}
              </span>
              {props.counts[band]} {riskBandLabel(band).toLowerCase()}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function LoanRow(props: { loan: LoanPosition; active: boolean; split: boolean }) {
  const { loan } = props;
  const [search] = useSearchParams();
  const target = loanTarget(loan);
  const band = riskBand(loan.ltv, target);
  const collateral = displaySymbol(loan.collateralAsset);
  const marginDrop = dropToPct(loan.collateralPriceUsd, loan.priceAtMarginCallUsd);
  const query = search.toString();
  return (
    <Link
      to={{ pathname: `/loans/${encodeURIComponent(loan.loanId)}`, search: query ? `?${query}` : "" }}
      viewTransition
      preventScrollReset
      aria-current={props.active ? "page" : undefined}
      className={cx(
        "group flex gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-card-elevated focus-visible:bg-card-elevated",
        props.active && "bg-card-elevated shadow-[inset_0_0_0_1px_var(--color-border-strong)]",
      )}
    >
      <LoanIcon loan={loan} transitionName={props.split ? undefined : loanTransitionName(loan.loanId)} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="truncate text-body font-semibold">{loanTitle(loan)}</span>
          <span className={cx("inline-flex shrink-0 items-center gap-1 text-body font-semibold tabular", riskTextClass(band))}>
            <span aria-hidden="true" className="text-[0.65em]">
              {BAND_SHAPES[band]}
            </span>
            {fmtPct(loan.ltv)}
          </span>
        </span>
        <span className="mt-0.5 flex items-start justify-between gap-3">
          <span className="min-w-0 truncate text-caption text-muted-foreground">
            {collateral} · {loan.profileName ?? "Not in a profile"}
          </span>
          <DebtAmount loan={loan} className="shrink-0 text-caption" compact />
        </span>
        <LtvBar ltv={loan.ltv} target={target} className="mt-2" />
        <span className="mt-1.5 flex items-center justify-between gap-3 text-micro">
          <span className={cx("font-semibold", riskTextClass(band))}>
            {riskBandLabel(band)}
            <span className="font-normal text-muted-foreground"> · target {fmtPct(target, 0)}</span>
          </span>
          <span className="truncate text-muted-foreground tabular">
            {marginDrop == null ? "" : marginDrop > 0 ? `Margin call at ${collateral} −${fmtPct(marginDrop)}` : "Past margin call"}
          </span>
        </span>
      </span>
    </Link>
  );
}

function ProfilesCard(props: { profiles: LoanProfile[] }) {
  return (
    <Card className="animate-rise-in [animation-delay:80ms]" aria-label="By profile">
      <SectionHeader title="By profile" caption="Each against its own target" />
      <ul className="flex flex-col gap-4">
        {props.profiles.map((profile) => {
          const target = loanTarget(profile);
          const ltv = profile.ltv;
          const band = ltv == null ? null : riskBand(ltv, target);
          return (
            <li key={profile.containerId ?? "none"}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-body font-medium">{profile.name}</span>
                <span className={cx("shrink-0 text-body font-semibold tabular", band ? riskTextClass(band) : "text-muted-foreground")}>{ltv == null ? "—" : fmtPct(ltv)}</span>
              </div>
              {ltv != null ? <LtvBar ltv={ltv} target={target} className="mt-2" /> : null}
              <p className="mt-1.5 flex justify-between gap-3 text-micro text-muted-foreground">
                <span className={band ? cx("font-semibold", riskTextClass(band)) : undefined}>{band ? riskBandLabel(band) : "No collateral value"}</span>
                <span className="tabular">
                  Target {fmtPct(target, 0)} · {profile.loanCount} {profile.loanCount === 1 ? "loan" : "loans"}
                </span>
              </p>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function CombinedHistory(props: { data: PortfolioLoans; range: PerformanceRange; onRange: (range: PerformanceRange) => void }) {
  const history: LoanHistoryPoint[] = props.data.history;
  const target = combinedTarget(props.data.profiles);
  const points = useMemo(() => ltvSeries(history, { kind: "all" }), [history]);
  const summary = seriesSummary(points);
  const [scrub, setScrub] = useState<number | null>(null);
  const shown = scrub != null ? points[scrub] : points[points.length - 1];
  const shownBand = shown ? riskBand(shown.v, target) : null;
  const label = summary
    ? `Combined LTV from ${fmtPct(summary.start)} to ${fmtPct(summary.end)}, low ${fmtPct(summary.low)}, high ${fmtPct(summary.high)}. Target ${fmtPct(target, 0)}, margin call ${fmtPct(WARNING_LTV, 0)}, liquidation ${fmtPct(LIQ_LTV, 0)}.`
    : "No LTV history yet";
  return (
    <Card className="animate-rise-in [animation-delay:120ms]" aria-label="Combined LTV history">
      <SectionHeader
        title="Combined LTV"
        action={<Segmented label="History range" size="sm" options={LOAN_RANGES} value={props.range} onChange={props.onRange} className="w-48" />}
      />
      {points.length >= 2 && shown ? (
        <>
          <p className="flex flex-wrap items-baseline gap-x-2 text-caption text-muted-foreground tabular" aria-live="polite">
            <span className={cx("text-heading font-semibold", shownBand ? riskTextClass(shownBand) : "")}>{fmtPct(shown.v)}</span>
            {scrub != null ? fmtDateTime(shown.t) : summary ? <>High {fmtPct(summary.high)} · Low {fmtPct(summary.low)}</> : null}
          </p>
          <LtvChart key={props.range} points={points} target={target} label={label} onScrub={setScrub} className="mt-3 h-40" />
          <div className="mt-1.5 flex justify-between text-micro text-subtle tabular">
            <span>{fmtDayMonth(points[0]?.t ?? 0)}</span>
            <span>{fmtDayMonth(points[points.length - 1]?.t ?? 0)}</span>
          </div>
          {props.data.historyBasis === "aggregate" ? (
            <p className="mt-2">
              <SourceTag>From the earlier LTV log</SourceTag>
            </p>
          ) : null}
        </>
      ) : (
        <p className="py-6 text-center text-caption text-muted-foreground">History builds up from the 15-minute snapshots.</p>
      )}
    </Card>
  );
}

function NoLoans() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Loans" />
      <Card>
        <EmptyState
          icon="loans"
          title="No open loans"
          body="Loans opened on a linked Binance account appear here after the next snapshot."
          action={
            <Link to="/loans/history" viewTransition className="text-body font-medium text-primary">
              View interest history
            </Link>
          }
        />
      </Card>
    </div>
  );
}

function MissingLoan(props: { backTo: string }) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Loan" back={{ to: props.backTo, label: "Loans" }} />
      <Card>
        <EmptyState icon="loans" title="This loan is closed or not in this profile" body="Pick another profile from the top bar, or go back to your open loans." />
      </Card>
    </div>
  );
}

function LoansSkeleton(props: { split: boolean; detail: boolean }) {
  const list = (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading loans">
      <Skeleton className="h-8 w-32 rounded-lg" />
      <Card>
        <div className="flex flex-col items-center">
          <Skeleton className="h-28 w-56 rounded-t-full" />
          <Skeleton className="mt-3 h-8 w-24 rounded-lg" />
        </div>
      </Card>
      <Card>
        {[0, 1, 2].map((index) => (
          <div key={index} className="flex gap-3 py-3">
            <Skeleton className="size-9 rounded-full" />
            <div className="flex-1">
              <Skeleton className="h-4 w-28 rounded" />
              <Skeleton className="mt-2 h-1.5 w-full rounded-full" />
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
  if (props.detail) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading loan">
        <Skeleton className="h-11 w-48 rounded-lg" />
        <Card className="h-80">
          <Skeleton className="h-full w-full rounded-xl" />
        </Card>
      </div>
    );
  }
  if (!props.split) return list;
  return (
    <div className="grid grid-cols-[minmax(320px,380px)_minmax(0,1fr)] gap-6 wide:grid-cols-[400px_minmax(0,1fr)]">
      {list}
      <Card className="h-[480px]">
        <Skeleton className="h-full w-full rounded-xl" />
      </Card>
    </div>
  );
}
