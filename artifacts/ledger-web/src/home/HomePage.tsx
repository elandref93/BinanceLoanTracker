import type { PerformancePoint, PerformanceRange, PnlPeriod, PortfolioOverview } from "@workspace/api-client-react";
import { useCallback, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router";

import { PerformanceChart, Sparkline, type ChartTone } from "@/charts/PerformanceChart";
import { fmtDateTime, fmtDayMonth, fmtDisplayMoney, fmtNum, fmtPct, fmtSignedPct, fmtTime } from "@/domain/format";
import { DEFAULT_TARGET_LTV, riskBand, riskBandLabel, riskSeverity, type RiskBand } from "@/domain/risk";
import { homeInsights, type Insight, type InsightTone } from "@/home/insights";
import { PnlBreakdownSheet } from "@/home/PnlBreakdownSheet";
import { PortfolioUnavailable } from "@/portfolio/PortfolioUnavailable";
import { blockedHistorySources, useImportStatus, useOverview, usePerformance } from "@/portfolio/queries";
import { Balance, useDiscreet } from "@/prefs/DiscreetMode";
import { DISCREET_PLACEHOLDER } from "@/prefs/discreet";
import { usePrefs, useProfileName } from "@/prefs/PreferencesProvider";
import { assetColor } from "@/theme/ledgerColors";
import { AssetIcon } from "@/ui/AssetIcon";
import { Icon, type IconName } from "@/ui/Icon";
import { useRollingNumber, usePulseKey } from "@/ui/motion";
import { BAND_SHAPES, Button, Card, cx, Delta, deltaTone, Notice, riskTextClass, Segmented, Skeleton, SourceTag } from "@/ui/primitives";

const RANGES: ReadonlyArray<{ value: PerformanceRange; label: string }> = [
  { value: "1D", label: "1D" },
  { value: "1W", label: "1W" },
  { value: "1M", label: "1M" },
  { value: "3M", label: "3M" },
  { value: "1Y", label: "1Y" },
  { value: "ALL", label: "All" },
];

const RANGE_CAPTION: Record<PerformanceRange, string> = {
  "1D": "past 24 hours",
  "1W": "past week",
  "1M": "past month",
  "3M": "past 3 months",
  "1Y": "past year",
  ALL: "since history starts",
};

type PeriodKey = "today" | "week" | "month";

const PERIODS: ReadonlyArray<{ key: PeriodKey; label: string; long: string }> = [
  { key: "today", label: "Today", long: "Today" },
  { key: "week", label: "Week", long: "This week" },
  { key: "month", label: "Month", long: "This month" },
];

export function HomePage() {
  const overview = useOverview();
  const data = overview.data;

  if (overview.isPending) return <HomeSkeleton />;
  if (overview.isError && !data) {
    return (
      <Notice tone="danger" title="Net worth could not be loaded" action={<Button size="sm" onClick={() => void overview.refetch()}>Try again</Button>}>
        Ledger will keep retrying in the background.
      </Notice>
    );
  }
  if (!data || !data.available) return <PortfolioUnavailable reason={data?.reason} />;
  return <HomeContent overview={data} />;
}

function HomeContent(props: { overview: PortfolioOverview }) {
  const { overview } = props;
  const prefs = usePrefs();
  const profileName = useProfileName();
  const [range, setRange] = useState<PerformanceRange>("1M");
  const performance = usePerformance(range);
  const points = performance.data?.points ?? [];
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const [openPeriod, setOpenPeriod] = useState<PeriodKey | null>(null);
  const scrubbed = scrubIndex != null ? points[scrubIndex] ?? null : null;
  const importing = overview.import.state === "pending" || overview.import.state === "running" || overview.import.state === "partial";

  const insights = useMemo(
    () =>
      homeInsights(overview, {
        signed: (usd) => prefs.formatMoney(usd, { signed: true, whole: true }),
        amount: (usd) => prefs.formatMoney(usd, { whole: true }),
        profileName,
      }),
    [overview, prefs, profileName],
  );

  return (
    <>
      <div className="flex w-full min-w-0 flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start lg:gap-5">
        <Card className="min-w-0 w-full lg:col-start-1 lg:row-start-1" aria-labelledby="networth-label">
          <NetWorthHero overview={overview} scrubbed={scrubbed} range={range} />
          <ChartBlock
            range={range}
            onRange={(next) => {
              setScrubIndex(null);
              setRange(next);
            }}
            points={points}
            loading={performance.isPending}
            unavailable={performance.data?.available === false}
            stale={performance.isPlaceholderData}
            summary={performance.data?.summary ?? null}
            onScrub={setScrubIndex}
          />
        </Card>
        <div className="flex w-full min-w-0 flex-col gap-4 lg:col-start-2 lg:row-start-1 lg:row-span-3 lg:gap-5">
          <PnlTiles overview={overview} onOpen={setOpenPeriod} className="w-full min-w-0" />
          {importing ? <ImportProgress progress={overview.import.progress} className="w-full min-w-0" /> : null}
          <BalanceStrip overview={overview} className="w-full min-w-0" />
          <AllocationCard overview={overview} className="w-full min-w-0" />
          <LoansLink overview={overview} className="w-full min-w-0" />
          <Provenance overview={overview} className="w-full min-w-0" />
        </div>
        <MoversCard overview={overview} className="min-w-0 w-full lg:col-start-1 lg:row-start-2" />
        <InsightsCard insights={insights} className="min-w-0 w-full lg:col-start-1 lg:row-start-3" />
      </div>
      <PnlBreakdownSheet
        open={openPeriod != null}
        onClose={() => setOpenPeriod(null)}
        title={PERIODS.find((item) => item.key === openPeriod)?.long ?? ""}
        period={openPeriod ? overview[openPeriod] : null}
      />
    </>
  );
}

function NetWorthHero(props: { overview: PortfolioOverview; scrubbed: PerformancePoint | null; range: PerformanceRange }) {
  const prefs = usePrefs();
  const discreet = useDiscreet();
  const { overview, scrubbed } = props;
  const heroRef = useRef<HTMLSpanElement | null>(null);
  const net = prefs.convert(overview.totals.netUsd);
  const currency = prefs.currency;
  const format = useCallback(
    (value: number) => (discreet.hidden ? DISCREET_PLACEHOLDER : fmtDisplayMoney(value, currency)),
    [currency, discreet.hidden],
  );
  useRollingNumber(heroRef, net, format);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <p id="networth-label" className="text-caption font-medium text-muted-foreground">
          {scrubbed ? fmtDateTime(scrubbed.t) : "Net worth"}
        </p>
        {overview.fxSource === "reference" ? <SourceTag tone="warn">Reference rate</SourceTag> : null}
      </div>
      <p className="tabular max-w-full text-[clamp(1.65rem,8vw,2.125rem)] font-semibold leading-tight tracking-tight sm:truncate sm:text-hero sm:leading-[48px]">
        <span ref={heroRef} aria-hidden="true" data-balance={discreet.enabled ? "" : undefined} className={scrubbed ? "hidden" : undefined} />
        <span className="sr-only">{prefs.money(overview.totals.netUsd)}</span>
        {scrubbed ? <span aria-hidden="true">{prefs.money(scrubbed.netUsd)}</span> : null}
      </p>
      <div className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1">
        {scrubbed ? (
          <>
            <Delta amount={prefs.convert(scrubbed.pnlUsd)} pct={scrubbed.twrPct} currency={prefs.currency} />
            <span className="text-caption text-muted-foreground">since the start of the range</span>
          </>
        ) : overview.today.pnlUsd != null ? (
          <>
            <Delta amount={prefs.convert(overview.today.pnlUsd)} pct={overview.today.pct} currency={prefs.currency} />
            <span className="text-caption text-muted-foreground">today</span>
          </>
        ) : (
          <span className="text-caption text-muted-foreground">Today's change appears after the first full snapshot.</span>
        )}
      </div>
    </div>
  );
}

