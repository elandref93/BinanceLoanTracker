import type { LoanPosition, PortfolioAnalytics, PortfolioAsset } from "@workspace/api-client-react";

import type { ForecastInput } from "@/insights/forecast";
import { dropToPct, USD_STABLES } from "@/loans/loanModel";

const CASH = new Set(["ZAR", "USD", "EUR", "GBP"]);
const BTC_LIKE = new Set(["BTC", "WBTC", "BTCB"]);

export function isStable(asset: string): boolean {
  return USD_STABLES.has(asset) || CASH.has(asset);
}

export const FORECAST_PATHS = 2000;
export const FORECAST_DAYS = 365;

/** Worker input from the analytics response: holdings and debt per asset plus each loan. */
export function forecastInput(analytics: PortfolioAnalytics, drift: ForecastInput["drift"], seed = 20260301): ForecastInput {
  const gross = analytics.totals.assetsUsd;
  const aprByAsset = new Map<string, { debt: number; weighted: number }>();
  for (const loan of analytics.loans) {
    const entry = aprByAsset.get(loan.asset) ?? { debt: 0, weighted: 0 };
    entry.debt += loan.debtUsd;
    entry.weighted += loan.debtUsd * loan.apr;
    aprByAsset.set(loan.asset, entry);
  }
  const assets = analytics.assetReturns.map((row) => {
    const apr = aprByAsset.get(row.asset);
    return {
      asset: row.asset,
      usd: row.weight * gross,
      debtUsd: row.debtWeight * gross,
      debtApr: apr && apr.debt > 0 ? apr.weighted / apr.debt : 0,
      returns: row.returns,
    };
  });
  const covered = assets.reduce((sum, asset) => sum + asset.usd - asset.debtUsd, 0);
  return {
    seed,
    paths: FORECAST_PATHS,
    days: FORECAST_DAYS,
    drift,
    residualUsd: analytics.totals.netUsd - covered,
    assets,
    loans: analytics.loans.map((loan) => ({
      id: loan.id,
      asset: loan.asset,
      collateralAsset: loan.collateralAsset,
      debtUsd: loan.debtUsd,
      collateralUsd: loan.collateralUsd,
      apr: loan.apr,
      marginCallLtv: loan.marginCallLtv,
      liqLtv: loan.liqLtv,
    })),
  };
}

export type StressMode = "crypto" | "btc";

/** Price multiplier for one asset when crypto (or only BTC) falls by `dropPct`. */
export function shockFactor(asset: string, mode: StressMode, dropPct: number): number {
  const factor = Math.max(0, 1 - dropPct / 100);
  if (mode === "btc") return BTC_LIKE.has(asset) ? factor : 1;
  return isStable(asset) ? 1 : factor;
}

export type StressedLoan = { loanId: string; ltv: number; before: number };

export type StressResult = { netBefore: number; netAfter: number; changeUsd: number; changePct: number | null; loans: StressedLoan[] };

export function stressPortfolio(
  assets: ReadonlyArray<Pick<PortfolioAsset, "asset" | "usd" | "debtUsd">>,
  loans: ReadonlyArray<Pick<LoanPosition, "loanId" | "asset" | "collateralAsset" | "debtUsd" | "collateralUsd" | "ltv">>,
  mode: StressMode,
  dropPct: number,
): StressResult {
  let before = 0;
  let after = 0;
  for (const row of assets) {
    const factor = shockFactor(row.asset, mode, dropPct);
    before += row.usd - row.debtUsd;
    after += (row.usd - row.debtUsd) * factor;
  }
  return {
    netBefore: before,
    netAfter: after,
    changeUsd: after - before,
    changePct: Math.abs(before) > 0 ? ((after - before) / Math.abs(before)) * 100 : null,
    loans: loans.map((loan) => {
      const collateral = loan.collateralUsd * shockFactor(loan.collateralAsset, mode, dropPct);
      const debt = loan.debtUsd * shockFactor(loan.asset, mode, dropPct);
      return { loanId: loan.loanId, before: loan.ltv, ltv: collateral > 0 ? (debt / collateral) * 100 : Infinity };
    }),
  };
}

export type DangerRow = {
  asset: string;
  priceUsd: number | null;
  loanCount: number;
  marginPriceUsd: number | null;
  marginDropPct: number | null;
  liqPriceUsd: number | null;
  liqDropPct: number | null;
};

/**
 * Per collateral asset, the nearest trigger across its loans: the highest
 * margin-call and liquidation prices, so the first loan to get into trouble.
 */
export function distanceToDanger(
  loans: ReadonlyArray<Pick<LoanPosition, "collateralAsset" | "collateralPriceUsd" | "priceAtMarginCallUsd" | "priceAtLiquidationUsd">>,
): DangerRow[] {
  const rows = new Map<string, DangerRow>();
  for (const loan of loans) {
    const row = rows.get(loan.collateralAsset) ?? {
      asset: loan.collateralAsset,
      priceUsd: loan.collateralPriceUsd,
      loanCount: 0,
      marginPriceUsd: null,
      marginDropPct: null,
      liqPriceUsd: null,
      liqDropPct: null,
    };
    row.loanCount += 1;
    row.priceUsd ??= loan.collateralPriceUsd;
    if (loan.priceAtMarginCallUsd != null) row.marginPriceUsd = Math.max(row.marginPriceUsd ?? 0, loan.priceAtMarginCallUsd);
    if (loan.priceAtLiquidationUsd != null) row.liqPriceUsd = Math.max(row.liqPriceUsd ?? 0, loan.priceAtLiquidationUsd);
    rows.set(loan.collateralAsset, row);
  }
  return [...rows.values()]
    .map((row) => ({ ...row, marginDropPct: dropToPct(row.priceUsd, row.marginPriceUsd), liqDropPct: dropToPct(row.priceUsd, row.liqPriceUsd) }))
    .sort((a, b) => (a.marginDropPct ?? Infinity) - (b.marginDropPct ?? Infinity));
}

/** Yearly collateral growth (percent) that just pays the interest: APR × debt ÷ collateral. */
export function breakEvenGrowth(loans: ReadonlyArray<{ apr: number; debtUsd: number; collateralUsd: number }>): number | null {
  const collateral = loans.reduce((sum, loan) => sum + loan.collateralUsd, 0);
  if (!(collateral > 0)) return null;
  return loans.reduce((sum, loan) => sum + loan.apr * loan.debtUsd, 0) / collateral;
}

/** 0 when everything is in one asset, approaching 100 as holdings spread evenly over many. */
export function diversificationScore(hhi: number): number {
  if (!(hhi > 0)) return 0;
  return Math.round(Math.min(1, Math.max(0, 1 - hhi)) * 100);
}

export const HORIZONS = [
  { value: "3M", label: "3M", day: 91 },
  { value: "6M", label: "6M", day: 182 },
  { value: "12M", label: "12M", day: 365 },
] as const;

export type HorizonKey = (typeof HORIZONS)[number]["value"];
