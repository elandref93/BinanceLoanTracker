/**
 * Monte Carlo of net worth and loan LTV. Each simulated day draws the same
 * historical day for every asset (in 5-day blocks), so the correlation
 * between assets and short runs of bad days carry over from the past year.
 * Pure and deterministic for a given seed so it can run in a worker or a test.
 */

export type ForecastDrift = "none" | "history";

export type ForecastAsset = {
  asset: string;
  /** Holdings value today, USD. */
  usd: number;
  /** Debt in this asset today, USD. */
  debtUsd: number;
  /** Debt-weighted APR on that debt, percent. */
  debtApr: number;
  /** Daily log returns, oldest first. Empty for stablecoins and cash. */
  returns: readonly number[];
};

export type ForecastLoan = {
  id: string;
  asset: string;
  collateralAsset: string;
  debtUsd: number;
  collateralUsd: number;
  apr: number;
  marginCallLtv: number;
  liqLtv: number;
};

export type ForecastInput = {
  seed: number;
  paths: number;
  days: number;
  drift: ForecastDrift;
  /** Net value not covered by `assets` (small holdings), held flat. */
  residualUsd: number;
  assets: readonly ForecastAsset[];
  loans: readonly ForecastLoan[];
};

export type HorizonStats = { day: number; p10: number; p50: number; p90: number; lowerProb: number };

export type LoanOdds = { id: string; margin30: number; margin90: number; liq30: number; liq90: number };

export type ForecastResult =
  | { ok: false; reason: "no_history" | "no_value" }
  | {
      ok: true;
      start: number;
      /** Percentile bands of net worth for days 0..days. */
      p10: number[];
      p25: number[];
      p50: number[];
      p75: number[];
      p90: number[];
      horizons: HorizonStats[];
      loans: LoanOdds[];
      historyDays: number;
      paths: number;
    };

export const MIN_HISTORY_DAYS = 30;
const BLOCK = 5;

/** Small fast PRNG (mulberry32); returns floats in [0, 1). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Linear-interpolated percentile of a sorted array, q in [0, 1]. */
export function percentile(sorted: ArrayLike<number>, q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const position = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const low = Math.floor(position);
  const high = Math.ceil(position);
  const a = sorted[low] as number;
  const b = sorted[high] as number;
  return a + (b - a) * (position - low);
}

/**
 * Lines every asset up on the same trailing window of `length` days. Shorter
 * histories repeat their own returns so they still move, just without a
 * matching day for the older part of the window.
 */
function alignReturns(assets: readonly ForecastAsset[], length: number, drift: ForecastDrift): Float64Array[] {
  return assets.map((asset) => {
    const row = new Float64Array(length);
    const source = asset.returns;
    if (source.length === 0) return row;
    const mean = drift === "none" ? source.reduce((sum, value) => sum + value, 0) / source.length : 0;
    const offset = length - source.length;
    for (let index = 0; index < length; index++) {
      const sourceIndex = index >= offset ? index - offset : ((index % source.length) + source.length) % source.length;
      row[index] = (source[sourceIndex] as number) - mean;
    }
    return row;
  });
}

