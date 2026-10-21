import type {
  LoanHistoryPoint,
  LoanPosition,
  LoanProfile,
  PerformanceRange,
  PortfolioLoans,
} from "@workspace/api-zod";

import { inScope, scopeSet, type Derived } from "./derived";
import { NO_CONTAINER, containerKey, priceOf } from "./history";
import { DAY_MS } from "./time";
import type { HistoryPoint } from "./types";

/** Combined LTV recorded by the older LTV snapshot job (all profiles). */
export interface AggregateLtvPoint {
  t: string;
  ltv: number;
}

const RANGE_MS: Record<PerformanceRange, number | null> = {
  "1D": DAY_MS,
  "1W": 7 * DAY_MS,
  "1M": 30 * DAY_MS,
  "3M": 90 * DAY_MS,
  "1Y": 365 * DAY_MS,
  ALL: null,
};

const MAX_POINTS = 240;

const round = (value: number, dp = 2) => {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
};

const roundPrice = (value: number) => Number(value.toPrecision(8));

const ratio = (debt: number, collateral: number) => (collateral > 0 ? round((debt / collateral) * 100) : null);

/** Collateral price (USD) at which a loan reaches `ltv`, holding the debt value constant. */
export function triggerPrice(debtUsd: number, collateralQty: number, ltv: number | null): number | null {
  if (ltv == null || !(ltv > 0) || !(collateralQty > 0) || !(debtUsd > 0)) return null;
  return roundPrice(debtUsd / (collateralQty * (ltv / 100)));
}

/** Per-loan, per-profile and combined LTV in one history point, or null when the point predates loan history. */
export function pointLoanLtvs(
  point: HistoryPoint,
  set: Set<string> | null,
): Omit<LoanHistoryPoint, "t"> | null {
  if (!point.l) return null;
  let debt = 0;
  let collateral = 0;
  const loans: Record<string, number> = {};
  const byProfile = new Map<string, [number, number]>();
  for (const [loanId, [debtUsd, collateralUsd, key]] of Object.entries(point.l)) {
    if (set && !set.has(key)) continue;
    debt += debtUsd;
    collateral += collateralUsd;
    const loanLtv = ratio(debtUsd, collateralUsd);
    if (loanLtv != null) loans[loanId] = loanLtv;
    const totals = byProfile.get(key) ?? [0, 0];
    totals[0] += debtUsd;
    totals[1] += collateralUsd;
    byProfile.set(key, totals);
  }
  const profiles: Record<string, number> = {};
  for (const [key, [profileDebt, profileCollateral]] of byProfile) {
    const value = ratio(profileDebt, profileCollateral);
    if (value != null) profiles[key] = value;
  }
  return { ltv: ratio(debt, collateral), loans, profiles };
}

function downsample<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const out: T[] = [];
  const step = (items.length - 1) / (max - 1);
  for (let index = 0; index < max; index++) out.push(items[Math.round(index * step)] as T);
  return out;
}

/** The latest point at or before `ms` that carries loan history. */
function loanPointAt(points: HistoryPoint[], ms: number): HistoryPoint | null {
  let best: HistoryPoint | null = null;
  for (const point of points) {
    if (point.l && point.t <= ms && (!best || point.t > best.t)) best = point;
  }
  return best;
}

