import type {
  CgtEstimate,
  ImportStatus,
  LedgerEventView,
  PerformancePoint,
  PerformanceRange,
  PnlAttribution,
  PnlPeriod,
  PortfolioAnalytics,
  PortfolioAsset,
  PortfolioAssetDetail,
  PortfolioAssets,
  PortfolioOverview,
  PortfolioPerformance,
  PortfolioTotals,
} from "@workspace/api-zod";

import { cgtIfSoldToday, DEFAULT_CGT_METHOD, runCostBasis, summariseCgt, TOP_MARGINAL_RATE, type CgtMethod } from "./cgt";
import { eventInScope, inScope, scopeSet, type Derived } from "./derived";
import { NO_CONTAINER, carriedStatementUsd, containerKey, pointTotals, priceOf } from "./history";
import { repairPeresecHistory } from "./perecRepair";
import { overallState } from "./ledgerStore";
import { investmentLayers, type InvestmentLayer } from "./pickleRick";
import { eventUsd, modifiedDietz, scopeRow } from "./pnl";
import { parseBalanceKey } from "./reconstruct";
import { addDays, DAY_MS, HOUR_MS, jhbDay, jhbDayStart, jhbMonthStart, jhbWeekStart } from "./time";
import { STABLECOINS, type HistoryPoint, type LedgerEvent, type PortfolioState, type StatementSeries } from "./types";

const iso = (ms: number) => new Date(ms).toISOString();
const round = (value: number, dp = 2) => {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
};

function price(state: PortfolioState, asset: string): number {
  return priceOf(asset, state.prices, state.fx);
}

export function scopedTotals(state: PortfolioState, set: Set<string> | null): PortfolioTotals {
  let assets = 0;
  let debt = 0;
  for (const position of state.positions) {
    if (position.includeInTotal === false || !inScope(set, position.containerId)) continue;
    assets += position.qty * price(state, position.asset);
  }
  for (const loan of state.debts) if (inScope(set, loan.containerId)) debt += loan.qty * price(state, loan.asset);
  return { assetsUsd: round(assets), debtUsd: round(debt), netUsd: round(assets - debt) };
}

function ledgerCovers(derived: Derived, fromMs: number): boolean {
  const cursors = Object.values(derived.ledger?.cursors ?? {}).filter((cursor) => cursor.state !== "unavailable");
  if (cursors.length === 0) return false;
  return cursors.every((cursor) => cursor.backfillDone || (cursor.coveredFrom != null && cursor.coveredFrom <= fromMs));
}

function flowsBetween(derived: Derived, set: Set<string> | null, fromMs: number, toMs: number): number {
  let total = 0;
  const adjustments = derived.recon?.adjustments ?? [];
  for (const event of [...derived.events, ...adjustments]) {
    if (!event.external || event.t <= fromMs || event.t > toMs) continue;
    if (!eventInScope(derived, set, event)) continue;
    const usd = eventUsd(event, (asset, day) => derived.book.close(asset, day));
    total += event.debt ? -usd : usd;
  }
  return total;
}

function sumEvents(derived: Derived, set: Set<string> | null, fromMs: number, toMs: number, match: (event: LedgerEvent) => boolean): number {
  let total = 0;
  for (const event of derived.events) {
    if (event.t <= fromMs || event.t > toMs || !match(event) || !eventInScope(derived, set, event)) continue;
    const usd = eventUsd(event, (asset, day) => derived.book.close(asset, day));
    total += event.debt ? -usd : usd;
  }
  return total;
}

/** Net value at (or just before) an instant from 15-minute/hourly snapshots. */
function snapshotValueAt(points: HistoryPoint[], set: Set<string> | null, ms: number): { t: number; v: number } | null {
  let best: HistoryPoint | null = null;
  for (const point of points) {
    if (point.t <= ms && (!best || point.t > best.t)) best = point;
  }
  if (!best || ms - best.t > 3 * HOUR_MS) {
    const after = points.find((point) => point.t > ms && point.t - ms <= HOUR_MS);
    if (after) best = after;
    else if (!best || ms - best.t > 3 * HOUR_MS) return null;
  }
  const totals = pointTotals(best, set);
  return { t: best.t, v: totals.assets - totals.debt };
}

function seriesValueAtDayEnd(derived: Derived, set: Set<string> | null, day: string): number | null {
  if (!derived.series) return null;
  const index = derived.series.days.indexOf(day);
  if (index >= 0) return scopeRow(derived.series.rows[index], set).v;
  if (derived.series.days[0] && day < derived.series.days[0]) return scopeRow(derived.series.opening, set).v;
  return null;
}

/** Containers that hold anything in scope, including "none" for accounts outside a profile. */
function profileKeys(state: PortfolioState, set: Set<string> | null): string[] {
  const keys = new Set<string>();
  for (const container of state.containers) if (!set || set.has(container.id)) keys.add(container.id);
  for (const item of [...state.positions, ...state.debts]) {
    const key = containerKey(item.containerId);
    if (!set || set.has(key)) keys.add(key);
  }
  return [...keys];
}

function periodSpark(derived: Derived, set: Set<string> | null, startDay: string, start: number | null, end: number): number[] {
  const fromMs = jhbDayStart(startDay);
  const now = derived.state.asOf;
  const fromPoints = derived.points
    .filter((point) => point.t >= fromMs && point.t < now)
    .map((point) => {
      const totals = pointTotals(point, set);
      return totals.assets - totals.debt;
    });
  const fromSeries: number[] = [];
  if (derived.series) {
    const today = jhbDay(now);
    derived.series.days.forEach((day, index) => {
      if (day >= startDay && day < today) fromSeries.push(scopeRow(derived.series?.rows[index], set).v);
    });
  }
  const body = fromPoints.length >= 4 || fromPoints.length >= fromSeries.length ? fromPoints : fromSeries;
  const values = [...(start == null ? [] : [start]), ...body, end];
  return downsample(values, 48).map((value) => round(value));
}