export function runForecast(input: ForecastInput): ForecastResult {
  const assets = input.assets.filter((asset) => asset.usd > 0 || asset.debtUsd > 0);
  const start = input.residualUsd + assets.reduce((sum, asset) => sum + asset.usd - asset.debtUsd, 0);
  if (assets.length === 0 || !(Math.abs(start) > 0)) return { ok: false, reason: "no_value" };
  const historyDays = Math.min(365, Math.max(0, ...assets.map((asset) => asset.returns.length)));
  if (historyDays < MIN_HISTORY_DAYS) return { ok: false, reason: "no_history" };

  const days = Math.max(1, Math.floor(input.days));
  const paths = Math.max(10, Math.floor(input.paths));
  const random = seededRandom(input.seed);
  const matrix = alignReturns(assets, historyDays, input.drift);
  const assetIndex = new Map(assets.map((asset, index) => [asset.asset, index]));
  const loanAssets = input.loans.map((loan) => ({
    ...loan,
    debtIndex: assetIndex.get(loan.asset) ?? -1,
    collateralIndex: assetIndex.get(loan.collateralAsset) ?? -1,
  }));

  const net = new Float32Array(paths * (days + 1));
  const marginHits = loanAssets.map(() => ({ m30: 0, m90: 0, l30: 0, l90: 0 }));
  const cumulative = new Float64Array(assets.length);

  for (let path = 0; path < paths; path++) {
    cumulative.fill(0);
    net[path * (days + 1)] = start;
    const reached = loanAssets.map(() => ({ margin: Infinity, liq: Infinity }));
    let blockStart = 0;
    for (let day = 1; day <= days; day++) {
      if ((day - 1) % BLOCK === 0) blockStart = Math.floor(random() * historyDays);
      const sample = (blockStart + ((day - 1) % BLOCK)) % historyDays;
      let value = input.residualUsd;
      for (let index = 0; index < assets.length; index++) {
        const asset = assets[index] as ForecastAsset;
        cumulative[index] = (cumulative[index] as number) + ((matrix[index] as Float64Array)[sample] as number);
        const factor = Math.exp(cumulative[index] as number);
        value += asset.usd * factor - asset.debtUsd * factor * (1 + ((asset.debtApr / 100) * day) / 365);
      }
      net[path * (days + 1) + day] = value;
      if (day <= 90) {
        loanAssets.forEach((loan, loanIndex) => {
          const debtFactor = loan.debtIndex >= 0 ? Math.exp(cumulative[loan.debtIndex] as number) : 1;
          const collateralFactor = loan.collateralIndex >= 0 ? Math.exp(cumulative[loan.collateralIndex] as number) : 1;
          const collateral = loan.collateralUsd * collateralFactor;
          const ltv = collateral > 0 ? ((loan.debtUsd * debtFactor * (1 + ((loan.apr / 100) * day) / 365)) / collateral) * 100 : Infinity;
          const state = reached[loanIndex] as { margin: number; liq: number };
          if (ltv >= loan.marginCallLtv && day < state.margin) state.margin = day;
          if (ltv >= loan.liqLtv && day < state.liq) state.liq = day;
        });
      }
    }
    reached.forEach((state, loanIndex) => {
      const hits = marginHits[loanIndex] as { m30: number; m90: number; l30: number; l90: number };
      if (state.margin <= 30) hits.m30 += 1;
      if (state.margin <= 90) hits.m90 += 1;
      if (state.liq <= 30) hits.l30 += 1;
      if (state.liq <= 90) hits.l90 += 1;
    });
  }

  const p10: number[] = [];
  const p25: number[] = [];
  const p50: number[] = [];
  const p75: number[] = [];
  const p90: number[] = [];
  const column = new Float64Array(paths);
  const horizonDays = [91, 182, 365].filter((day) => day <= days);
  const horizons: HorizonStats[] = [];
  for (let day = 0; day <= days; day++) {
    for (let path = 0; path < paths; path++) column[path] = net[path * (days + 1) + day] as number;
    column.sort();
    p10.push(percentile(column, 0.1));
    p25.push(percentile(column, 0.25));
    p50.push(percentile(column, 0.5));
    p75.push(percentile(column, 0.75));
    p90.push(percentile(column, 0.9));
    if (horizonDays.includes(day)) {
      let lower = 0;
      for (let path = 0; path < paths; path++) if ((column[path] as number) < start) lower += 1;
      horizons.push({ day, p10: p10[day] as number, p50: p50[day] as number, p90: p90[day] as number, lowerProb: lower / paths });
    }
  }

  return {
    ok: true,
    start,
    p10,
    p25,
    p50,
    p75,
    p90,
    horizons,
    loans: loanAssets.map((loan, index) => {
      const hits = marginHits[index] as { m30: number; m90: number; l30: number; l90: number };
      return { id: loan.id, margin30: hits.m30 / paths, margin90: hits.m90 / paths, liq30: hits.l30 / paths, liq90: hits.l90 / paths };
    }),
    historyDays,
    paths,
  };
}
