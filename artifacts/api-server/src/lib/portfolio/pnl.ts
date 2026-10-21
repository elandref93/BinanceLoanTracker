import { NO_CONTAINER } from "./history";
import { parseBalanceKey, type Reconstruction } from "./reconstruct";
import { addDays, jhbDay } from "./time";
import type { LedgerEvent } from "./types";

export type DailyPrice = (asset: string, day: string) => number;

/** One profile's figures for one Johannesburg day, all USD. */
export interface DayRow {
  /** Net value at end of day (assets minus debt). */
  v: number;
  a: number;
  d: number;
  /** External flows in (positive) or out (negative). */
  f: number;
  inc: number;
  cost: number;
  mkt: number;
}

export interface DailySeries {
  days: string[];
  rows: Array<Record<string, DayRow>>;
  /** Opening balances valued at the close of the day before the first day. */
  opening: Record<string, DayRow>;
}

const emptyRow = (): DayRow => ({ v: 0, a: 0, d: 0, f: 0, inc: 0, cost: 0, mkt: 0 });

export function eventUsd(event: LedgerEvent, price: DailyPrice): number {
  if (typeof event.usd === "number" && Number.isFinite(event.usd)) return Math.sign(event.qty) * Math.abs(event.usd);
  return event.qty * price(event.asset, jhbDay(event.t));
}

function netByContainer(balances: Map<string, number>, linkContainer: Map<string, string>): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const [key, qty] of balances) {
    if (qty === 0) continue;
    const { linkId, asset, debt } = parseBalanceKey(key);
    const container = linkContainer.get(linkId) ?? NO_CONTAINER;
    const bucket = out.get(container) ?? new Map<string, number>();
    bucket.set(asset, (bucket.get(asset) ?? 0) + (debt ? -qty : qty));
    out.set(container, bucket);
  }
  return out;
}

/**
 * Values every day: V = Σ quantity × close − Σ debt × close, and splits the
 * daily change into external flows, income, costs, and market moves. The
 * rest (spreads, rounding) is "other" = ΔV − flows − income − costs − market.
 */
export function buildDailySeries(input: {
  recon: Reconstruction;
  events: LedgerEvent[];
  linkContainer: Map<string, string>;
  price: DailyPrice;
}): DailySeries {
  const { recon, linkContainer, price } = input;
  const byDay = new Map<string, LedgerEvent[]>();
  for (const event of [...input.events, ...recon.adjustments]) {
    const day = jhbDay(event.t);
    const list = byDay.get(day) ?? [];
    list.push(event);
    byDay.set(day, list);
  }
  const rows: Array<Record<string, DayRow>> = [];
  let previousNet = netByContainer(recon.opening, linkContainer);
  const opening: Record<string, DayRow> = {};
  const openingDay = recon.days[0] ? addDays(recon.days[0], -1) : null;
  if (openingDay) {
    for (const [container, bucket] of previousNet) {
      const entry = emptyRow();
      for (const [asset, qty] of bucket) {
        const usd = qty * price(asset, openingDay);
        if (qty >= 0) entry.a += usd;
        else entry.d -= usd;
      }
      entry.v = entry.a - entry.d;
      opening[container] = entry;
    }
  }
  recon.days.forEach((day, index) => {
    const balances = recon.endOfDay[index] ?? new Map<string, number>();
    const net = netByContainer(balances, linkContainer);
    const previousDay = addDays(day, -1);
    const row: Record<string, DayRow> = {};
    const containers = new Set([...net.keys(), ...previousNet.keys()]);
    for (const container of containers) {
      const current = net.get(container) ?? new Map<string, number>();
      const prior = previousNet.get(container) ?? new Map<string, number>();
      const entry = emptyRow();
      for (const [asset, qty] of current) {
        const usd = qty * price(asset, day);
        if (qty >= 0) entry.a += usd;
        else entry.d -= usd;
      }
      entry.v = entry.a - entry.d;
      for (const [asset, qty] of prior) {
        entry.mkt += qty * (price(asset, day) - price(asset, previousDay));
      }
      row[container] = entry;
    }
    for (const event of byDay.get(day) ?? []) {
      const container = linkContainer.get(event.linkId) ?? NO_CONTAINER;
      const entry = (row[container] ??= emptyRow());
      const usd = eventUsd(event, price);
      const signed = event.debt ? -usd : usd;
      if (event.external) entry.f += signed;
      else if (event.type === "income") entry.inc += signed;
      else if (event.type === "fee" || event.type === "interest") entry.cost += signed;
    }
    rows.push(row);
    previousNet = net;
  });
  return { days: recon.days, rows, opening };
}

export function scopeRow(row: Record<string, DayRow> | undefined, containers: Set<string> | null): DayRow {
  const out = emptyRow();
  if (!row) return out;
  for (const [container, entry] of Object.entries(row)) {
    if (containers && !containers.has(container)) continue;
    out.v += entry.v;
    out.a += entry.a;
    out.d += entry.d;
    out.f += entry.f;
    out.inc += entry.inc;
    out.cost += entry.cost;
    out.mkt += entry.mkt;
  }
  return out;
}

/** Modified Dietz return for one interval, flows assumed mid-interval. */
export function modifiedDietz(startValue: number, endValue: number, flows: number): number {
  const denominator = startValue + 0.5 * flows;
  if (Math.abs(denominator) < 1e-6) return 0;
  return (endValue - startValue - flows) / denominator;
}

export interface PeriodResult {
  startUsd: number | null;
  endUsd: number | null;
  pnlUsd: number | null;
  /** Chained time-weighted return, percent. */
  twrPct: number | null;
  flowsUsd: number;
  marketUsd: number;
  incomeUsd: number;
  costsUsd: number;
  otherUsd: number;
}

/**
 * Sums whole days from `fromDay` to the last day of the series. The start
 * value is the end of the day before `fromDay`.
 */
export function periodFromSeries(series: DailySeries, containers: Set<string> | null, fromDay: string): PeriodResult {
  const startIndex = series.days.findIndex((day) => day >= fromDay);
  if (startIndex < 0) {
    return { startUsd: null, endUsd: null, pnlUsd: null, twrPct: null, flowsUsd: 0, marketUsd: 0, incomeUsd: 0, costsUsd: 0, otherUsd: 0 };
  }
  const baseRow = scopeRow(startIndex > 0 ? series.rows[startIndex - 1] : series.opening, containers);
  let previous = baseRow.v;
  const startUsd: number | null = baseRow.v;
  let growth = 1;
  let flows = 0;
  let market = 0;
  let income = 0;
  let costs = 0;
  let endUsd = previous;
  for (let index = startIndex; index < series.days.length; index++) {
    const row = scopeRow(series.rows[index], containers);
    growth *= 1 + modifiedDietz(previous, row.v, row.f);
    flows += row.f;
    market += row.mkt;
    income += row.inc;
    costs += row.cost;
    previous = row.v;
    endUsd = row.v;
  }
  const pnl = endUsd - baseRow.v - flows;
  return {
    startUsd,
    endUsd,
    pnlUsd: pnl,
    twrPct: (growth - 1) * 100,
    flowsUsd: flows,
    marketUsd: market,
    incomeUsd: income,
    costsUsd: costs,
    otherUsd: pnl - market - income - costs,
  };
}