function period(derived: Derived, set: Set<string> | null, startDay: string, nested = false): PnlPeriod {
  const { state } = derived;
  const fromMs = jhbDayStart(startDay);
  const now = state.asOf;
  const end = scopedTotals(state, set).netUsd;
  const covered = ledgerCovers(derived, fromMs);
  const fromSnapshot = snapshotValueAt(derived.points, set, fromMs);
  const fromSeries = seriesValueAtDayEnd(derived, set, addDays(startDay, -1));
  const start = fromSnapshot?.v ?? fromSeries;
  const basis: PnlPeriod["basis"] = start == null ? "none" : covered ? "ledger" : "snapshots";
  const flows = covered ? flowsBetween(derived, set, fromSnapshot?.t ?? fromMs, now) : 0;
  const byProfile = nested
    ? []
    : profileKeys(state, set).map((containerId) => ({
        containerId,
        pnlUsd: period(derived, new Set([containerId]), startDay, true).pnlUsd,
      }));
  const spark = nested ? [] : periodSpark(derived, set, startDay, start, end);
  if (start == null) {
    return {
      from: iso(fromMs),
      startUsd: null,
      endUsd: round(end),
      pnlUsd: null,
      pct: null,
      flowsUsd: round(flows),
      basis,
      attribution: null,
      byProfile,
      spark,
    };
  }
  const pnl = end - start - flows;
  let pct: number | null = Math.abs(start + 0.5 * flows) < 1 ? null : modifiedDietz(start, end, flows) * 100;
  if (covered && derived.series) {
    const today = jhbDay(now);
    let growth = 1;
    let previous = start;
    let usedSeries = false;
    for (let index = 0; index < derived.series.days.length; index++) {
      const day = derived.series.days[index] as string;
      if (day < startDay || day >= today) continue;
      const row = scopeRow(derived.series.rows[index], set);
      growth *= 1 + modifiedDietz(previous, row.v, row.f);
      previous = row.v;
      usedSeries = true;
    }
    if (usedSeries) {
      const todayFlows = flowsBetween(derived, set, jhbDayStart(today), now);
      growth *= 1 + modifiedDietz(previous, end, todayFlows);
      pct = (growth - 1) * 100;
    }
  }
  return {
    from: iso(fromMs),
    startUsd: round(start),
    endUsd: round(end),
    pnlUsd: round(pnl),
    pct: pct == null ? null : round(pct, 3),
    flowsUsd: round(flows),
    basis,
    attribution: covered && !nested ? attribution(derived, set, startDay, pnl) : null,
    byProfile,
    spark,
  };
}

/**
 * Market move per asset: whole days value the previous day's closing
 * balances at the day's price change; today uses live balances against
 * yesterday's close. Debt counts negatively.
 */
function marketByAsset(derived: Derived, set: Set<string> | null, startDay: string): Map<string, number> {
  const { state, recon, book } = derived;
  const today = jhbDay(state.asOf);
  const out = new Map<string, number>();
  const add = (asset: string, usd: number) => {
    if (Number.isFinite(usd) && usd !== 0) out.set(asset, (out.get(asset) ?? 0) + usd);
  };
  if (recon) {
    recon.days.forEach((day, index) => {
      if (day < startDay || day >= today) return;
      const prior = index > 0 ? recon.endOfDay[index - 1] : recon.opening;
      const previousDay = addDays(day, -1);
      for (const [key, qty] of prior ?? []) {
        const parsed = parseBalanceKey(key);
        if (set && !set.has(derived.linkContainer.get(parsed.linkId) ?? NO_CONTAINER)) continue;
        const signed = parsed.debt ? -qty : qty;
        add(parsed.asset, signed * (book.close(parsed.asset, day) - book.close(parsed.asset, previousDay)));
      }
    });
  }
  const yesterday = addDays(today, -1);
  for (const position of state.positions) {
    if (inScope(set, position.containerId)) add(position.asset, position.qty * (price(state, position.asset) - book.close(position.asset, yesterday)));
  }
  for (const loan of state.debts) {
    if (inScope(set, loan.containerId)) add(loan.asset, -loan.qty * (price(state, loan.asset) - book.close(loan.asset, yesterday)));
  }
  return out;
}

function attribution(derived: Derived, set: Set<string> | null, startDay: string, pnl: number): PnlAttribution {
  const { state } = derived;
  const byAsset = [...marketByAsset(derived, set, startDay).entries()]
    .map(([asset, usd]) => ({ asset, marketUsd: round(usd) }))
    .filter((item) => Math.abs(item.marketUsd) >= 0.01)
    .sort((a, b) => Math.abs(b.marketUsd) - Math.abs(a.marketUsd));
  const market = byAsset.reduce((sum, item) => sum + item.marketUsd, 0);
  const fromMs = jhbDayStart(startDay);
  const income = sumEvents(derived, set, fromMs, state.asOf, (event) => event.type === "income");
  const costs = sumEvents(derived, set, fromMs, state.asOf, (event) => event.type === "fee" || event.type === "interest");
  return {
    marketUsd: round(market),
    incomeUsd: round(income),
    costsUsd: round(costs),
    otherUsd: round(pnl - market - income - costs),
    byAsset: byAsset.slice(0, 12),
  };
}

function importSummary(derived: Derived): PortfolioOverview["import"] {
  const { state, progress } = overallState(derived.ledger);
  const earliest = derived.events.length > 0 ? iso(derived.events[0]?.t ?? 0) : null;
  return { state, progress: round(progress, 3), earliest, flaggedCount: derived.reconciliation.filter((row) => row.flagged).length };
}