function ChartBlock(props: {
  range: PerformanceRange;
  onRange: (range: PerformanceRange) => void;
  points: PerformancePoint[];
  loading: boolean;
  unavailable: boolean;
  stale: boolean;
  summary: { pnlUsd: number | null; twrPct: number | null; startUsd: number | null } | null;
  onScrub: (index: number | null) => void;
}) {
  const prefs = usePrefs();
  const discreet = useDiscreet();
  const values = useMemo(() => props.points.map((point) => point.netUsd), [props.points]);
  const tone: ChartTone = deltaTone(props.summary?.pnlUsd);
  const enough = values.length >= 2;
  const first = props.points[0];
  const last = props.points[props.points.length - 1];
  const label = enough && first && last
    ? `Net worth from ${discreet.mask(prefs.formatMoney(first.netUsd, { whole: true }))} on ${fmtDayMonth(first.t)} to ${discreet.mask(prefs.formatMoney(last.netUsd, { whole: true }))}, ${RANGE_CAPTION[props.range]}.`
    : "Not enough history for a chart yet.";

  return (
    <div className="mt-4">
      <div className="mb-2 flex min-h-5 items-center gap-2">
        {props.summary?.pnlUsd != null ? (
          <>
            <Delta amount={prefs.convert(props.summary.pnlUsd)} pct={props.summary.twrPct} currency={prefs.currency} size="sm" />
            <span className="text-micro text-muted-foreground">{RANGE_CAPTION[props.range]}</span>
          </>
        ) : null}
      </div>
      <div className={cx("relative h-[180px] transition-opacity duration-200 sm:h-[220px] lg:h-[260px] wide:h-[300px]", props.stale ? "opacity-60" : "opacity-100")}>
        {props.loading && !enough ? (
          <Skeleton className="h-full w-full rounded-xl" />
        ) : enough ? (
          <PerformanceChart
            values={values}
            baseline={first?.netUsd ?? null}
            tone={tone}
            label={label}
            onScrub={props.onScrub}
            className="h-full w-full"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-border text-center">
            <Icon name="history" size={22} className="text-subtle" />
            <p className="mt-2 max-w-sm text-caption text-muted-foreground">
              {props.unavailable
                ? "No net-worth history in the saved snapshot. Loan LTV history is on the Loans page."
                : props.range === "1D" || props.range === "1W"
                  ? "Snapshots are taken every 15 minutes. The chart fills in from here."
                  : "History for this range is still being built."}
            </p>
          </div>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <Segmented label="Chart range" options={RANGES} value={props.range} onChange={props.onRange} size="sm" className="w-full min-w-0 max-w-[360px]" />
      </div>
      {enough ? <ChartTable points={props.points} /> : null}
    </div>
  );
}

const johannesburgDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Johannesburg",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** One row per Johannesburg day so a single carried-forward close is not sampled away. */
function dailyCloses(points: PerformancePoint[]): PerformancePoint[] {
  const last = new Map<string, PerformancePoint>();
  for (const point of points) last.set(johannesburgDay.format(new Date(point.t)), point);
  const rows = [...last.values()];
  if (rows.length <= 45) return rows;
  return rows.filter((_, index, list) => index % Math.ceil(list.length / 45) === 0 || index === list.length - 1);
}

function ChartTable(props: { points: PerformancePoint[] }) {
  const prefs = usePrefs();
  const rows = dailyCloses(props.points);
  return (
    <details className="mt-2 text-caption text-muted-foreground">
      <summary className="inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-md px-1 hover:text-foreground">Show as table</summary>
      <div className="mt-2 max-h-64 overflow-auto rounded-xl border border-border">
        <table className="w-full text-left tabular">
          <thead className="sticky top-0 bg-card-elevated text-micro uppercase tracking-wider">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">When</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Net worth</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((point) => (
              <tr key={point.t} className="border-t border-border">
                <td className="px-3 py-1.5">{fmtDayMonth(point.t)} {fmtTime(point.t)}</td>
                <td className="px-3 py-1.5 text-right text-foreground">{prefs.money(point.netUsd, { whole: true })}</td>
                <td className="px-3 py-1.5 text-right">{fmtSignedPct(point.twrPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function PnlTiles(props: { overview: PortfolioOverview; onOpen: (key: PeriodKey) => void; className?: string }) {
  return (
    <div className={cx("grid w-full min-w-0 grid-cols-3 gap-2 sm:gap-3 lg:grid-cols-1", props.className)} role="list" aria-label="Profit and loss">
      {PERIODS.map((item) => (
        <PnlTile key={item.key} label={item.label} long={item.long} period={props.overview[item.key]} onOpen={() => props.onOpen(item.key)} />
      ))}
    </div>
  );
}

function PnlTile(props: { label: string; long: string; period: PnlPeriod; onOpen: () => void }) {
  const prefs = usePrefs();
  const discreet = useDiscreet();
  const { period } = props;
  const tone = deltaTone(period.pnlUsd);
  const pulse = usePulseKey(period.pnlUsd);
  const amount = period.pnlUsd == null ? null : prefs.convert(period.pnlUsd);
  const pulseColor = tone === "gain" ? "rgb(34 197 94 / 0.16)" : tone === "loss" ? "rgb(244 63 94 / 0.16)" : "rgb(138 155 168 / 0.12)";
  return (
    <button
      type="button"
      role="listitem"
      onClick={props.onOpen}
      aria-label={`${props.long}: ${period.pnlUsd == null ? "not available" : discreet.mask(prefs.formatMoney(period.pnlUsd, { signed: true, whole: true }))}. Show breakdown`}
      className="group relative min-w-0 overflow-hidden rounded-ledger border border-border bg-card p-3 text-left transition-colors hover:border-border-strong active:scale-[0.99] sm:p-4 lg:flex lg:items-center lg:gap-4"
    >
      <span
        key={pulse}
        aria-hidden="true"
        className={cx("pointer-events-none absolute inset-0", pulse > 0 ? "animate-tint-pulse" : "")}
        style={{ "--pulse-color": pulseColor } as CSSProperties}
      />
      <span className="relative block min-w-0 lg:flex-1">
        <span className="flex items-center justify-between gap-1">
          <span className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">{props.label}</span>
          <Icon name="chevronRight" size={14} className="text-subtle transition-transform group-hover:translate-x-0.5 lg:hidden" />
        </span>
        <span
          className={cx(
            "mt-1 block truncate text-body font-semibold tabular sm:text-heading",
            tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : "text-foreground",
          )}
        >
          {amount == null ? "—" : prefs.money(period.pnlUsd, { signed: true, whole: true, compact: Math.abs(amount) >= 1_000_000 })}
        </span>
        <span className="mt-0.5 block text-micro text-muted-foreground tabular">
          {period.pct != null ? fmtSignedPct(period.pct) : period.basis === "none" ? "No history yet" : "—"}
        </span>
      </span>
      <Sparkline
        values={period.spark}
        tone={tone === "flat" ? "flat" : tone}
        width={96}
        height={28}
        className="relative mt-2 hidden w-full sm:block lg:mt-0 lg:w-24"
      />
      <Icon name="chevronRight" size={16} className="relative hidden text-subtle lg:block" />
    </button>
  );
}

function ImportProgress(props: { progress: number; className?: string }) {
  const status = useImportStatus();
  const state = status.data?.state;
  if (state === "complete" || state === "unavailable" || state === "error") return null;
  const progress = status.data?.progress ?? props.progress;
  const pct = Math.round(progress * 100);
  const blocked = blockedHistorySources(status.data?.sources);
  return (
    <div className={cx("rounded-ledger border border-border bg-card p-3.5", props.className)} role="status">
      <div className="flex items-center justify-between gap-3 text-caption">
        <span className="flex items-center gap-2 font-medium">
          <Icon name="history" size={16} className="text-primary" />
          Building history… {pct}%
        </span>
        <Link to="/settings/diagnostics" className="text-micro text-primary">
          Details
        </Link>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-card-elevated" aria-hidden="true">
        <div className="h-full origin-left rounded-full bg-primary transition-transform duration-500" style={{ transform: `scaleX(${Math.max(0.03, progress)})` }} />
      </div>
      {blocked.length > 0 ? <p className="mt-2 text-micro text-muted-foreground">Could not import {blocked.join(", ")}.</p> : null}
      <p className="mt-2 text-micro text-muted-foreground">P&L until now uses snapshots only, so deposits may count as gains until the import finishes.</p>
    </div>
  );
}

function BalanceStrip(props: { overview: PortfolioOverview; className?: string }) {
  const prefs = usePrefs();
  const { overview } = props;
  const band = worstProfileBand(overview);
  return (
    <Card className={props.className} padded={false}>
      <dl className="grid grid-cols-3 divide-x divide-border">
        <div className="min-w-0 px-3 py-3 sm:px-4">
          <dt className="text-micro font-medium uppercase tracking-wider text-muted-foreground">Assets</dt>
          <dd className="mt-1 truncate text-body font-semibold tabular">{prefs.money(overview.totals.assetsUsd, { compact: true })}</dd>
        </div>
        <div className="min-w-0 px-3 py-3 sm:px-4">
          <dt className="text-micro font-medium uppercase tracking-wider text-muted-foreground">Debt</dt>
          <dd className="mt-1 truncate text-body font-semibold tabular">{prefs.money(overview.totals.debtUsd, { compact: true })}</dd>
        </div>
        <div className="min-w-0 px-3 py-3 sm:px-4">
          <dt className="text-micro font-medium uppercase tracking-wider text-muted-foreground">LTV</dt>
          {overview.loans.ltv != null ? (
            <dd className="mt-1 min-w-0">
              <span className={cx("block truncate text-body font-semibold tabular", riskTextClass(band))}>{fmtPct(overview.loans.ltv)}</span>
              <span className={cx("mt-0.5 flex items-center gap-1 truncate text-micro font-medium", riskTextClass(band))}>
                <span aria-hidden="true" className="text-[0.7em]">
                  {BAND_SHAPES[band]}
                </span>
                {riskBandLabel(band)}
              </span>
            </dd>
          ) : (
            <dd className="mt-1 text-body text-muted-foreground">No loans</dd>
          )}
        </div>
      </dl>
    </Card>
  );
}

/** Worst band across profiles, each judged against its own target. */
function worstProfileBand(overview: PortfolioOverview): RiskBand {
  let worst: RiskBand = "healthy";
  let worstScore = -Infinity;
  for (const profile of overview.profiles) {
    if (profile.ltv == null || profile.debtUsd <= 0) continue;
    const target = profile.targetLtv ?? DEFAULT_TARGET_LTV;
    const score = riskSeverity(profile.ltv, target);
    if (score > worstScore) {
      worstScore = score;
      worst = riskBand(profile.ltv, target);
    }
  }
  return worst;
}

function AllocationCard(props: { overview: PortfolioOverview; className?: string }) {
  const prefs = usePrefs();
  const slices = props.overview.allocation;
  const top = slices.slice(0, 5);
  const otherPct = slices.slice(5).reduce((sum, slice) => sum + slice.pct, 0);
  const otherUsd = slices.slice(5).reduce((sum, slice) => sum + slice.usd, 0);
  const segments = otherPct > 0.05 ? [...top.map((slice, index) => ({ ...slice, color: assetColor(slice.asset, index) })), { asset: "Other", pct: otherPct, usd: otherUsd, qty: 0, color: "#3A4854" }] : top.map((slice, index) => ({ ...slice, color: assetColor(slice.asset, index) }));
  return (
    <Card className={props.className} aria-labelledby="allocation-title">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id="allocation-title" className="text-heading font-semibold">
            Allocation
          </h2>
          {props.overview.flags.includes("saved_snapshot") ? (
            <p className="mt-0.5 text-micro text-muted-foreground">Loan collateral from the saved snapshot. Spot wallets are not included.</p>
          ) : null}
        </div>
        <Link to="/portfolio" viewTransition className="inline-flex min-h-9 shrink-0 items-center gap-0.5 text-caption text-primary">
          All assets <Icon name="chevronRight" size={14} />
        </Link>
      </div>
      {segments.length === 0 ? (
        <p className="text-caption text-muted-foreground">
          {props.overview.flags.includes("saved_snapshot") ? "No collateral assets are in the saved snapshot." : "No balances were returned."}
        </p>
      ) : (
        <>
          <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
            {segments.map((segment, index) => (
              <span
                key={segment.asset}
                className="block h-full origin-left animate-grow-x rounded-full first:rounded-l-full last:rounded-r-full"
                style={{ width: `${Math.max(segment.pct, 0.8)}%`, background: segment.color, animationDelay: `${index * 60}ms` }}
              />
            ))}
          </div>
          <ul className="mt-4 grid grid-cols-1 gap-2.5 @[520px]:grid-cols-2 @[520px]:gap-x-6">
            {segments.map((segment) => (
              <li key={segment.asset} className="flex min-w-0 items-center gap-2.5">
                {segment.asset === "Other" ? (
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-card-elevated text-micro text-muted-foreground">…</span>
                ) : (
                  <AssetIcon asset={segment.asset} size={24} />
                )}
                <span className="min-w-0 flex-1 truncate text-caption font-medium">{segment.asset}</span>
                <span className="text-caption tabular text-muted-foreground">{fmtPct(segment.pct)}</span>
                <span className="w-20 text-right text-caption font-semibold tabular">{prefs.money(segment.usd, { compact: true })}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function MoversCard(props: { overview: PortfolioOverview; className?: string }) {
  const prefs = usePrefs();
  const movers = props.overview.movers;
  return (
    <Card className={props.className} aria-labelledby="movers-title">
      <div className="mb-2 flex items-center justify-between">
        <h2 id="movers-title" className="text-heading font-semibold">
          Top movers
        </h2>
        <span className="text-micro text-muted-foreground">24 hours</span>
      </div>
      {movers.length === 0 ? (
        <p className="py-2 text-caption text-muted-foreground">
          {props.overview.flags.includes("saved_snapshot")
            ? "24-hour price moves are not in the saved snapshot."
            : "No price changes were returned for your coins."}
        </p>
      ) : (
        <ul className="-mx-2 grid grid-cols-1 @[560px]:grid-cols-2 @[560px]:gap-x-4">
          {movers.map((mover) => (
            <li key={mover.asset}>
              <Link
                to={`/portfolio/${encodeURIComponent(mover.asset)}`}
                viewTransition
                className="flex min-h-14 items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-card-elevated"
              >
                <AssetIcon asset={mover.asset} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-medium">{mover.asset}</span>
                  <span className="block truncate text-caption text-muted-foreground tabular">{prefs.money(mover.priceUsd, { whole: mover.priceUsd >= 100 })}</span>
                </span>
                <span className="text-right">
                  <Delta pct={mover.change24hPct} currency={prefs.currency} />
                  <span className="block text-caption tabular text-muted-foreground">
                    {mover.pnl24hUsd != null ? prefs.money(mover.pnl24hUsd, { signed: true, whole: true }) : "—"}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const INSIGHT_STYLE: Record<InsightTone, { icon: IconName; className: string }> = {
  danger: { icon: "alert", className: "text-danger bg-danger/12" },
  warn: { icon: "alert", className: "text-warn bg-warn/12" },
  gain: { icon: "arrowUp", className: "text-gain bg-gain/12" },
  loss: { icon: "arrowDown", className: "text-loss bg-loss/12" },
  info: { icon: "sparkle", className: "text-muted-foreground bg-card-elevated" },
};

function InsightsCard(props: { insights: Insight[]; className?: string }) {
  return (
    <Card className={props.className} aria-labelledby="insights-title">
      <div className="mb-2 flex items-center justify-between">
        <h2 id="insights-title" className="text-heading font-semibold">
          Insights
        </h2>
        <Link to="/insights" viewTransition className="inline-flex min-h-9 items-center gap-0.5 text-caption text-primary">
          More <Icon name="chevronRight" size={14} />
        </Link>
      </div>
      {props.insights.length === 0 ? (
        <p className="py-2 text-caption text-muted-foreground">Nothing needs your attention right now.</p>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {props.insights.map((insight, index) => (
            <li key={insight.id} className="animate-rise-in" style={{ animationDelay: `${index * 60}ms` }}>
              <InsightRow insight={insight} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function InsightRow(props: { insight: Insight }) {
  const style = INSIGHT_STYLE[props.insight.tone];
  const body = (
    <>
      <span className={cx("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full", style.className)}>
        <Icon name={style.icon} size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body font-medium">
          <Balance text={props.insight.title} />
        </span>
        {props.insight.body ? (
          <span className="mt-0.5 block text-caption text-muted-foreground">
            <Balance text={props.insight.body} />
          </span>
        ) : null}
      </span>
      {props.insight.to ? <Icon name="chevronRight" size={16} className="mt-2 shrink-0 text-subtle" /> : null}
    </>
  );
  const className = "flex gap-3 rounded-xl px-2 py-2.5";
  return props.insight.to ? (
    <Link to={props.insight.to} viewTransition className={cx(className, "transition-colors hover:bg-card-elevated")}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

function LoansLink(props: { overview: PortfolioOverview; className?: string }) {
  const { overview } = props;
  if (overview.loans.count === 0) return null;
  const above = overview.profiles.filter((profile) => profile.ltv != null && profile.ltv >= (profile.targetLtv ?? DEFAULT_TARGET_LTV));
  const band = worstProfileBand(overview);
  const message =
    above.length > 0
      ? `${above.length} ${above.length === 1 ? "profile is" : "profiles are"} above target`
      : `${overview.loans.count} ${overview.loans.count === 1 ? "loan" : "loans"}, all within target`;
  return (
    <Link
      to="/loans"
      viewTransition
      className={cx(
        "flex min-h-14 items-center gap-3 rounded-ledger border px-4 py-3 transition-colors",
        band === "healthy" ? "border-border bg-card hover:border-border-strong" : band === "above" ? "border-warn/30 bg-warn/5" : "border-danger/40 bg-danger/10",
        props.className,
      )}
    >
      <Icon name="loans" size={20} className={band === "healthy" ? "text-muted-foreground" : band === "above" ? "text-warn" : "text-danger"} />
      <span className="min-w-0 flex-1">
        <span className="block text-body font-medium">Loans</span>
        <span className="block text-caption text-muted-foreground">{message}</span>
      </span>
      <Icon name="chevronRight" size={16} className="text-subtle" />
    </Link>
  );
}

function Provenance(props: { overview: PortfolioOverview; className?: string }) {
  const { overview } = props;
  const notes: ReactNode[] = [];
  if (overview.asOf) notes.push(<span key="asof">Snapshot {fmtDateTime(overview.asOf)}</span>);
  if (overview.fxUsdToZar) {
    notes.push(
      <span key="fx">
        <Balance text={`R${fmtNum(overview.fxUsdToZar, 2)}`} /> per $ ({overview.fxSource === "luno" ? "Luno" : overview.fxSource === "binance" ? "Binance" : "reference"})
      </span>,
    );
  }
  if (overview.import.state === "complete") notes.push(<span key="ledger">P&L from the full transaction history</span>);
  if (notes.length === 0) return null;
  return (
    <p className={cx("flex flex-wrap gap-x-3 gap-y-1 px-1 text-micro text-subtle", props.className)}>
      {notes}
    </p>
  );
}

function HomeSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5" aria-busy="true" aria-label="Loading net worth">
      <Card className="lg:col-span-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-3 h-10 w-64" />
        <Skeleton className="mt-3 h-4 w-40" />
        <Skeleton className="mt-6 h-[200px] w-full rounded-xl lg:h-[260px]" />
        <Skeleton className="mt-4 h-9 w-full max-w-[360px] rounded-full" />
      </Card>
      <div className="grid grid-cols-3 gap-2 lg:grid-cols-1 lg:gap-3">
        {[0, 1, 2].map((index) => (
          <Card key={index} className="p-3">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="mt-2 h-5 w-20" />
          </Card>
        ))}
      </div>
    </div>
  );
}
