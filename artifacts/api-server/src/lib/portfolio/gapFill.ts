import { logger } from "../logger";
import { invalidateDerived } from "./derived";
import { containerKey, NO_CONTAINER } from "./history";
import { readLedger } from "./ledgerStore";
import { readPortfolio, updateHistory } from "./portfolioStore";
import { linkContainerMap } from "./positions";
import { priceBook } from "./prices";
import { addDays, dayRange, HOUR_MS, jhbDay, jhbDayEnd, jhbDayStart } from "./time";
import { STABLECOINS, type HistoryPoint, type LedgerEvent, type StatementSeries } from "./types";

const NOON_MS = 12 * HOUR_MS;
/** Storage keys with this prefix are left untouched. */
const SKIP_PREFIX = "2ad8b0";

export interface GapFillInput {
  points: HistoryPoint[];
  events: readonly LedgerEvent[];
  linkContainer: ReadonlyMap<string, string>;
  series?: readonly StatementSeries[];
  price: (asset: string, day: string) => number;
  fx: (day: string) => number | null;
  nowMs: number;
}

export interface GapFillResult {
  points: HistoryPoint[];
  filled: string[];
}

interface Level {
  value: number;
  currency: string;
}

interface StatementCell {
  asset: string;
  container: string;
  currency: string;
  byDate: Map<string, Level>;
}