export function buildOverview(derived: Derived, scope: string | undefined): PortfolioOverview {
  const { state } = derived;
  const { id, set } = scopeSet(state, scope);
  const totals = scopedTotals(state, set);
  const byAsset = new Map<string, { qty: number; usd: number }>();
  const byExchange = new Map<"binance" | "luno", { assetsUsd: number; debtUsd: number }>();
  const statementAssets = new Set(state.positions.filter((position) => position.exchange === "pickle_rick").map((position) => position.asset));
  for (const position of state.positions) {
    if (!inScope(set, position.containerId) || position.includeInTotal === false) continue;
    const usd = position.qty * price(state, position.asset);
    const entry = byAsset.get(position.asset) ?? { qty: 0, usd: 0 };
    entry.qty += position.qty;
    entry.usd += usd;
    byAsset.set(position.asset, entry);
    if (position.exchange !== "binance" && position.exchange !== "luno") continue;
    const exchange = byExchange.get(position.exchange) ?? { assetsUsd: 0, debtUsd: 0 };
    exchange.assetsUsd += usd;
    byExchange.set(position.exchange, exchange);
  }
  let collateralUsd = 0;
  let loanDebtUsd = 0;
  let dailyInterest = 0;
  let loanCount = 0;
  for (const loan of state.debts) {
    if (!inScope(set, loan.containerId)) continue;
    const debtUsd = loan.qty * price(state, loan.asset);
    const exchange = byExchange.get(loan.exchange) ?? { assetsUsd: 0, debtUsd: 0 };
    exchange.debtUsd += debtUsd;
    byExchange.set(loan.exchange, exchange);
    loanDebtUsd += debtUsd;
    collateralUsd += loan.collateralQty * price(state, loan.collateralAsset);
    dailyInterest += debtUsd * loan.hourlyRate * 24;
    loanCount += 1;
  }
  const gross = totals.assetsUsd > 0 ? totals.assetsUsd : 1;
  const allocation = [...byAsset.entries()]
    .map(([asset, entry]) => ({ asset, qty: entry.qty, usd: round(entry.usd), pct: round((entry.usd / gross) * 100, 2) }))
    .filter((slice) => slice.usd >= 0.01)
    .sort((a, b) => b.usd - a.usd);
  const movers = allocation
    .filter((slice) => !statementAssets.has(slice.asset) && !STABLECOINS.has(slice.asset) && slice.asset !== "ZAR" && slice.usd >= 1)
    .map((slice) => {
      const change = state.change24h[slice.asset];
      return {
        asset: slice.asset,
        usd: slice.usd,
        priceUsd: price(state, slice.asset),
        change24hPct: change == null ? null : round(change, 2),
        pnl24hUsd: change == null ? null : round(slice.usd - slice.usd / (1 + change / 100)),
      };
    })
    .sort((a, b) => Math.abs(b.change24hPct ?? 0) - Math.abs(a.change24hPct ?? 0))
    .slice(0, 6);
  const profiles = state.containers
    .filter((container) => !set || set.has(container.id))
    .map((container) => {
      const only = new Set([container.id]);
      const t = scopedTotals(state, only);
      let debt = 0;
      let collateral = 0;
      for (const loan of state.debts) {
        if (loan.containerId !== container.id) continue;
        debt += loan.qty * price(state, loan.asset);
        collateral += loan.collateralQty * price(state, loan.collateralAsset);
      }
      return {
        containerId: container.id,
        name: container.name,
        type: container.type,
        assetsUsd: t.assetsUsd,
        debtUsd: t.debtUsd,
        netUsd: t.netUsd,
        ltv: collateral > 0 ? round((debt / collateral) * 100, 2) : null,
        targetLtv: container.targetLtv,
      };
    });
  const weekAgo = state.asOf - 7 * DAY_MS;
  const recent = derived.points.filter((point) => point.t >= weekAgo);
  let sparkline = downsample(recent, 56).map((point) => {
    const t = pointTotals(point, set);
    return round(t.assets - t.debt);
  });
  if (sparkline.length < 2 && derived.series) {
    sparkline = derived.series.days.slice(-7).map((_, offset, list) => {
      const index = (derived.series?.days.length ?? 0) - list.length + offset;
      return round(scopeRow(derived.series?.rows[index], set).v);
    });
  }
  sparkline.push(totals.netUsd);
  const flags: string[] = [];
  if (state.fxSource === "reference") flags.push("fx_reference");
  if (state.fx == null) flags.push("fx_missing");
  if (state.errors.length > 0) flags.push("account_errors");
  const summary = importSummary(derived);
  if (summary.state !== "complete") flags.push("import_incomplete");
  if (summary.flaggedCount > 0) flags.push("reconciliation_flags");

  return {
    available: true,
    asOf: iso(state.asOf),
    scope: id,
    fxUsdToZar: state.fx,
    fxSource: state.fxSource,
    totals,
    today: period(derived, set, jhbDay(state.asOf)),
    week: period(derived, set, jhbWeekStart(state.asOf)),
    month: period(derived, set, jhbMonthStart(state.asOf)),
    allocation,
    movers,
    profiles,
    exchanges: [...byExchange.entries()].map(([exchange, entry]) => ({ exchange, assetsUsd: round(entry.assetsUsd), debtUsd: round(entry.debtUsd) })),
    loans: {
      count: loanCount,
      debtUsd: round(loanDebtUsd),
      collateralUsd: round(collateralUsd),
      ltv: collateralUsd > 0 ? round((loanDebtUsd / collateralUsd) * 100, 2) : null,
      dailyInterestUsd: round(dailyInterest),
    },
    sparkline,
    import: summary,
    flags,
  };
}

function downsample<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const out: T[] = [];
  const step = (items.length - 1) / (max - 1);
  for (let index = 0; index < max; index++) out.push(items[Math.round(index * step)] as T);
  return out;
}

/**
 * Thins a series without dropping a day that has only one point. Day closes
 * are kept first; leftover room is filled with the other samples.
 */
export function downsampleKeepingDays<T extends { t: string }>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const closeAt = new Map<string, number>();
  items.forEach((item, index) => {
    const day = jhbDay(Date.parse(item.t));
    const previous = closeAt.get(day);
    if (previous == null || Date.parse(item.t) >= Date.parse(items[previous]?.t ?? item.t)) closeAt.set(day, index);
  });
  const required = [...closeAt.values()].sort((a, b) => a - b).map((index) => items[index] as T);
  if (required.length >= max) return downsample(required, max);
  const keep = new Set(required);
  const picked = downsample(items.filter((item) => !keep.has(item)), max - required.length);
  const chosen = new Set<T>([...required, ...picked]);
  return items.filter((item) => chosen.has(item));
}

const RANGE_MS: Record<PerformanceRange, number | null> = {
  "1D": DAY_MS,
  "1W": 7 * DAY_MS,
  "1M": 30 * DAY_MS,
  "3M": 90 * DAY_MS,
  "1Y": 365 * DAY_MS,
  ALL: null,
};

interface RawPoint {
  t: number;
  assets: number;
  debt: number;
  fx: number | null;
}

export function buildPerformance(derived: Derived, range: PerformanceRange, scope: string | undefined): PortfolioPerformance {
  const { state } = derived;
  const { id, set } = scopeSet(state, scope);
  const span = RANGE_MS[range];
  const earliestSnapshot = derived.points[0]?.t ?? state.asOf;
  const earliestSeries = derived.series?.days[0] ? jhbDayStart(derived.series.days[0]) : null;
  const earliest = Math.min(earliestSnapshot, earliestSeries ?? earliestSnapshot);
  const fromMs = span == null ? earliest : Math.max(earliest, state.asOf - span);

  const history = repairPeresecHistory(derived.points, state.statementSeries).points;
  const snapshotPoints: RawPoint[] = history
    .filter((point) => point.t >= fromMs && point.t < state.asOf)
    .map((point) => {
      const totals = pointTotals(point, set);
      return { t: point.t, assets: totals.assets, debt: totals.debt, fx: point.fx };
    });
  const seriesPoints: RawPoint[] = [];
  if (derived.series) {
    derived.series.days.forEach((day, index) => {
      const t = jhbDayStart(day) + DAY_MS - 1;
      if (t < fromMs || t >= state.asOf) return;
      const row = scopeRow(derived.series?.rows[index], set);
      seriesPoints.push({ t, assets: row.a, debt: row.d, fx: derived.book.fx(day) });
    });
  }
  const wantsFine = range === "1D" || range === "1W";
  const snapshotCoverage = snapshotPoints.length > 0 ? (state.asOf - (snapshotPoints[0]?.t ?? state.asOf)) / Math.max(1, state.asOf - fromMs) : 0;
  let raw: RawPoint[];
  if (wantsFine || seriesPoints.length < 2) raw = snapshotPoints.length >= 2 || seriesPoints.length < 2 ? snapshotPoints : seriesPoints;
  else if (range === "1M" && snapshotCoverage > 0.8) raw = snapshotPoints;
  else raw = seriesPoints;
  if (raw === seriesPoints && (state.statementSeries?.length ?? 0) > 0) {
    raw = seriesPoints.map((point) => {
      const extra = carriedStatementUsd(state.statementSeries, set, jhbDay(point.t), point.fx ?? state.fx);
      return extra === 0 ? point : { ...point, assets: point.assets + extra };
    });
  }
  const now = scopedTotals(state, set);
  raw = [...raw, { t: state.asOf, assets: now.assetsUsd, debt: now.debtUsd, fx: state.fx }];

  const covered = ledgerCovers(derived, raw[0]?.t ?? fromMs);
  const basis: PortfolioPerformance["basis"] = raw.length < 2 ? "none" : covered ? "ledger" : "snapshots";
  const points: PerformancePoint[] = [];
  let cumulativeFlows = 0;
  let growth = 1;
  const first = raw[0] as RawPoint;
  const startValue = first.assets - first.debt;
  raw.forEach((point, index) => {
    const value = point.assets - point.debt;
    let flow = 0;
    if (index > 0) {
      const previous = raw[index - 1] as RawPoint;
      flow = covered ? flowsBetween(derived, set, previous.t, point.t) : 0;
      cumulativeFlows += flow;
      growth *= 1 + modifiedDietz(previous.assets - previous.debt, value, flow);
    }
    points.push({
      t: iso(point.t),
      netUsd: round(value),
      assetsUsd: round(point.assets),
      debtUsd: round(point.debt),
      flowUsd: round(flow),
      pnlUsd: round(value - startValue - cumulativeFlows),
      twrPct: round((growth - 1) * 100, 3),
      fx: point.fx,
    });
  });
  let peak = -Infinity;
  let maxDrawdown = 0;
  for (const point of points) {
    const indexValue = 1 + point.twrPct / 100;
    peak = Math.max(peak, indexValue);
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - indexValue) / peak);
  }
  const values = points.map((point) => point.netUsd);
  const last = points[points.length - 1];
  let rangeAttribution: PnlAttribution | null = null;
  if (covered && derived.series && last) {
    rangeAttribution = attribution(derived, set, jhbDay(first.t), last.pnlUsd);
  }
  return {
    available: points.length > 1,
    range,
    scope: id,
    basis,
    points: downsampleKeepingDays(points, 240),
    summary: {
      startUsd: points.length > 0 ? round(startValue) : null,
      endUsd: last?.netUsd ?? null,
      pnlUsd: last?.pnlUsd ?? null,
      twrPct: last?.twrPct ?? null,
      flowsUsd: round(cumulativeFlows),
      highUsd: values.length > 0 ? Math.max(...values) : null,
      lowUsd: values.length > 0 ? Math.min(...values) : null,
      maxDrawdownPct: points.length > 1 ? round(maxDrawdown * 100, 2) : null,
    },
    attribution: rangeAttribution,
  };
}

