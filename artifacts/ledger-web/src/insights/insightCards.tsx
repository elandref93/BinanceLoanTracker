import type { CgtMethod, CgtProfileEstimate, LoanPosition, PortfolioAnalytics, PortfolioAsset } from "@workspace/api-client-react";
import { useMemo, useState, type ReactNode } from "react";

import { fmtDate, fmtDisplayMoney, fmtNum, fmtPct, fmtSignedMoney, fmtSignedPct, MINUS } from "@/domain/format";
import { riskBand, riskBandLabel } from "@/domain/risk";
import {
  breakEvenGrowth,
  distanceToDanger,
  diversificationScore,
  stressPortfolio,
  type StressMode,
} from "@/insights/insightsModel";
import { LoanIcon, loanTitle } from "@/loans/LoanDetail";
import { loanTarget } from "@/loans/loanModel";
import { useAnalytics, usePerformance } from "@/portfolio/queries";
import { isSavedSnapshot } from "@/portfolio/snapshotFlags";
import { Balance, useDiscreet } from "@/prefs/DiscreetMode";
import { usePrefs } from "@/prefs/PreferencesProvider";
import { assetColor } from "@/theme/ledgerColors";
import { AssetIcon, displaySymbol } from "@/ui/AssetIcon";
import {
  BAND_SHAPES,
  Button,
  Card,
  cx,
  Delta,
  Notice,
  ProfileBadge,
  riskTextClass,
  SectionHeader,
  Segmented,
  Skeleton,
  SourceTag,
  Stat,
} from "@/ui/primitives";

const STRESS_PRESETS = [10, 20, 30, 50];

function zar(value: number | null | undefined, signed = false): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return signed ? fmtSignedMoney(value, "ZAR", { whole: true }) : fmtDisplayMoney(value, "ZAR", { whole: true });
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