function round(value: number, dp: number): number {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

function unitUsd(currency: string, fx: number | null): number {
  if (currency === "USD") return 1;
  if (currency === "ZAR" && fx != null && fx > 0) return 1 / fx;
  return 0;
}

function carriedKey(container: string, asset: string): string {
  return `${container}|${asset}`;
}

function holdingKey(container: string, asset: string): string {
  return `${container}\n${asset}`;
}

function copyHoldings(source: HistoryPoint["h"]): HistoryPoint["h"] {
  const out: HistoryPoint["h"] = {};
  for (const [container, bucket] of Object.entries(source)) out[container] = { ...bucket };
  return out;
}

function setQty(holdings: HistoryPoint["h"], container: string, asset: string, qty: number): void {
  for (const [key, bucket] of Object.entries(holdings)) {
    if (key === container || bucket[asset] == null) continue;
    delete bucket[asset];
    if (Object.keys(bucket).length === 0) delete holdings[key];
  }
  const bucket = (holdings[container] ??= {});
  if (Math.abs(qty) < 1e-12) {
    delete bucket[asset];
    if (Object.keys(bucket).length === 0) delete holdings[container];
    return;
  }
  bucket[asset] = round(qty, 10);
}

function statementCells(series: readonly StatementSeries[] | undefined): StatementCell[] {
  const grouped = new Map<string, StatementCell>();
  for (const item of series ?? []) {
    if (item.kind !== "as") continue;
    const container = containerKey(item.containerId);
    const id = holdingKey(container, item.asset);
    const cell = grouped.get(id) ?? { asset: item.asset, container, currency: item.currency || "USD", byDate: new Map<string, Level>() };
    if (item.currency) cell.currency = item.currency;
    for (const point of item.points) {
      if (typeof point.value !== "number" || !Number.isFinite(point.value)) continue;
      cell.byDate.set(point.date, { value: point.value, currency: point.currency || cell.currency });
    }
    grouped.set(id, cell);
  }
  return [...grouped.values()];
}

function latestBefore(points: readonly HistoryPoint[], stamp: number): HistoryPoint | null {
  let best: HistoryPoint | null = null;
  for (const point of points) {
    if (point.t >= stamp) continue;
    if (!best || point.t > best.t) best = point;
  }
  return best;
}

function fillStamp(day: string): number {
  return jhbDayEnd(day) - 1;
}

/** A closed day still needs a point when nothing was recorded after noon, or the only late point is a statement stub. */
export function dayNeedsFill(points: readonly HistoryPoint[], day: string, today: string): boolean {
  if (day >= today) return false;
  const stamp = fillStamp(day);
  const onDay = points.filter((point) => jhbDay(point.t) === day);
  if (onDay.some((point) => point.gapFill === true)) return false;
  const noon = jhbDayStart(day) + NOON_MS;
  const late = onDay.filter((point) => point.t >= noon);
  if (late.length === 0) return true;
  return late.every((point) => point.t === stamp);
}

function addQty(holdings: HistoryPoint["h"], container: string, asset: string, delta: number): void {
  const bucket = (holdings[container] ??= {});
  const next = (bucket[asset] ?? 0) + delta;
  if (Math.abs(next) < 1e-12) {
    delete bucket[asset];
    if (Object.keys(bucket).length === 0) delete holdings[container];
    return;
  }
  bucket[asset] = round(next, 10);
}

function applyEvents(
  holdings: HistoryPoint["h"],
  events: readonly LedgerEvent[],
  linkContainer: ReadonlyMap<string, string>,
  touched: Set<string>,
): void {
  for (const event of events) {
    const container = linkContainer.get(event.linkId) ?? NO_CONTAINER;
    const delta = event.debt === true ? -event.qty : event.qty;
    addQty(holdings, container, event.asset, delta);
    touched.add(holdingKey(container, event.asset));
  }
}

function priorLevel(cell: StatementCell, day: string): Level | null {
  let bestDate = "";
  let best: Level | null = null;
  for (const [date, level] of cell.byDate) {
    if (date >= day || date < bestDate) continue;
    bestDate = date;
    best = level;
  }
  return best;
}

function valueHoldings(
  holdings: HistoryPoint["h"],
  currencyFor: Map<string, string>,
  price: (asset: string, day: string) => number,
  day: string,
  fx: number | null,
  baselinePrices: Record<string, number>,
): Pick<HistoryPoint, "a" | "d" | "h" | "c" | "p"> {
  let assets = 0;
  let debt = 0;
  const c: HistoryPoint["c"] = {};
  const p: Record<string, number> = {};
  for (const [container, bucket] of Object.entries(holdings)) {
    for (const [asset, qty] of Object.entries(bucket)) {
      const currency = currencyFor.get(holdingKey(container, asset)) ?? currencyFor.get(holdingKey("*", asset));
      let px = 0;
      if (currency) px = unitUsd(currency, fx);
      else if (STABLECOINS.has(asset) || asset === "USD") px = 1;
      else if (asset === "ZAR") px = fx != null && fx > 0 ? 1 / fx : 0;
      else px = price(asset, day) || baselinePrices[asset] || 0;
      if (!(px > 0)) continue;
      const usd = Math.abs(qty) * px;
      const totals = (c[container] ??= [0, 0]);
      if (qty >= 0) {
        totals[0] += usd;
        assets += usd;
      } else {
        totals[1] += usd;
        debt += usd;
      }
      if (!currency && !STABLECOINS.has(asset) && asset !== "ZAR") p[asset] = px;
    }
  }
  for (const [container, totals] of Object.entries(c)) c[container] = [round(totals[0], 2), round(totals[1], 2)];
  return { a: round(assets, 2), d: round(debt, 2), h: holdings, c, p };
}

function buildDay(input: GapFillInput, points: readonly HistoryPoint[], day: string, events: readonly LedgerEvent[]): HistoryPoint | null {
  const stamp = fillStamp(day);
  const baseline = latestBefore(points, stamp);
  const holdings = copyHoldings(baseline?.h ?? {});
  const touched = new Set<string>();
  const applicable = events.filter((event) => event.t > (baseline?.t ?? 0) && event.t <= stamp);
  applyEvents(holdings, applicable, input.linkContainer, touched);
  const cells = statementCells(input.series);
  const exact = new Set<string>();
  const currencyFor = new Map<string, string>();
  for (const cell of cells) {
    currencyFor.set(holdingKey(cell.container, cell.asset), cell.currency);
    currencyFor.set(holdingKey("*", cell.asset), cell.currency);
    const observed = cell.byDate.get(day);
    const level = observed ?? priorLevel(cell, day);
    if (!level) continue;
    currencyFor.set(holdingKey(cell.container, cell.asset), level.currency);
    setQty(holdings, cell.container, cell.asset, level.value);
    if (observed) exact.add(holdingKey(cell.container, cell.asset));
  }
  if (Object.keys(holdings).length === 0) return null;
  const fx = input.fx(day) ?? baseline?.fx ?? null;
  const valued = valueHoldings(holdings, currencyFor, input.price, day, fx, baseline?.p ?? {});
  const carried = Object.entries(valued.h)
    .flatMap(([container, bucket]) => Object.keys(bucket).map((asset) => ({ container, asset })))
    .filter(({ container, asset }) => !touched.has(holdingKey(container, asset)) && !exact.has(holdingKey(container, asset)))
    .map(({ container, asset }) => carriedKey(container, asset))
    .sort();
  return {
    t: stamp,
    ...valued,
    fx,
    gapFill: true,
    ...(carried.length > 0 ? { carried } : {}),
  };
}

/**
 * Inserts one end-of-day point for each closed Johannesburg day that has no
 * afternoon snapshot. Quantities come from imported ledger events, that day's
 * asset-swap series, or the previous real quantity. Running it again adds nothing.
 */
export function fillHistoryGaps(input: GapFillInput): GapFillResult {
  if (input.points.length === 0) return { points: [...input.points], filled: [] };
  const today = jhbDay(input.nowMs);
  const earliest = input.points.reduce((min, point) => Math.min(min, point.t), input.points[0]?.t ?? input.nowMs);
  const start = jhbDay(earliest);
  const end = addDays(today, -1);
  const points = [...input.points];
  const filled: string[] = [];
  for (const day of dayRange(start, end)) {
    if (!dayNeedsFill(points, day, today)) continue;
    const built = buildDay(input, points, day, input.events);
    if (!built) continue;
    const stamp = built.t;
    const kept = points.filter((point) => point.t !== stamp);
    kept.push(built);
    points.length = 0;
    points.push(...kept);
    filled.push(day);
  }
  points.sort((a, b) => a.t - b.t);
  return { points, filled };
}

/** True for every stored profile except the one this workspace must leave untouched. */
export function gapFillEnabled(hash: string): boolean {
  return !hash.startsWith(SKIP_PREFIX);
}

/** Fills closed days on one stored portfolio. A second call writes nothing. */
export async function fillPortfolioGaps(hash: string): Promise<string[]> {
  if (!gapFillEnabled(hash)) return [];
  const [portfolio, ledger] = await Promise.all([readPortfolio(hash), readLedger(hash)]);
  if (!portfolio?.latest || portfolio.points.length === 0) return [];
  const book = await priceBook({ prices: portfolio.latest.prices, fx: portfolio.latest.fx });
  const linkContainer = linkContainerMap(portfolio.latest.containers);
  let filled: string[] = [];
  const wrote = await updateHistory(hash, (file) => {
    if (!file.latest) return null;
    const result = fillHistoryGaps({
      points: file.points,
      events: ledger?.events ?? [],
      linkContainer,
      series: file.latest.statementSeries,
      price: (asset, day) => book.close(asset, day),
      fx: (day) => book.fx(day),
      nowMs: Date.now(),
    });
    filled = result.filled;
    return result.filled.length > 0 ? result.points : null;
  });
  if (wrote) invalidateDerived(hash);
  if (filled.length > 0) {
    logger.info({ op: "portfolio.gapfill", days: filled }, "filled portfolio days that had no afternoon snapshot");
  }
  return filled;
}