function isDrillLayerLink(linkId: string): boolean {
  return linkId.endsWith("|perec-weib") || linkId.endsWith("|perec-eib");
}

function costBases(derived: Derived, method: CgtMethod) {
  return runCostBasis({
    events: derived.events,
    linkContainer: derived.linkContainer,
    price: (asset, day) => derived.book.close(asset, day),
    fxOn: (day) => derived.book.fx(day),
    method,
  });
}

const QUOTE_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Date and currency for a Peresec asset-swap row. The date is `as_of`, or
 * the latest `perec-as` point when that day is later. The amount stays the
 * holding balance (`qty`), not a WEIB or EIB point.
 */
export function perecStatementQuote(
  state: Pick<PortfolioState, "statementSeries" | "positions">,
  asset: string,
): { date: string; currency: string } | null {
  const peresec =
    /peresec/i.test(asset) ||
    state.positions.some((position) => position.asset === asset && position.exchange === "pickle_rick" && /peresec/i.test(position.wallet));
  if (!peresec) return null;
  const known = state.positions.some(
    (position) =>
      position.asset === asset &&
      position.exchange === "pickle_rick" &&
      position.includeInTotal !== false &&
      position.balanceKnown !== false,
  );
  if (!known) return null;
  const series = (state.statementSeries ?? []).filter((item) => (item.kind ?? "as") === "as" && item.asset === asset);
  if (series.length === 0) return null;
  let date = "";
  let currency = "";
  for (const item of series) {
    if (!currency && item.currency) currency = item.currency;
    const asOf = item.asOf ?? "";
    if (QUOTE_DAY.test(asOf) && asOf >= date) {
      date = asOf;
      if (item.currency) currency = item.currency;
    }
    for (const point of item.points) {
      if (point.product !== "perec-as" || !QUOTE_DAY.test(point.date)) continue;
      if (point.date >= date) {
        date = point.date;
        currency = point.currency || item.currency || currency;
      }
    }
  }
  if (!date || (currency !== "USD" && currency !== "ZAR")) return null;
  return { date, currency };
}

const SIDE_PRODUCT = new Set(["perec-weib", "perec-eib", "weib", "eib"]);

/** Asset-swap series, or Interactive Brokers equity when that account has it. WEIB and EIB stay out. */
function balanceSeries(state: Pick<PortfolioState, "statementSeries">, asset: string, set: Set<string> | null): StatementSeries[] {
  const matched = (state.statementSeries ?? []).filter((item) => item.asset === asset && inScope(set, item.containerId));
  const equity = matched.filter((item) => item.kind === "ibkr");
  if (equity.length > 0) return equity;
  return matched.filter((item) => (item.kind ?? "as") === "as");
}

/**
 * One value per portal day. A later `perec-as` point replaces brokerage on
 * that day. Null values and side layers are left out rather than treated as zero.
 */
function datedBalances(series: readonly StatementSeries[]): { value: number }[] {
  const byDate = new Map<string, { value: number; product: string }>();
  for (const item of series) {
    for (const point of item.points) {
      if (SIDE_PRODUCT.has(point.product)) continue;
      if (typeof point.value !== "number" || !Number.isFinite(point.value)) continue;
      if (!QUOTE_DAY.test(point.date)) continue;
      const existing = byDate.get(point.date);
      if (existing?.product === "perec-as" && point.product !== "perec-as") continue;
      byDate.set(point.date, { value: point.value, product: point.product });
    }
  }
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, point]) => ({ value: point.value }));
}

/** Previous observation before `latest`. The same balance means the point before it; a newer balance uses the last recorded point. */
function priorOf(latest: number, points: readonly { value: number }[]): number | null {
  if (points.length === 0 || !Number.isFinite(latest)) return null;
  const last = points[points.length - 1]!;
  const same = Math.abs(last.value - latest) <= Math.max(1e-6, Math.abs(latest) * 1e-8);
  const prior = same ? points[points.length - 2]?.value : last.value;
  return prior != null && Number.isFinite(prior) && prior > 0 ? prior : null;
}

function snapshotBalances(points: readonly HistoryPoint[], asset: string, set: Set<string> | null): { value: number }[] {
  const byDay = new Map<string, { t: number; value: number }>();
  for (const point of points) {
    if (point.gapFill) continue;
    let value = 0;
    let seen = false;
    for (const [container, bucket] of Object.entries(point.h)) {
      if (!inScope(set, container)) continue;
      const amount = bucket[asset];
      if (typeof amount !== "number" || !Number.isFinite(amount)) continue;
      value += amount;
      seen = true;
    }
    if (!seen) continue;
    const day = jhbDay(point.t);
    const existing = byDay.get(day);
    if (!existing || point.t >= existing.t) byDay.set(day, { t: point.t, value });
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, point]) => ({ value: point.value }));
}

/**
 * Previous balance for a statement holding. Peresec uses the asset-swap
 * series. Interactive Brokers uses the equity total, not open positions.
 * WEIB and EIB are ignored. A holding with no series uses earlier snapshot
 * days, skipping gap-filled copies. Exchange coins that already have a
 * 24-hour ticker are left out. Null when there is no earlier point.
 */