export function StressCard(props: { assets: PortfolioAsset[] | null; loans: LoanPosition[]; savedSnapshot?: boolean }) {
  const prefs = usePrefs();
  const discreet = useDiscreet();
  const [mode, setMode] = useState<StressMode>("crypto");
  const [drop, setDrop] = useState(30);
  const result = useMemo(() => (props.assets ? stressPortfolio(props.assets, props.loans, mode, drop) : null), [props.assets, props.loans, mode, drop]);
  const what = mode === "btc" ? "BTC" : "crypto";
  return (
    <Card className="animate-rise-in [animation-delay:80ms]" aria-label="Stress test">
      <SectionHeader
        title="Stress test"
        caption="A sudden fall, with nothing else changing"
        action={
          <Segmented
            label="What falls"
            size="sm"
            options={[
              { value: "crypto", label: "All crypto" },
              { value: "btc", label: "BTC only" },
            ]}
            value={mode}
            onChange={setMode}
            className="w-44"
          />
        }
      />
      {props.savedSnapshot ? (
        <p className="py-6 text-caption text-muted-foreground">A portfolio stress test is not in the saved snapshot. Loan LTV against the margin-call and liquidation bands is below.</p>
      ) : result ? (
        <>
          <p className="text-caption text-muted-foreground">
            Net worth if {what} falls {fmtPct(drop, 0)}
          </p>
          <p className="mt-1 text-[26px] font-semibold leading-8 tracking-tight tabular">{prefs.money(result.netAfter, { whole: true })}</p>
          <Delta amount={prefs.convert(result.changeUsd)} pct={result.changePct} currency={prefs.currency} />
          <label className="mt-4 block">
            <span className="sr-only">{what} price fall, percent</span>
            <input
              type="range"
              min={0}
              max={70}
              step={1}
              value={drop}
              onChange={(event) => setDrop(Number(event.target.value))}
              aria-valuetext={`${what} down ${fmtPct(drop, 0)}, net worth ${discreet.mask(prefs.formatMoney(result.netAfter, { whole: true }))}`}
              className="ledger-range w-full"
              data-no-pull
            />
          </label>
          <div className="mt-1 flex justify-between text-micro text-subtle tabular">
            <span>0</span>
            <span>{MINUS}35%</span>
            <span>{MINUS}70%</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {STRESS_PRESETS.map((preset) => (
              <Button key={preset} size="sm" variant={drop === preset ? "primary" : "secondary"} onClick={() => setDrop(preset)}>
                {MINUS}
                {preset}%
              </Button>
            ))}
          </div>
          {props.loans.length > 0 ? (
            <ul className="mt-4 divide-y divide-border border-t border-border">
              {result.loans.map((item) => {
                const loan = props.loans.find((candidate) => candidate.loanId === item.loanId);
                if (!loan) return null;
                const target = loanTarget(loan);
                const band = riskBand(item.ltv, target);
                return (
                  <li key={item.loanId} className="flex items-center gap-3 py-2.5">
                    <LoanIcon loan={loan} size={26} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-medium">{loanTitle(loan)}</span>
                      <span className="block truncate text-caption text-muted-foreground tabular">
                        {fmtPct(item.before)} today · target {fmtPct(target, 0)}
                      </span>
                    </span>
                    <span className={cx("shrink-0 text-right tabular", riskTextClass(band))}>
                      <span className="block text-body font-semibold">{Number.isFinite(item.ltv) ? fmtPct(item.ltv) : "—"}</span>
                      <span className="flex items-center justify-end gap-1 text-micro font-semibold">
                        <span aria-hidden="true" className="text-[0.7em]">
                          {BAND_SHAPES[band]}
                        </span>
                        {riskBandLabel(band)}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </>
      ) : (
        <Skeleton className="h-40 w-full rounded-xl" />
      )}
    </Card>
  );
}

function DangerTrack(props: { marginDropPct: number | null; liqDropPct: number | null }) {
  const liq = Math.max(0, Math.min(100, 100 - (props.liqDropPct ?? 0)));
  const margin = Math.max(liq, Math.min(100, 100 - (props.marginDropPct ?? 0)));
  return (
    <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-card-elevated" aria-hidden="true">
      <span className="absolute inset-y-0 left-0 bg-danger/70" style={{ width: `${liq}%` }} />
      <span className="absolute inset-y-0 bg-danger/30" style={{ left: `${liq}%`, width: `${margin - liq}%` }} />
      <span className="absolute inset-y-0 bg-ok/40 animate-grow-x origin-left" style={{ left: `${margin}%`, width: `${100 - margin}%` }} />
    </div>
  );
}

export function DangerCard(props: { loans: LoanPosition[] }) {
  const prefs = usePrefs();
  const rows = distanceToDanger(props.loans);
  const priced = rows.some((row) => row.marginDropPct != null || row.liqDropPct != null);
  if (!priced) {
    return (
      <Card className="animate-rise-in [animation-delay:120ms]" aria-label="Distance to danger">
        <SectionHeader title="Distance to danger" caption="Loan LTV against the margin-call and liquidation bands. Price distance is not in the saved snapshot." />
        <ul className="divide-y divide-border">
          {props.loans.map((loan) => {
            const target = loanTarget(loan);
            const band = riskBand(loan.ltv, target);
            return (
              <li key={loan.loanId} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <LoanIcon loan={loan} size={26} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium">{loanTitle(loan)}</span>
                  <span className="block truncate text-caption text-muted-foreground tabular">
                    Margin call {fmtPct(loan.marginCallLtv, 0)} · Liquidation {fmtPct(loan.liqLtv, 0)}
                  </span>
                </span>
                <span className={cx("shrink-0 text-right tabular", riskTextClass(band))}>
                  <span className="block text-body font-semibold">{fmtPct(loan.ltv)}</span>
                  <span className="flex items-center justify-end gap-1 text-micro font-semibold">
                    <span aria-hidden="true" className="text-[0.7em]">
                      {BAND_SHAPES[band]}
                    </span>
                    {riskBandLabel(band)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
    );
  }
  return (
    <Card className="animate-rise-in [animation-delay:120ms]" aria-label="Distance to danger">
      <SectionHeader title="Distance to danger" caption="How far each collateral can fall before its first loan is hit" />
      <ul className="divide-y divide-border">
        {rows.map((row) => {
          const symbol = displaySymbol(row.asset);
          return (
            <li key={row.asset} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-center gap-3">
                <AssetIcon asset={row.asset} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-medium">{symbol}</span>
                  <span className="block text-caption text-muted-foreground tabular">
                    Now {row.priceUsd != null ? prefs.money(row.priceUsd, { whole: row.priceUsd >= 100 }) : "—"}
                    {row.loanCount > 1 ? ` · ${row.loanCount} loans` : ""}
                  </span>
                </span>
              </div>
              <DangerTrack marginDropPct={row.marginDropPct} liqDropPct={row.liqDropPct} />
              <dl className="mt-2 grid grid-cols-2 gap-3 text-caption">
                <div>
                  <dt className={cx("flex items-center gap-1 font-semibold", riskTextClass("margin"))}>
                    <span aria-hidden="true" className="text-[0.7em]">
                      {BAND_SHAPES.margin}
                    </span>
                    Margin call
                  </dt>
                  <dd className="mt-0.5 tabular">
                    <span className="block text-body font-semibold">{row.marginPriceUsd != null ? prefs.money(row.marginPriceUsd, { whole: row.marginPriceUsd >= 100 }) : "—"}</span>
                    <span className="text-muted-foreground">{dropText(row.marginDropPct)}</span>
                  </dd>
                </div>
                <div>
                  <dt className={cx("flex items-center gap-1 font-semibold", riskTextClass("liquidation"))}>
                    <span aria-hidden="true" className="text-[0.7em]">
                      {BAND_SHAPES.liquidation}
                    </span>
                    Liquidation
                  </dt>
                  <dd className="mt-0.5 tabular">
                    <span className="block text-body font-semibold">{row.liqPriceUsd != null ? prefs.money(row.liqPriceUsd, { whole: row.liqPriceUsd >= 100 }) : "—"}</span>
                    <span className="text-muted-foreground">{dropText(row.liqDropPct)}</span>
                  </dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function dropText(drop: number | null): string {
  if (drop == null) return "Not available";
  if (drop <= 0) return "Already past";
  return `${MINUS}${fmtPct(drop)} away`;
}

export function InterestDragCard(props: { analytics: PortfolioAnalytics; loans: LoanPosition[]; savedSnapshot?: boolean }) {
  const prefs = usePrefs();
  const performance = usePerformance("1Y");
  const { interest } = props.analytics;
  const breakEven = breakEvenGrowth(props.loans.length > 0 ? props.loans : props.analytics.loans);
  const summary = performance.data?.summary ?? null;
  if (props.analytics.loans.length === 0) {
    return (
      <Card className="animate-rise-in [animation-delay:160ms]" aria-label="Interest drag">
        <SectionHeader title="Interest drag" />
        <p className="text-caption text-muted-foreground">No open loans, so nothing is eating into returns.</p>
      </Card>
    );
  }
  return (
    <Card className="animate-rise-in [animation-delay:160ms]" aria-label="Interest drag">
      <SectionHeader title="Interest drag" caption={interest.weightedApr != null ? `${fmtPct(interest.weightedApr, 2)} a year, debt-weighted` : undefined} />
      {breakEven != null ? (
        <div className="rounded-xl bg-card-elevated px-3.5 py-3">
          <p className="text-caption text-muted-foreground">Collateral needs to grow</p>
          <p className="mt-0.5 text-[24px] font-semibold leading-8 tracking-tight tabular">{fmtPct(breakEven, 2)} a year</p>
          <p className="text-caption text-muted-foreground">just to cover the interest (APR × debt ÷ collateral)</p>
        </div>
      ) : null}
      <div className="mt-4">
        <Rows
          rows={[
            {
              label: "Interest a year",
              value: prefs.money(interest.yearlyUsd, { whole: true }),
              hint: <>{prefs.money(interest.dailyUsd, { whole: interest.dailyUsd >= 100 })} a day</>,
            },
            {
              label: "Paid in the last 30 days",
              value: interest.paidLast30dUsd != null ? prefs.money(interest.paidLast30dUsd, { whole: true }) : "—",
              hint: interest.paidLast30dUsd == null ? (props.savedSnapshot ? "Not in the saved snapshot" : "Needs the ledger import") : undefined,
            },
            {
              label: "Drag on assets",
              value: interest.dragPctOfAssets != null ? `${fmtPct(interest.dragPctOfAssets, 2)} a year` : "—",
              hint: props.savedSnapshot ? "yearly interest ÷ the saved snapshot total" : "yearly interest ÷ everything you hold",
            },
            {
              label: "Portfolio, last 12 months",
              value:
                summary?.twrPct != null ? (
                  <span className={summary.twrPct >= 0 ? "text-gain" : "text-loss"}>{fmtSignedPct(summary.twrPct, 1)}</span>
                ) : performance.isPending ? (
                  <Skeleton className="ml-auto h-4 w-14 rounded" />
                ) : (
                  "—"
                ),
              hint:
                summary?.pnlUsd != null ? (
                  <>{prefs.money(summary.pnlUsd, { signed: true, whole: true })} after interest</>
                ) : props.savedSnapshot ? (
                  "Not in the saved snapshot"
                ) : undefined,
            },
          ]}
        />
      </div>
    </Card>
  );
}

export function RiskProfileCard(props: { analytics: PortfolioAnalytics; savedSnapshot?: boolean }) {
  const { risk } = props.analytics;
  const pending = props.savedSnapshot ? "Not in the saved snapshot" : "Builds up with history";
  return (
    <Card className="animate-rise-in [animation-delay:200ms]" aria-label="Risk profile">
      <SectionHeader title="Risk profile" caption="How bumpy the ride has been" />
      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 @[420px]:grid-cols-3">
        <Stat
          label="Volatility"
          value={risk.volatility30dPct != null ? fmtPct(risk.volatility30dPct, 0) : "—"}
          hint={risk.volatility30dPct != null ? "a year, from the last 30 days" : pending}
        />
        <Stat
          label="Max drawdown"
          value={risk.maxDrawdownPct != null ? <span className="text-loss">{MINUS}{fmtPct(risk.maxDrawdownPct)}</span> : "—"}
          hint={risk.maxDrawdownPct != null ? "deepest fall from a peak" : pending}
        />
        <Stat label="Stablecoins and cash" value={fmtPct(risk.stablePct)} hint={props.savedSnapshot ? "of loan collateral in the saved snapshot" : "of what you hold"} />
        <Stat
          label="Best day"
          value={risk.bestDayPct != null ? <span className="text-gain">{fmtSignedPct(risk.bestDayPct)}</span> : "—"}
          hint={risk.bestDayPct == null ? pending : undefined}
        />
        <Stat
          label="Worst day"
          value={risk.worstDayPct != null ? <span className="text-loss">{fmtSignedPct(risk.worstDayPct)}</span> : "—"}
          hint={risk.worstDayPct == null ? pending : undefined}
        />
      </dl>
      <p className="mt-4 text-micro text-muted-foreground">
        {props.savedSnapshot ? "Volatility and daily moves are not in the saved snapshot." : "Daily returns of net worth with deposits and withdrawals taken out."}
      </p>
    </Card>
  );
}

export function ConcentrationCard(props: { analytics: PortfolioAnalytics; assets: PortfolioAsset[] | null; savedSnapshot?: boolean }) {
  const { concentration, totals } = props.analytics;
  const score = diversificationScore(concentration.hhi);
  const top = (props.assets ?? []).filter((asset) => asset.usd > 0).slice(0, 5);
  const gross = totals.assetsUsd > 0 ? totals.assetsUsd : 1;
  return (
    <Card className="animate-rise-in [animation-delay:240ms]" aria-label="Concentration">
      <SectionHeader title="Concentration" caption={props.savedSnapshot ? "Loan collateral in the saved snapshot, not spot wallets" : "How much rides on one asset"} />
      {concentration.topAsset ? (
        <div className="flex items-center gap-3">
          <AssetIcon asset={concentration.topAsset} size={36} />
          <p className="min-w-0 text-body">
            <span className="font-semibold tabular">{fmtPct(concentration.topPct)}</span> of {props.savedSnapshot ? "loan collateral" : "your assets"} is {displaySymbol(concentration.topAsset)}
          </p>
        </div>
      ) : null}
      <div className="mt-4">
        <div className="flex items-baseline justify-between">
          <span className="text-caption text-muted-foreground">Diversification score</span>
          <span className="text-body font-semibold tabular">{score} / 100</span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-card-elevated">
          <span className="block h-full origin-left rounded-full bg-primary animate-grow-x" style={{ width: `${score}%` }} />
        </div>
        <p className="mt-1.5 text-micro text-muted-foreground">
          Spread like {fmtNum(concentration.effectiveAssets, 1)} equal holdings (from the Herfindahl index of your weights).
        </p>
      </div>
      {top.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {top.map((asset, index) => {
            const pct = (asset.usd / gross) * 100;
            return (
              <li key={asset.asset} className="grid grid-cols-[3.5rem_minmax(0,1fr)_3.5rem] items-center gap-2 text-caption">
                <span className="truncate font-medium">{displaySymbol(asset.asset)}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-card-elevated">
                  <span className="block h-full origin-left rounded-full animate-grow-x" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: assetColor(asset.asset, index) }} />
                </span>
                <span className="text-right tabular text-muted-foreground">{fmtPct(pct)}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </Card>
  );
}

const monthFormat = new Intl.DateTimeFormat("en-ZA", { month: "short", timeZone: "Africa/Johannesburg" });
const monthYearFormat = new Intl.DateTimeFormat("en-ZA", { month: "long", year: "numeric", timeZone: "Africa/Johannesburg" });

function monthDate(month: string): Date {
  return new Date(`${month}-15T12:00:00Z`);
}

export function ContributionsCard(props: { analytics: PortfolioAnalytics; savedSnapshot?: boolean; className?: string }) {
  const prefs = usePrefs();
  const discreet = useDiscreet();
  const { contributions } = props.analytics;
  const months = contributions.monthly;
  const [selected, setSelected] = useState<number | null>(null);
  const activeIndex = selected ?? months.length - 1;
  const active = months[activeIndex] ?? null;
  const max = Math.max(1, ...months.flatMap((month) => [Math.abs(month.contributedUsd), Math.abs(month.growthUsd)]));
  return (
    <Card className={cx("animate-rise-in [animation-delay:280ms]", props.className)} aria-label="Contributions and growth">
      <SectionHeader
        title="Contributions and growth"
        caption={props.savedSnapshot ? "Not in the saved snapshot" : contributions.since ? `Since ${fmtDate(contributions.since)}` : "Needs the ledger import"}
        action={contributions.basis === "snapshots" ? <SourceTag tone="warn">Import still running</SourceTag> : null}
      />
      {props.savedSnapshot ? (
        <p className="text-caption text-muted-foreground">Deposits, withdrawals, and market growth are not in the saved snapshot.</p>
      ) : (
      <>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 @[560px]:grid-cols-4">
        <Stat label="You put in" value={prefs.money(contributions.netContributedUsd, { whole: true })} hint="deposits less withdrawals" />
        <Stat
          label="Markets added"
          value={
            contributions.growthUsd != null ? (
              <span className={contributions.growthUsd >= 0 ? "text-gain" : "text-loss"}>{prefs.money(contributions.growthUsd, { signed: true, whole: true })}</span>
            ) : (
              "—"
            )
          }
          hint="growth after interest and fees"
        />
        <Stat label="Deposited" value={prefs.money(contributions.depositedUsd, { whole: true })} />
        <Stat label="Withdrawn" value={prefs.money(contributions.withdrawnUsd, { whole: true })} />
      </dl>
      {months.length > 0 ? (
        <div className="mt-5">
          <div className="flex h-40 items-stretch gap-1 sm:gap-2" role="group" aria-label="Monthly contributions and growth">
            {months.map((month, index) => {
              const label = `${monthYearFormat.format(monthDate(month.month))}: put in ${discreet.mask(prefs.formatMoney(month.contributedUsd, { whole: true }))}, markets ${discreet.mask(prefs.formatMoney(month.growthUsd, { signed: true, whole: true }))}`;
              return (
                <button
                  key={month.month}
                  type="button"
                  aria-label={label}
                  aria-pressed={index === activeIndex}
                  onClick={() => setSelected(index)}
                  className={cx(
                    "relative flex min-w-0 flex-1 flex-col rounded-lg transition-colors",
                    index === activeIndex ? "bg-card-elevated" : "hover:bg-card-elevated/60",
                  )}
                >
                  <MonthBars contributed={month.contributedUsd} growth={month.growthUsd} max={max} />
                </button>
              );
            })}
          </div>
          <div className="mt-1 flex gap-1 sm:gap-2" aria-hidden="true">
            {months.map((month) => (
              <span key={month.month} className="min-w-0 flex-1 truncate text-center text-micro text-subtle">
                {monthFormat.format(monthDate(month.month))}
              </span>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-caption" aria-live="polite">
            <span className="flex items-center gap-4 text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-primary" aria-hidden="true" />
                Put in
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-gain" aria-hidden="true" />
                Markets
              </span>
            </span>
            {active ? (
              <span className="tabular">
                <span className="font-semibold">{monthYearFormat.format(monthDate(active.month))}</span>
                <span className="text-muted-foreground"> · put in </span>
                {prefs.money(active.contributedUsd, { signed: true, whole: true })}
                <span className="text-muted-foreground"> · markets </span>
                <span className={active.growthUsd >= 0 ? "text-gain" : "text-loss"}>{prefs.money(active.growthUsd, { signed: true, whole: true })}</span>
                <span className="text-muted-foreground"> · ended at </span>
                {prefs.money(active.endUsd, { whole: true })}
              </span>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="mt-4 text-caption text-muted-foreground">The month-by-month split appears once the history import has rebuilt your balances.</p>
      )}
      </>
      )}
    </Card>
  );
}

function MonthBars(props: { contributed: number; growth: number; max: number }) {
  const height = (value: number) => `${(Math.abs(value) / props.max) * 50}%`;
  const bar = (value: number, color: string) => (
    <span className="relative h-full w-full max-w-3">
      <span
        className={cx("absolute inset-x-0 rounded-sm", color)}
        style={value >= 0 ? { bottom: "50%", height: height(value) } : { top: "50%", height: height(value) }}
      />
    </span>
  );
  return (
    <span className="relative flex h-full w-full items-stretch justify-center gap-0.5 px-0.5 py-1">
      <span className="absolute inset-x-0 top-1/2 h-px bg-border-strong" aria-hidden="true" />
      {bar(props.contributed, "bg-primary")}
      {bar(props.growth, props.growth >= 0 ? "bg-gain" : "bg-loss")}
    </span>
  );
}

export function CgtCard(props: { className?: string }) {
  const [method, setMethod] = useState<CgtMethod>("fifo");
  const query = useAnalytics(method);
  const savedSnapshot = isSavedSnapshot(query.data);
  const cgt = query.data?.available ? query.data.cgt : null;
  return (
    <Card className={cx("animate-rise-in [animation-delay:320ms]", props.className)} aria-label="Capital gains tax estimate">
      <SectionHeader
        title="Capital gains tax if sold today"
        caption={savedSnapshot ? "Not in the saved snapshot" : cgt?.taxYear ? `SARS tax year ${cgt.taxYear} (1 March to end February)` : "SARS tax year"}
        action={
          <Segmented
            label="Cost-basis method"
            size="sm"
            options={[
              { value: "fifo", label: "FIFO" },
              { value: "weighted", label: "Weighted avg" },
            ]}
            value={method}
            onChange={setMethod}
            className="w-52"
          />
        }
      />
      {savedSnapshot ? (
        <p className="text-caption text-muted-foreground">Cost basis and capital gains are not in the saved snapshot.</p>
      ) : !cgt ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : cgt.profiles.length === 0 ? (
        <p className="text-caption text-muted-foreground">
          {query.data?.fxUsdToZar == null ? "Needs a rand exchange rate, which isn't available right now." : "Needs the ledger import to know what you paid."}
        </p>
      ) : (
        <div className={cx("transition-opacity duration-200", query.isPlaceholderData ? "opacity-60" : "opacity-100")}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-caption text-muted-foreground">Estimated tax if everything were sold today</p>
              <p className="mt-1 text-[28px] font-semibold leading-9 tracking-tight tabular">
                <Balance text={zar(cgt.taxIfSoldZar)} />
              </p>
            </div>
            <SourceTag tone="estimate">Estimate, not tax advice</SourceTag>
          </div>
          <div className="mt-4 grid gap-3 @[640px]:grid-cols-2">
            {cgt.profiles.map((profile) => (
              <CgtProfile key={profile.containerId ?? "none"} profile={profile} rate={cgt.taxRate} />
            ))}
          </div>
          {!cgt.complete ? (
            <Notice tone="warn" className="mt-4" title="Some costs are estimated">
              Coins that arrived from outside Binance or Luno are costed at their market value on the day they arrived, and gaps in the history are filled the same way. The real
              gain may differ.
            </Notice>
          ) : null}
          <p className="mt-4 text-micro text-muted-foreground">
            {method === "fifo" ? "FIFO: the oldest coins count as sold first." : "Weighted average: every coin of an asset carries the same average cost."} Individuals get the R40 000
            annual exclusion, then 40% of the gain is taxable. Trusts include 80% with no exclusion. Tax is shown at {fmtPct(cgt.taxRate * 100, 0)}: the trust rate and the top
            individual rate, so an individual's real bill is often lower. Losses brought forward are not included.
          </p>
        </div>
      )}
    </Card>
  );
}

function CgtProfile(props: { profile: CgtProfileEstimate; rate: number }) {
  const { profile } = props;
  return (
    <div className="rounded-xl border border-border bg-background/40 p-3.5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-body font-semibold">{profile.name}</span>
        <ProfileBadge type={profile.type === "trust" ? "trust" : "personal"} />
      </div>
      <Rows
        rows={[
          { label: "Realised this tax year", value: <Balance text={zar(profile.realizedGainZar, true)} /> },
          { label: "Open gain", value: <Balance text={zar(profile.unrealizedGainZar, true)} />, hint: "value today less cost" },
          ...(profile.annualExclusionZar > 0
            ? [{ label: "Annual exclusion", value: <Balance text={`${MINUS}${zar(profile.annualExclusionZar)}`} /> }]
            : []),
          { label: `Taxable (${fmtPct(profile.inclusionRate * 100, 0)} included)`, value: <Balance text={zar(profile.taxableIfSoldZar)} /> },
          {
            label: `Tax at ${fmtPct(props.rate * 100, 0)}`,
            value: (
              <span className="font-semibold">
                <Balance text={zar(profile.taxIfSoldZar)} />
              </span>
            ),
            hint: profile.complete ? undefined : "some costs estimated",
          },
        ]}
      />
    </div>
  );
}