export function buildLoans(
  derived: Derived,
  range: PerformanceRange,
  scope: string | undefined,
  aggregate: AggregateLtvPoint[] = [],
): PortfolioLoans {
  const { state } = derived;
  const { id, set } = scopeSet(state, scope);
  const price = (asset: string) => priceOf(asset, state.prices, state.fx);
  const containers = new Map(state.containers.map((container) => [container.id, container]));
  const linkNames = new Map<string, string>();
  for (const position of state.positions) if (!linkNames.has(position.linkId)) linkNames.set(position.linkId, position.linkName);

  const weekAgo = loanPointAt(derived.points, state.asOf - 7 * DAY_MS);
  const weekAgoLtvs = weekAgo ? pointLoanLtvs(weekAgo, set) : null;

  const loans: LoanPosition[] = [];
  const profileTotals = new Map<string, { debt: number; collateral: number; count: number }>();
  let totalDebt = 0;
  let totalCollateral = 0;
  let dailyInterest = 0;
  for (const loan of state.debts) {
    if (!(loan.qty > 0) || !inScope(set, loan.containerId)) continue;
    const container = loan.containerId ? containers.get(loan.containerId) : undefined;
    const debtUsd = loan.qty * price(loan.asset);
    const collateralPrice = price(loan.collateralAsset);
    const collateralUsd = loan.collateralQty * collateralPrice;
    const ltv = ratio(debtUsd, collateralUsd) ?? loan.ltv;
    const targetLtv = container?.targetLtv ?? null;
    const before = weekAgoLtvs?.loans[loan.loanId];
    const loanDaily = debtUsd * loan.hourlyRate * 24;
    loans.push({
      loanId: loan.loanId,
      exchange: loan.exchange,
      linkId: loan.linkId,
      linkName: linkNames.get(loan.linkId) ?? (loan.exchange === "binance" ? "Binance" : "Luno"),
      containerId: loan.containerId,
      profileName: container?.name ?? null,
      asset: loan.asset,
      debtQty: loan.qty,
      debtUsd: round(debtUsd),
      collateralAsset: loan.collateralAsset,
      collateralQty: loan.collateralQty,
      collateralUsd: round(collateralUsd),
      collateralPriceUsd: collateralPrice > 0 ? roundPrice(collateralPrice) : null,
      ltv,
      marginCallLtv: loan.marginCallLtv,
      liqLtv: loan.liqLtv,
      targetLtv,
      apr: loan.apr,
      hourlyRate: loan.hourlyRate,
      dailyInterestUsd: round(loanDaily, 4),
      priceAtTargetUsd: triggerPrice(debtUsd, loan.collateralQty, targetLtv),
      priceAtMarginCallUsd: triggerPrice(debtUsd, loan.collateralQty, loan.marginCallLtv),
      priceAtLiquidationUsd: triggerPrice(debtUsd, loan.collateralQty, loan.liqLtv),
      ltvChange7d: before == null ? null : round(ltv - before),
    });
    const key = containerKey(loan.containerId);
    const totals = profileTotals.get(key) ?? { debt: 0, collateral: 0, count: 0 };
    totals.debt += debtUsd;
    totals.collateral += collateralUsd;
    totals.count += 1;
    profileTotals.set(key, totals);
    totalDebt += debtUsd;
    totalCollateral += collateralUsd;
    dailyInterest += loanDaily;
  }
  loans.sort((a, b) => b.ltv - a.ltv);

  const profiles: LoanProfile[] = [...profileTotals.entries()]
    .map(([key, totals]) => {
      const container = key === NO_CONTAINER ? undefined : containers.get(key);
      return {
        containerId: key === NO_CONTAINER ? null : key,
        name: container?.name ?? "Not in a profile",
        debtUsd: round(totals.debt),
        collateralUsd: round(totals.collateral),
        ltv: ratio(totals.debt, totals.collateral),
        targetLtv: container?.targetLtv ?? null,
        loanCount: totals.count,
      };
    })
    .sort((a, b) => (b.ltv ?? 0) - (a.ltv ?? 0));

  const span = RANGE_MS[range];
  const from = span == null ? -Infinity : state.asOf - span;
  const fromLoans: LoanHistoryPoint[] = [];
  for (const point of derived.points) {
    if (point.t < from || point.t >= state.asOf) continue;
    const ltvs = pointLoanLtvs(point, set);
    if (ltvs) fromLoans.push({ t: new Date(point.t).toISOString(), ...ltvs });
  }
  const now: LoanHistoryPoint = {
    t: new Date(state.asOf).toISOString(),
    ltv: ratio(totalDebt, totalCollateral),
    loans: Object.fromEntries(loans.map((loan) => [loan.loanId, loan.ltv])),
    profiles: Object.fromEntries(
      profiles.flatMap((profile) => (profile.ltv == null ? [] : [[profile.containerId ?? NO_CONTAINER, profile.ltv]])),
    ),
  };

  let history: LoanHistoryPoint[] = [...downsample(fromLoans, MAX_POINTS - 1), now];
  let historyBasis: PortfolioLoans["historyBasis"] = fromLoans.length > 0 ? "loans" : "none";
  if (fromLoans.length < 2 && id === "all" && aggregate.length > 0) {
    const earliestLoanMs = Date.parse(fromLoans[0]?.t ?? now.t);
    const older = aggregate
      .map((point) => ({ ms: Date.parse(point.t), ltv: point.ltv }))
      .filter((point) => Number.isFinite(point.ms) && point.ms >= from && point.ms < earliestLoanMs && Number.isFinite(point.ltv))
      .sort((a, b) => a.ms - b.ms)
      .map((point) => ({ t: new Date(point.ms).toISOString(), ltv: round(point.ltv), loans: {}, profiles: {} }));
    if (older.length > 0) {
      history = [...downsample([...older, ...fromLoans], MAX_POINTS - 1), now];
      historyBasis = "aggregate";
    }
  }
  if (loans.length === 0 && history.every((point) => point.ltv == null)) history = [];

  return {
    available: true,
    asOf: new Date(state.asOf).toISOString(),
    scope: id,
    range,
    fxUsdToZar: state.fx,
    totals: {
      count: loans.length,
      debtUsd: round(totalDebt),
      collateralUsd: round(totalCollateral),
      ltv: ratio(totalDebt, totalCollateral),
      dailyInterestUsd: round(dailyInterest),
    },
    loans,
    profiles,
    history,
    historyBasis,
  };
}