export function statementPriorValue(
  state: Pick<PortfolioState, "statementSeries" | "positions" | "change24h">,
  points: readonly HistoryPoint[],
  asset: string,
  set: Set<string> | null,
  latest: number,
): number | null {
  if (state.change24h[asset] != null) return null;
  const series = balanceSeries(state, asset, set);
  if (series.length > 0) return priorOf(latest, datedBalances(series));
  const statement = state.positions.some(
    (position) =>
      position.asset === asset &&
      position.exchange === "pickle_rick" &&
      position.includeInTotal !== false &&
      inScope(set, position.containerId),
  );
  if (!statement) return null;
  return priorOf(latest, snapshotBalances(points, asset, set));
}

function assetRows(derived: Derived, set: Set<string> | null): PortfolioAsset[] {
  const { state } = derived;
  const totals = scopedTotals(state, set);
  const gross = totals.assetsUsd > 0 ? totals.assetsUsd : 1;
  const basis = derived.events.length > 0 ? costBases(derived, DEFAULT_CGT_METHOD) : null;
  const rows = new Map<string, PortfolioAsset>();
  const ensure = (asset: string): PortfolioAsset => {
    const existing = rows.get(asset);
    if (existing) return existing;
    const created: PortfolioAsset = {
      asset,
      qty: 0,
      usd: 0,
      priceUsd: price(state, asset),
      pct: 0,
      change24hPct: state.change24h[asset] ?? null,
      debtQty: 0,
      debtUsd: 0,
      costBasisUsd: null,
      unrealizedUsd: null,
      positions: [],
    };
    rows.set(asset, created);
    return created;
  };
  const nest: typeof state.positions = [];
  for (const position of state.positions) {
    if (!inScope(set, position.containerId)) continue;
    if (isDrillLayerLink(position.linkId) || position.includeInTotal === false) {
      if (position.parentLinkId) nest.push(position);
      continue;
    }
    const row = ensure(position.asset);
    const usd = position.qty * row.priceUsd;
    row.qty += position.qty;
    row.usd += usd;
    row.positions.push({
      exchange: position.exchange,
      linkId: position.linkId,
      linkName: position.linkName,
      containerId: position.containerId,
      wallet: position.wallet,
      qty: position.qty,
      usd: round(usd),
      ...(position.balanceKnown === false ? { balanceKnown: false } : {}),
    });
  }
  for (const position of nest) {
    const parent = state.positions.find((item) => item.linkId === position.parentLinkId);
    if (!parent || !inScope(set, parent.containerId) || !rows.has(parent.asset)) continue;
    const row = ensure(parent.asset);
    const usd = position.qty * price(state, position.asset);
    row.positions.push({
      exchange: position.exchange,
      linkId: position.linkId,
      linkName: position.linkName,
      containerId: position.containerId,
      wallet: position.wallet,
      qty: position.qty,
      usd: round(usd),
      includeInTotal: false,
      ...(position.balanceKnown === false ? { balanceKnown: false } : {}),
    });
  }
  for (const loan of state.debts) {
    if (!inScope(set, loan.containerId)) continue;
    const row = ensure(loan.asset);
    row.debtQty += loan.qty;
    row.debtUsd += loan.qty * row.priceUsd;
  }
  for (const row of rows.values()) {
    row.usd = round(row.usd);
    row.debtUsd = round(row.debtUsd);
    row.pct = round((row.usd / gross) * 100, 2);
    if (basis && row.asset !== "ZAR") {
      let cost = 0;
      let found = false;
      for (const [container, bucket] of basis.holdings) {
        if (set && !set.has(container)) continue;
        const entry = bucket.get(row.asset);
        if (!entry) continue;
        cost += entry.costUsd;
        found = true;
      }
      if (found) {
        row.costBasisUsd = round(cost);
        row.unrealizedUsd = round(row.usd - cost);
      }
    }
    const quote = perecStatementQuote(state, row.asset);
    if (quote) {
      row.quoteDate = quote.date;
      row.quoteCurrency = quote.currency;
    }
    const prior = statementPriorValue(state, derived.points, row.asset, set, row.qty);
    if (prior != null) row.priorValue = prior;
  }
  return [...rows.values()].sort((a, b) => b.usd - a.usd);
}

export function buildAssets(derived: Derived, scope: string | undefined): PortfolioAssets {
  const { id, set } = scopeSet(derived.state, scope);
  return { available: true, asOf: iso(derived.state.asOf), scope: id, fxUsdToZar: derived.state.fx, assets: assetRows(derived, set) };
}

function eventView(derived: Derived, event: LedgerEvent): LedgerEventView {
  const usd = typeof event.usd === "number" ? event.usd : event.qty * derived.book.close(event.asset, jhbDay(event.t));
  return {
    id: event.id.replace(/^(bn|luno):[^:]+:/, ""),
    t: iso(event.t),
    type: event.type,
    asset: event.asset,
    qty: event.debt ? -event.qty : event.qty,
    usd: Number.isFinite(usd) ? round(event.debt ? -usd : usd) : null,
    debt: event.debt === true,
    exchange: event.exchange,
    linkId: event.linkId,
    containerId: derived.linkContainer.get(event.linkId) ?? null,
    note: event.note ?? "",
  };
}

/**
 * Chart series for one holding. Interactive Brokers uses its equity history
 * and nothing else. Other holdings use the asset-swap series, not WEIB or EIB.
 */
function statementChart(state: Pick<PortfolioState, "statementSeries">, asset: string, set: Set<string> | null): StatementSeries[] {
  return balanceSeries(state, asset, set);
}

/**
 * First day this holding had a positive value. Statement series use the
 * earliest asset-swap point (not WEIB or EIB). An Interactive Brokers account
 * uses its own equity history. Reconstructed balances and snapshot days are
 * not cut to the chart's one-year window.
 */
function firstHoldingValue(derived: Derived, asset: string, set: Set<string> | null): { t: string; usd: number } | null {
  const { state } = derived;
  const statement = statementChart(state, asset, set);
  if (statement.length > 0) {
    const totals = new Map<string, number>();
    for (const item of statement) {
      for (const point of item.points) {
        if (typeof point.value !== "number" || !Number.isFinite(point.value)) continue;
        const currency = point.currency || item.currency;
        const px = currency === "USD" ? 1 : currency === "ZAR" && state.fx != null && state.fx > 0 ? 1 / state.fx : 0;
        if (!(px > 0)) continue;
        const t = iso(jhbDayStart(point.date) + DAY_MS - 1);
        totals.set(t, (totals.get(t) ?? 0) + round(point.value * px));
      }
    }
    const earliest = [...totals.entries()].filter(([, usd]) => usd > 0).sort(([a], [b]) => a.localeCompare(b))[0];
    return earliest ? { t: earliest[0], usd: earliest[1] } : null;
  }
  if (derived.recon) {
    for (let index = 0; index < derived.recon.days.length; index += 1) {
      const day = derived.recon.days[index] as string;
      let qty = 0;
      for (const [key, amount] of derived.recon.endOfDay[index] ?? []) {
        const parsed = parseBalanceKey(key);
        if (parsed.asset !== asset || parsed.debt) continue;
        const container = derived.linkContainer.get(parsed.linkId) ?? NO_CONTAINER;
        if (set && !set.has(container)) continue;
        qty += amount;
      }
      if (!(qty > 0)) continue;
      const usd = round(qty * derived.book.close(asset, day));
      if (usd > 0) return { t: iso(jhbDayStart(day) + DAY_MS - 1), usd };
    }
    return null;
  }
  let best: { t: number; usd: number } | null = null;
  for (const point of derived.points) {
    let qty = 0;
    for (const [container, bucket] of Object.entries(point.h)) {
      if (set && !set.has(container)) continue;
      qty += Math.max(0, bucket[asset] ?? 0);
    }
    if (!(qty > 0)) continue;
    const usd = round(qty * (point.p[asset] ?? priceOf(asset, point.p, point.fx)));
    if (!(usd > 0)) continue;
    if (!best || point.t < best.t) best = { t: point.t, usd };
  }
  return best ? { t: iso(best.t), usd: best.usd } : null;
}

