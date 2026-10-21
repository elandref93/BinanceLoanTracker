import { childProfileForLabel, isChildProfileId } from "./childProfiles";
import { DAY_MS, HOUR_MS, jhbDay, jhbDayEnd } from "./time";
import { STABLECOINS, type HistoryPoint, type PortfolioState, type StatementSeries } from "./types";

const FIFTEEN_MIN_RETENTION_MS = 7 * DAY_MS;
const HOURLY_RETENTION_MS = 90 * DAY_MS;

export const NO_CONTAINER = "none";

function round(value: number, dp: number): number {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

/** USD price of an asset in a state; ZAR uses the FX rate. */
export function priceOf(asset: string, prices: Record<string, number>, fx: number | null): number {
  if (STABLECOINS.has(asset)) return 1;
  if (asset === "ZAR") return fx && fx > 0 ? 1 / fx : 0;
  return prices[asset] ?? 0;
}

export function containerKey(containerId: string | null): string {
  return containerId ?? NO_CONTAINER;
}

/** Compresses a live state into a history point. */
export function toHistoryPoint(state: PortfolioState): HistoryPoint {
  const h: HistoryPoint["h"] = {};
  const c: HistoryPoint["c"] = {};
  const usedAssets = new Set<string>();
  let assets = 0;
  let debt = 0;
  for (const position of state.positions) {
    if (position.includeInTotal === false) continue;
    if (!(position.qty > 0)) continue;
    const key = containerKey(position.containerId);
    const bucket = (h[key] ??= {});
    bucket[position.asset] = round((bucket[position.asset] ?? 0) + position.qty, 10);
    const usd = position.qty * priceOf(position.asset, state.prices, state.fx);
    const totals = (c[key] ??= [0, 0]);
    totals[0] += usd;
    assets += usd;
    usedAssets.add(position.asset);
  }
  const l: NonNullable<HistoryPoint["l"]> = {};
  for (const loan of state.debts) {
    if (!(loan.qty > 0)) continue;
    const key = containerKey(loan.containerId);
    const bucket = (h[key] ??= {});
    bucket[loan.asset] = round((bucket[loan.asset] ?? 0) - loan.qty, 10);
    const usd = loan.qty * priceOf(loan.asset, state.prices, state.fx);
    const totals = (c[key] ??= [0, 0]);
    totals[1] += usd;
    debt += usd;
    usedAssets.add(loan.asset);
    const collateralUsd = loan.collateralQty * priceOf(loan.collateralAsset, state.prices, state.fx);
    l[loan.loanId] = [round(usd, 2), round(collateralUsd, 2), key];
  }
  const p: Record<string, number> = {};
  for (const asset of usedAssets) {
    if (STABLECOINS.has(asset) || asset === "ZAR") continue;
    const price = state.prices[asset];
    if (price != null && price > 0) p[asset] = price;
  }
  for (const key of Object.keys(c)) {
    const totals = c[key];
    if (totals) c[key] = [round(totals[0], 2), round(totals[1], 2)];
  }
  const point: HistoryPoint = { t: state.asOf, a: round(assets, 2), d: round(debt, 2), h, c, p, fx: state.fx };
  if (Object.keys(l).length > 0) point.l = l;
  return point;
}

/**
 * Assets and debt in USD for a set of containers (null = the stored totals).
 * Child-named assets that were stored under another profile are moved: the
 * combined user set drops them, and that child's set picks them up from
 * snapshots recorded before the child profile existed.
 */
export function pointTotals(point: HistoryPoint, containers: Set<string> | null): { assets: number; debt: number } {
  if (!containers) return { assets: point.a, debt: point.d };
  let assets = 0;
  let debt = 0;
  const childBuckets = new Set<string>();
  for (const [key, totals] of Object.entries(point.c)) {
    if (!containers.has(key)) continue;
    if (isChildProfileId(key)) childBuckets.add(key);
    assets += totals[0];
    debt += totals[1];
  }
  for (const [key, bucket] of Object.entries(point.h)) {
    for (const [asset, qty] of Object.entries(bucket)) {
      if (!qty) continue;
      const child = childProfileForLabel([asset]);
      if (!child) continue;
      const usd = qty * priceOf(asset, point.p, point.fx);
      const filedHere = containers.has(key);
      const wantChild = containers.has(child);
      if (filedHere && !wantChild) {
        if (usd >= 0) assets -= usd;
        else debt -= -usd;
      } else if (!filedHere && wantChild && !childBuckets.has(child)) {
        if (usd >= 0) assets += usd;
        else debt += -usd;
      }
    }
  }
  return { assets, debt };
}

/** Net quantity per asset in a point for a set of containers (null = all). */
export function pointQuantities(point: HistoryPoint, containers: Set<string> | null): Map<string, number> {
  const out = new Map<string, number>();
  for (const [key, bucket] of Object.entries(point.h)) {
    if (containers && !containers.has(key)) continue;
    for (const [asset, qty] of Object.entries(bucket)) out.set(asset, (out.get(asset) ?? 0) + qty);
  }
  return out;
}

/**
 * Retention: every 15-minute point for 7 days, the last point of each hour
 * for 90 days, then the last point of each Johannesburg day forever.
 */
export function compactHistory(points: HistoryPoint[], now: number): HistoryPoint[] {
  const sorted = [...points].sort((x, y) => x.t - y.t);
  const keep: HistoryPoint[] = [];
  const lastInBucket = new Map<string, number>();
  sorted.forEach((point, index) => {
    const age = now - point.t;
    let bucket: string;
    if (age <= FIFTEEN_MIN_RETENTION_MS) bucket = `q:${point.t}`;
    else if (age <= HOURLY_RETENTION_MS) bucket = `h:${Math.floor(point.t / HOUR_MS)}`;
    else bucket = `d:${jhbDay(point.t)}`;
    lastInBucket.set(bucket, index);
  });
  const keepIndexes = new Set(lastInBucket.values());
  sorted.forEach((point, index) => {
    if (keepIndexes.has(index)) keep.push(point);
  });
  return keep;
}

export function appendPoint(points: HistoryPoint[], point: HistoryPoint): HistoryPoint[] {
  const withoutSame = points.filter((existing) => existing.t !== point.t);
  return compactHistory([...withoutSame, point], point.t);
}

function unitUsd(currency: string, fx: number | null): number {
  if (currency === "USD") return 1;
  if (currency === "ZAR" && fx != null && fx > 0) return 1 / fx;
  return 0;
}

function clonePoint(point: HistoryPoint): HistoryPoint {
  const h: HistoryPoint["h"] = {};
  for (const [key, bucket] of Object.entries(point.h)) h[key] = { ...bucket };
  const c: HistoryPoint["c"] = {};
  for (const [key, totals] of Object.entries(point.c)) c[key] = [totals[0], totals[1]];
  return {
    t: point.t,
    a: point.a,
    d: point.d,
    h,
    c,
    p: { ...point.p },
    fx: point.fx,
    ...(point.l ? { l: { ...point.l } } : {}),
    ...(point.gapFill ? { gapFill: true as const } : {}),
    ...(point.carried ? { carried: [...point.carried] } : {}),
  };
}

/**
 * Writes asset-swap daily levels into portfolio history on days that do not
 * already record that asset. WEIB and EIB are omitted so they are not added
 * to the asset-swap balance. Null values are omitted rather than stored as zero.
 */
export function mergeStatementHistory(points: HistoryPoint[], state: PortfolioState): HistoryPoint[] {
  const series = (state.statementSeries ?? []).filter((item) => item.kind === "as");
  if (series.length === 0) return points;
  const cells = new Map<string, { asset: string; containerId: string | null; currency: string; value: number }>();
  for (const item of series) {
    const byDate = new Map<string, { value: number; currency: string }>();
    for (const point of item.points) {
      if (typeof point.value !== "number" || !Number.isFinite(point.value)) continue;
      byDate.set(point.date, { value: point.value, currency: point.currency || item.currency });
    }
    for (const [date, level] of byDate) {
      cells.set(`${date}\n${item.asset}`, { asset: item.asset, containerId: item.containerId, currency: level.currency, value: level.value });
    }
  }
  if (cells.size === 0) return points;

  const byDay = new Map<string, HistoryPoint>();
  for (const point of points) {
    const day = jhbDay(point.t);
    const current = byDay.get(day);
    if (!current || point.t >= current.t) byDay.set(day, point);
  }
  const originals = new Map<HistoryPoint, HistoryPoint>();
  const editable = new Set<HistoryPoint>();
  const created: HistoryPoint[] = [];
  const edit = (day: string): HistoryPoint => {
    const current = byDay.get(day);
    if (current && editable.has(current)) return current;
    if (current) {
      const copy = originals.get(current) ?? clonePoint(current);
      originals.set(current, copy);
      editable.add(copy);
      byDay.set(day, copy);
      return copy;
    }
    const fresh: HistoryPoint = { t: jhbDayEnd(day) - 1, a: 0, d: 0, h: {}, c: {}, p: {}, fx: state.fx };
    editable.add(fresh);
    created.push(fresh);
    byDay.set(day, fresh);
    return fresh;
  };

  for (const [id, cell] of cells) {
    const day = id.slice(0, 10);
    const px = unitUsd(cell.currency, state.fx);
    if (!(px > 0)) continue;
    const key = containerKey(cell.containerId);
    const point = edit(day);
    const bucket = (point.h[key] ??= {});
    if (Object.prototype.hasOwnProperty.call(bucket, cell.asset)) continue;
    bucket[cell.asset] = round(cell.value, 10);
    const usd = cell.value * px;
    const totals = (point.c[key] ??= [0, 0]);
    totals[0] = round(totals[0] + usd, 2);
    point.a = round(point.a + usd, 2);
    point.p[cell.asset] = px;
  }
  if (originals.size === 0 && created.length === 0) return points;
  return [...points.map((point) => originals.get(point) ?? point), ...created].sort((a, b) => a.t - b.t);
}

/**
 * Asset-swap USD carried forward to `day`. WEIB and EIB are not included.
 * A null point does not invent a zero.
 */
export function carriedStatementUsd(
  series: readonly StatementSeries[] | undefined,
  set: Set<string> | null,
  day: string,
  fx: number | null,
): number {
  if (!series || series.length === 0) return 0;
  let total = 0;
  for (const item of series) {
    if (item.kind !== "as") continue;
    if (set && !set.has(containerKey(item.containerId))) continue;
    let latestDate = "";
    let latest: { value: number; currency: string } | null = null;
    for (const point of item.points) {
      if (point.date > day || typeof point.value !== "number" || !Number.isFinite(point.value)) continue;
      if (!latest || point.date >= latestDate) {
        latest = { value: point.value, currency: point.currency || item.currency };
        latestDate = point.date;
      }
    }
    if (!latest) continue;
    const px = unitUsd(latest.currency, fx);
    if (px > 0) total += latest.value * px;
  }
  return total;
}