function amountUsd(amount: number, currency: string, fx: number | null): number | null {
  const code = currency || "USD";
  const px = code === "USD" ? 1 : code === "ZAR" && fx != null && fx > 0 ? 1 / fx : 0;
  if (!(px > 0) || !Number.isFinite(amount)) return null;
  const usd = round(amount * px);
  return usd === 0 ? null : usd;
}

/**
 * External deposits and withdrawals for one holding, in USD.
 * A statement cash-flow ledger wins over reconstructed ledger events so the
 * same deposit is not removed twice. Dividends and fees are not included.
 */
function externalFlowsFor(derived: Derived, asset: string, set: Set<string> | null): { t: string; usd: number }[] {
  const chart = statementChart(derived.state, asset, set);
  if (chart.some((item) => item.flows != null)) {
    const out: { t: string; usd: number }[] = [];
    for (const item of chart) {
      for (const flow of item.flows ?? []) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(flow.date)) continue;
        const usd = amountUsd(flow.amount, flow.currency || item.currency, derived.state.fx);
        if (usd == null) continue;
        out.push({ t: iso(jhbDayStart(flow.date)), usd });
      }
    }
    return out;
  }
  const out: { t: string; usd: number }[] = [];
  for (const event of derived.events) {
    if (event.asset !== asset || event.external !== true || event.debt || event.id.startsWith("syn:")) continue;
    if (!eventInScope(derived, set, event)) continue;
    const usd = round(eventUsd(event, (name, day) => derived.book.close(name, day)));
    if (!Number.isFinite(usd) || usd === 0) continue;
    out.push({ t: iso(event.t), usd });
  }
  return out;
}

export function buildAssetDetail(derived: Derived, asset: string, scope?: string): PortfolioAssetDetail & {
  inside: InvestmentLayer | null;
  holdingOpened: { t: string; usd: number } | null;
  externalFlows: { t: string; usd: number }[];
} {
  const { state } = derived;
  const { set } = scopeSet(state, scope);
  const row = assetRows(derived, set).find((item) => item.asset === asset) ?? {
    asset,
    qty: 0,
    usd: 0,
    priceUsd: price(state, asset),
    pct: 0,
    change24hPct: state.change24h[asset] ?? null,
    debtQty: 0,
    debtUsd: 0,
    costBasisUsd: null,
    unrealizedUsd: null,
    positions: [],
  };
  const yearAgo = jhbDay(state.asOf - 365 * DAY_MS);
  const weekAgoMs = state.asOf - 7 * DAY_MS;
  const daily = derived.book.daily(asset);
  const priceHistory = Object.entries(daily)
    .filter(([day]) => day >= yearAgo && jhbDayStart(day) < weekAgoMs)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, usd]) => ({ t: iso(jhbDayStart(day) + DAY_MS - 1), usd }));
  for (const [t, usd] of derived.book.hourly(asset)) if (t >= weekAgoMs) priceHistory.push({ t: iso(t + HOUR_MS), usd });
  if (STABLECOINS.has(asset) && priceHistory.length === 0) priceHistory.push({ t: iso(state.asOf - 365 * DAY_MS), usd: 1 });
  priceHistory.push({ t: iso(state.asOf), usd: row.priceUsd });

  const holdingHistory: PortfolioAssetDetail["holdingHistory"] = [];
  const statement = statementChart(state, asset, set);
  if (statement.length > 0) {
    for (const item of statement) {
      for (const point of item.points) {
        if (typeof point.value !== "number" || !Number.isFinite(point.value)) continue;
        const currency = point.currency || item.currency;
        const px = currency === "USD" ? 1 : currency === "ZAR" && state.fx != null && state.fx > 0 ? 1 / state.fx : 0;
        if (!(px > 0)) continue;
        const container = containerKey(item.containerId);
        holdingHistory.push({
          t: iso(jhbDayStart(point.date) + DAY_MS - 1),
          qty: point.value,
          usd: round(point.value * px),
          byContainer: { [container]: point.value },
        });
      }
    }
    holdingHistory.sort((a, b) => a.t.localeCompare(b.t));
  } else if (derived.recon) {
    derived.recon.days.forEach((day, index) => {
      if (day < yearAgo) return;
      const byContainer: Record<string, number> = {};
      let qty = 0;
      for (const [key, amount] of derived.recon?.endOfDay[index] ?? []) {
        const parsed = parseBalanceKey(key);
        if (parsed.asset !== asset || parsed.debt) continue;
        const container = derived.linkContainer.get(parsed.linkId) ?? NO_CONTAINER;
        if (set && !set.has(container)) continue;
        byContainer[container] = (byContainer[container] ?? 0) + amount;
        qty += amount;
      }
      holdingHistory.push({ t: iso(jhbDayStart(day) + DAY_MS - 1), qty, usd: round(qty * derived.book.close(asset, day)), byContainer });
    });
  } else {
    for (const point of derived.points.filter((item) => item.t >= jhbDayStart(yearAgo))) {
      const byContainer: Record<string, number> = {};
      let qty = 0;
      for (const [container, bucket] of Object.entries(point.h)) {
        if (set && !set.has(container)) continue;
        const amount = Math.max(0, bucket[asset] ?? 0);
        if (amount > 0) byContainer[container] = amount;
        qty += amount;
      }
      holdingHistory.push({ t: iso(point.t), qty, usd: round(qty * (point.p[asset] ?? priceOf(asset, point.p, point.fx))), byContainer });
    }
  }

  const events = derived.events
    .filter((event) => event.asset === asset && !event.id.startsWith("syn:") && eventInScope(derived, set, event))
    .slice(-200)
    .reverse()
    .map((event) => eventView(derived, event));
  let costBasis: PortfolioAssetDetail["costBasis"] = null;
  if (derived.events.length > 0) {
    const basis = costBases(derived, DEFAULT_CGT_METHOD);
    let qty = 0;
    let cost = 0;
    let complete = true;
    for (const [container, bucket] of basis.holdings) {
      if (set && !set.has(container)) continue;
      const entry = bucket.get(asset);
      if (!entry) continue;
      qty += entry.qty;
      cost += entry.costUsd;
      complete &&= entry.complete;
    }
    const realized = basis.disposals.filter((item) => item.asset === asset && (!set || set.has(item.container))).reduce((sum, item) => sum + item.proceedsUsd - item.costUsd, 0);
    costBasis = {
      method: DEFAULT_CGT_METHOD,
      qty,
      totalCostUsd: round(cost),
      avgCostUsd: qty > 0 ? cost / qty : null,
      realizedUsd: round(realized),
      complete: complete && overallState(derived.ledger).state === "complete",
    };
  }
  const inside = investmentLayers(
    (state.statementSeries ?? []).filter((item) => inScope(set, item.containerId)),
    asset,
  );
  return {
    available: true,
    asset: row,
    priceHistory,
    holdingHistory,
    events,
    costBasis,
    fxUsdToZar: state.fx,
    inside,
    holdingOpened: firstHoldingValue(derived, asset, set),
    externalFlows: externalFlowsFor(derived, asset, set),
  };
}

export function buildImportStatus(derived: Derived | null, ledger: Derived["ledger"]): ImportStatus {
  const file = derived?.ledger ?? ledger;
  const { state, progress } = overallState(file);
  const linkContainer = derived?.linkContainer ?? new Map<string, string>();
  const notes: string[] = [];
  if (derived?.events.some((event) => event.id.startsWith("syn:flexint"))) notes.push("Flexible-loan interest is estimated from each loan's current rate.");
  if (derived && Object.values(derived.state.containers).length === 0) notes.push("No profiles are set up, so everything counts under one profile.");
  return {
    state,
    progress: round(progress, 3),
    startedAt: file?.startedAt ? iso(file.startedAt) : null,
    finishedAt: file?.finishedAt ? iso(file.finishedAt) : null,
    earliest: derived && derived.events.length > 0 ? iso(derived.events[0]?.t ?? 0) : null,
    eventCount: file?.events.length ?? 0,
    sources: Object.values(file?.cursors ?? {}).map((cursor) => ({
      exchange: cursor.exchange,
      linkId: cursor.linkId,
      linkName: cursor.linkName,
      source: cursor.source,
      state: cursor.state,
      rows: cursor.rows,
      coveredFrom: cursor.coveredFrom ? iso(cursor.coveredFrom) : null,
      coveredTo: cursor.coveredTo ? iso(cursor.coveredTo) : null,
      error: cursor.error,
    })),
    reconciliation: (derived?.reconciliation ?? [])
      .filter((row) => Math.abs(row.adjustmentUsd) >= 1)
      .slice(0, 50)
      .map((row) => {
        const parsed = parseBalanceKey(row.key);
        return {
          containerId: linkContainer.get(parsed.linkId) ?? null,
          linkId: parsed.linkId,
          asset: parsed.debt ? `${parsed.asset} (debt)` : parsed.asset,
          snapshotQty: row.snapshotQty,
          ledgerQty: row.ledgerQty,
          adjustmentQty: row.adjustmentQty,
          adjustmentUsd: round(row.adjustmentUsd),
          flagged: row.flagged,
        };
      }),
    notes,
  };
}

function stdev(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function dailyReturns(derived: Derived, set: Set<string> | null): number[] {
  if (derived.series) {
    const out: number[] = [];
    let previous = scopeRow(derived.series.opening, set).v;
    derived.series.rows.forEach((rowSet) => {
      const row = scopeRow(rowSet, set);
      if (Math.abs(previous) > 1) out.push(modifiedDietz(previous, row.v, row.f));
      previous = row.v;
    });
    return out;
  }
  const byDay = new Map<string, number>();
  for (const point of derived.points) {
    const totals = pointTotals(point, set);
    byDay.set(jhbDay(point.t), totals.assets - totals.debt);
  }
  const values = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value);
  const out: number[] = [];
  for (let index = 1; index < values.length; index++) {
    const previous = values[index - 1] as number;
    if (Math.abs(previous) > 1) out.push((values[index] as number) / previous - 1);
  }
  return out;
}

function assetLogReturns(derived: Derived, asset: string): number[] {
  const today = jhbDay(derived.state.asOf);
  const out: number[] = [];
  let previous: number | null = null;
  for (let offset = 365; offset >= 0; offset--) {
    const day = addDays(today, -offset);
    const close = derived.book.close(asset, day);
    if (close > 0 && previous && previous > 0) out.push(Math.log(close / previous));
    if (close > 0) previous = close;
  }
  return out.map((value) => round(value, 6));
}

/** Last 12 Johannesburg months of net external flows against market growth. */
function monthlyContributions(derived: Derived, set: Set<string> | null): PortfolioAnalytics["contributions"]["monthly"] {
  const series = derived.series;
  if (!series) return [];
  const months = new Map<string, { start: number; end: number; flows: number }>();
  let previous = scopeRow(series.opening, set).v;
  series.days.forEach((day, index) => {
    const row = scopeRow(series.rows[index], set);
    const key = day.slice(0, 7);
    const entry = months.get(key) ?? { start: previous, end: previous, flows: 0 };
    entry.end = row.v;
    entry.flows += row.f;
    months.set(key, entry);
    previous = row.v;
  });
  return [...months.entries()].slice(-12).map(([month, entry]) => ({
    month,
    contributedUsd: round(entry.flows),
    growthUsd: round(entry.end - entry.start - entry.flows),
    endUsd: round(entry.end),
  }));
}

export function buildAnalytics(derived: Derived, scope: string | undefined, method: CgtMethod): PortfolioAnalytics {
  const { state } = derived;
  const { id, set } = scopeSet(state, scope);
  const totals = scopedTotals(state, set);
  const gross = totals.assetsUsd > 0 ? totals.assetsUsd : 0;
  const now = state.asOf;

  let dailyInterest = 0;
  let weightedApr = 0;
  let debtTotal = 0;
  const loans: PortfolioAnalytics["loans"] = [];
  for (const loan of state.debts) {
    if (!inScope(set, loan.containerId)) continue;
    const debtUsd = loan.qty * price(state, loan.asset);
    dailyInterest += debtUsd * loan.hourlyRate * 24;
    weightedApr += debtUsd * loan.apr;
    debtTotal += debtUsd;
    loans.push({
      id: loan.loanId,
      containerId: loan.containerId,
      asset: loan.asset,
      collateralAsset: loan.collateralAsset,
      debtUsd: round(debtUsd),
      collateralUsd: round(loan.collateralQty * price(state, loan.collateralAsset)),
      ltv: loan.ltv,
      marginCallLtv: loan.marginCallLtv,
      liqLtv: loan.liqLtv,
      apr: loan.apr,
    });
  }
  const ledgerAvailable = derived.events.length > 0;
  const paid30 = ledgerAvailable ? -sumEvents(derived, set, now - 30 * DAY_MS, now, (event) => event.type === "interest") : null;

  const weights = new Map<string, number>();
  for (const position of state.positions) {
    if (!inScope(set, position.containerId)) continue;
    weights.set(position.asset, (weights.get(position.asset) ?? 0) + position.qty * price(state, position.asset));
  }
  let hhi = 0;
  let topAsset: string | null = null;
  let topUsd = 0;
  for (const [asset, usd] of weights) {
    if (gross > 0) hhi += (usd / gross) ** 2;
    if (usd > topUsd) {
      topUsd = usd;
      topAsset = asset;
    }
  }

  let deposited = 0;
  let withdrawn = 0;
  for (const event of [...derived.events, ...(derived.recon?.adjustments ?? [])]) {
    if (!event.external || !eventInScope(derived, set, event)) continue;
    const usd = eventUsd(event, (asset, day) => derived.book.close(asset, day));
    const signed = event.debt ? -usd : usd;
    if (signed >= 0) deposited += signed;
    else withdrawn -= signed;
  }
  const complete = overallState(derived.ledger).state === "complete";
  const openingValue = derived.series ? scopeRow(derived.series.opening, set).v : 0;

  const returns = dailyReturns(derived, set);
  const last30 = returns.slice(-30);
  const vol = stdev(last30);
  let peak = 1;
  let indexValue = 1;
  let maxDrawdown = 0;
  for (const value of returns) {
    indexValue *= 1 + value;
    peak = Math.max(peak, indexValue);
    maxDrawdown = Math.max(maxDrawdown, (peak - indexValue) / peak);
  }

  const basis = costBases(derived, method);
  const cgtSummary = summariseCgt({ disposals: basis.disposals, containerTypes: derived.containerTypes, containers: set, now, fxKnown: state.fx != null });
  let unrealized: number | null = null;
  let poolsComplete = true;
  if (ledgerAvailable) {
    let cost = 0;
    for (const [container, bucket] of basis.holdings) {
      if (set && !set.has(container)) continue;
      for (const [asset, entry] of bucket) {
        if (asset === "ZAR") continue;
        cost += entry.costUsd;
        poolsComplete &&= entry.complete;
      }
    }
    const value = [...weights.entries()].filter(([asset]) => asset !== "ZAR").reduce((sum, [, usd]) => sum + usd, 0);
    unrealized = value - cost;
  }
  const valuesZar = new Map<string, Map<string, number>>();
  if (state.fx != null) {
    for (const position of state.positions) {
      const container = containerKey(position.containerId);
      const bucket = valuesZar.get(container) ?? new Map<string, number>();
      bucket.set(position.asset, (bucket.get(position.asset) ?? 0) + position.qty * price(state, position.asset) * state.fx);
      valuesZar.set(container, bucket);
    }
  }
  const profiles =
    ledgerAvailable && state.fx != null
      ? cgtIfSoldToday({ disposals: basis.disposals, holdings: basis.holdings, values: valuesZar, containers: state.containers, scope: set, now }).map((profile) => ({
          ...profile,
          realizedGainZar: round(profile.realizedGainZar),
          unrealizedGainZar: round(profile.unrealizedGainZar),
          gainIfSoldZar: round(profile.gainIfSoldZar),
          taxableIfSoldZar: round(profile.taxableIfSoldZar),
          taxIfSoldZar: round(profile.taxIfSoldZar),
        }))
      : [];
  const cgt: CgtEstimate = {
    method,
    taxYear: cgtSummary.taxYear,
    profileType: cgtSummary.profileType,
    realizedGainUsd: round(cgtSummary.realizedGainUsd),
    realizedGainZar: cgtSummary.realizedGainZar == null ? null : round(cgtSummary.realizedGainZar),
    annualExclusionZar: cgtSummary.annualExclusionZar,
    inclusionRate: cgtSummary.inclusionRate,
    taxableGainZar: cgtSummary.taxableGainZar == null ? null : round(cgtSummary.taxableGainZar),
    unrealizedGainUsd: unrealized == null ? null : round(unrealized),
    disposals: cgtSummary.disposals,
    complete: ledgerAvailable && complete && poolsComplete,
    taxRate: TOP_MARGINAL_RATE,
    profiles,
    taxIfSoldZar: profiles.length > 0 ? round(profiles.reduce((sum, profile) => sum + profile.taxIfSoldZar, 0)) : null,
  };
  let stableUsd = 0;
  for (const [asset, usd] of weights) if (STABLECOINS.has(asset) || asset === "ZAR" || asset === "USD") stableUsd += usd;

  const debtByAsset = new Map<string, number>();
  for (const loan of state.debts) {
    if (!inScope(set, loan.containerId)) continue;
    debtByAsset.set(loan.asset, (debtByAsset.get(loan.asset) ?? 0) + loan.qty * price(state, loan.asset));
  }
  const returnAssets = new Set<string>([...debtByAsset.keys()]);
  for (const [asset, usd] of weights) if (gross > 0 && usd / gross >= 0.005) returnAssets.add(asset);
  const assetReturns = [...returnAssets].map((asset) => ({
    asset,
    weight: gross > 0 ? round((weights.get(asset) ?? 0) / gross, 6) : 0,
    debtWeight: gross > 0 ? round((debtByAsset.get(asset) ?? 0) / gross, 6) : 0,
    returns: STABLECOINS.has(asset) ? [] : assetLogReturns(derived, asset),
  }));

  return {
    available: true,
    asOf: iso(now),
    scope: id,
    fxUsdToZar: state.fx,
    totals,
    interest: {
      dailyUsd: round(dailyInterest),
      monthlyUsd: round(dailyInterest * 30),
      yearlyUsd: round(dailyInterest * 365),
      paidLast30dUsd: paid30 == null ? null : round(paid30),
      weightedApr: debtTotal > 0 ? round(weightedApr / debtTotal, 3) : null,
      dragPctOfAssets: gross > 0 ? round(((dailyInterest * 365) / gross) * 100, 3) : null,
    },
    concentration: {
      hhi: round(hhi, 4),
      effectiveAssets: hhi > 0 ? round(1 / hhi, 2) : 0,
      topAsset,
      topPct: gross > 0 ? round((topUsd / gross) * 100, 2) : 0,
    },
    contributions: {
      depositedUsd: round(deposited),
      withdrawnUsd: round(withdrawn),
      netContributedUsd: round(deposited - withdrawn),
      growthUsd: ledgerAvailable ? round(totals.netUsd - openingValue - (deposited - withdrawn)) : null,
      since: ledgerAvailable ? iso(derived.events[0]?.t ?? now) : null,
      basis: ledgerAvailable ? (complete ? "ledger" : "snapshots") : "none",
      monthly: monthlyContributions(derived, set),
    },
    income: {
      last30dUsd: round(sumEvents(derived, set, now - 30 * DAY_MS, now, (event) => event.type === "income")),
      last365dUsd: round(sumEvents(derived, set, now - 365 * DAY_MS, now, (event) => event.type === "income")),
    },
    risk: {
      volatility30dPct: vol == null ? null : round(vol * Math.sqrt(365) * 100, 2),
      maxDrawdownPct: returns.length > 1 ? round(maxDrawdown * 100, 2) : null,
      bestDayPct: returns.length > 0 ? round(Math.max(...returns) * 100, 2) : null,
      worstDayPct: returns.length > 0 ? round(Math.min(...returns) * 100, 2) : null,
      stablePct: gross > 0 ? round((stableUsd / gross) * 100, 2) : 0,
    },
    cgt,
    assetReturns,
    loans,
  };
}