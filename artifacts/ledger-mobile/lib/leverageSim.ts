/**
 * BTC Leverage vs Pure AMC strategy engine.
 *
 * Verbatim port of the verified compute() function from the source dashboard
 * (`attached_assets/btc-leverage-dashboard_*.jsx`) — the math is framework
 * agnostic. All monetary inputs/outputs are in ZAR because the SA CGT rules
 * baked in (R40k personal exclusion, 40/80% inclusion) are ZAR-denominated.
 * The UI converts display values via USD_TO_ZAR when the app currency is USD.
 *
 * Regression fixtures (must reproduce exactly — see CALCULATOR_ENGINE_DOCS §7):
 *   Defaults: BTC 29%, AMC 45%, LTV 60%, borrow 3%, R600k/mo, 0% esc, 10yr
 *     Trust,     R0 start → A R507,032,037  B R515,379,634  tax R161,160,147
 *     Personal,  R0 start → A R725,693,156  B R640,087,356  tax R100,645,095
 *     Tax-Free,  R0 start → A R1,017,828,134 B R764,780,678  tax R0
 *     Trust,    R5m start → A R625,704,593  B R648,650,644
 */

import type { Loan } from "@workspace/api-client-react";

import { USD_TO_ZAR } from "@/utils/format";

export type TaxMode = "personal" | "trust" | "taxfree";

export type LeverageInputs = {
  /** BTC annual price appreciation, percent. */
  btcGrowth: number;
  /** AMC/options annual return, percent. */
  optionsReturn: number;
  /** Loan-to-value ratio borrowed against BTC, percent. */
  ltv: number;
  /** Annual interest rate on the BTC-backed loan, percent. */
  borrowCost: number;
  /** Lump sum at day 1 (held as BTC), ZAR. */
  startingCapital: number;
  /** Monthly contribution, ZAR. */
  monthlyContrib: number;
  /** Annual % escalation applied to the monthly contribution. */
  contribEscalation: number;
  /** Horizon in years, 1–20. */
  years: number;
  /** SA tax entity treatment for the simulation. */
  taxMode: TaxMode;
  /**
   * Calendar month (1-12) the simulation conceptually begins in. Combined
   * with `rebalanceMonth` this shifts when the annual sell-and-rebalance
   * fires. Default: 1 (January) → matches the original engine where the
   * first rebalance lands at month 12.
   */
  startMonth?: number;
  /**
   * Calendar month (1-12) the annual rebalance fires in. Default: 1 —
   * meaning "same calendar month as start", which puts the first
   * rebalance exactly 12 months from the start (preserving the original
   * §7 fixture math for the legacy defaults). Set to 2 to align with
   * the SA tax year (rebalance on Feb 28/29). The number of months to
   * the FIRST rebalance is
   * `((rebalanceMonth - startMonth + 12) % 12) || 12`, then every 12.
   */
  rebalanceMonth?: number;
};

export type YearRowA = {
  year: number;
  btcVal: number;
  btcBase: number;
  amcDeployed: number;
  debt: number;
  equity: number;
  amcGain: number;
  amcTax: number;
  netCash: number;
  newLoan: number;
  btcTax: number;
  totTaxA: number;
  gross: number;
  net: number;
  contributed: number;
  growthRate: number;
  monthlyAtYear: number;
};

export type YearRowB = {
  year: number;
  gross: number;
  base: number;
  gain: number;
  exitTax: number;
  net: number;
  contributed: number;
  growthRate: number;
};

export type Snap = { month: number; net: number };

export type LeverageResult = {
  rowsA: YearRowA[];
  rowsB: YearRowB[];
  snapsA: Snap[];
  snapsB: Snap[];
  grossEffA: number;
  grossEffB: number;
  effectiveCGT: number;
  annualExcl: number;
  totTaxA: number;
  /**
   * Borrow cost above which leverage stops adding value. If borrowCost ≥
   * breakEvenBorrowPct, Strategy A's gross expected return is ≤ B's.
   */
  breakEvenBorrowPct: number;
  /**
   * BTC drawdown (in percent of current price) that would push LTV from
   * the chosen LTV to a liquidation threshold of 80% (Binance's loan
   * liquidation point on most pairs). Negative = drop required.
   */
  liquidationDropPct: number;
};

const LIQ_LTV = 80; // % — Binance liquidation point on most loan pairs

export function compute(params: LeverageInputs): LeverageResult {
  const {
    btcGrowth,
    optionsReturn,
    ltv,
    borrowCost,
    startingCapital,
    monthlyContrib,
    contribEscalation,
    years,
    taxMode,
  } = params;
  const startMonth = params.startMonth ?? 1;
  const rebalanceMonth = params.rebalanceMonth ?? 1;
  // Months from sim start to the first rebalance. When startMonth ===
  // rebalanceMonth (the legacy default) we want the rebalance at month
  // 12 (i.e. one full year later), not month 0 — hence the `|| 12`
  // fallback. SA tax year (start=May, rebalance=Feb) → 9 months, etc.
  const firstRebalance =
    ((rebalanceMonth - startMonth + 12) % 12) || 12;

  const inclusionRate =
    taxMode === "trust" ? 0.8 : taxMode === "taxfree" ? 0 : 0.4;
  const effectiveCGT = inclusionRate * 0.45;
  const annualExcl = taxMode === "trust" ? 0 : taxMode === "taxfree" ? 0 : 40000;
  const ltvFrac = ltv / 100;

  const mBtc = Math.pow(1 + btcGrowth / 100, 1 / 12) - 1;
  const mOpt = Math.pow(1 + optionsReturn / 100, 1 / 12) - 1;
  const mBor = Math.pow(1 + borrowCost / 100, 1 / 12) - 1;

  // Strategy A initial state
  const initLoan = startingCapital * ltvFrac;
  let btcVal = startingCapital;
  let btcBase = startingCapital;
  let amc = initLoan;
  let amcBase = initLoan;
  let debt = initLoan;
  let cumA = startingCapital;
  let totTaxA = 0;

  // Strategy B initial state
  let bVal = startingCapital;
  let bBase = startingCapital;
  let cumB = startingCapital;

  const rowsA: YearRowA[] = [];
  const rowsB: YearRowB[] = [];
  const snapsA: Snap[] = [];
  const snapsB: Snap[] = [];
  let prevANet = 0;
  let prevBNet = 0;

  const months = years * 12;
  for (let m = 1; m <= months; m++) {
    const yearIndex = Math.floor((m - 1) / 12);
    const curContrib =
      monthlyContrib * Math.pow(1 + contribEscalation / 100, yearIndex);

    // grow existing
    btcVal *= 1 + mBtc;
    if (amc > 0) amc *= 1 + mOpt;
    if (debt > 0) debt *= 1 + mBor;

    // monthly contrib → BTC
    btcVal += curContrib;
    btcBase += curContrib;
    cumA += curContrib;

    // immediate lever
    const mLoan = curContrib * ltvFrac;
    amc += mLoan;
    amcBase += mLoan;
    debt += mLoan;

    // Strategy B
    bVal *= 1 + mOpt;
    bVal += curContrib;
    bBase += curContrib;
    cumB += curContrib;

    // Rebalance fires on the configured calendar month: first at
    // `firstRebalance`, then every 12 months after. `y` is the count of
    // rebalances so far (sequence year), not a calendar year.
    if (m >= firstRebalance && (m - firstRebalance) % 12 === 0) {
      const y = Math.round((m - firstRebalance) / 12) + 1;
      const amcGain = Math.max(0, amc - amcBase);
      const amcTax = Math.max(0, amcGain - annualExcl) * effectiveCGT;
      totTaxA += amcTax;
      const afterTax = amc - amcTax;
      const netCash = afterTax - debt;
      const newLoan = btcVal * ltvFrac;
      const reinvest = Math.max(0, netCash);
      amc = reinvest + newLoan;
      amcBase = reinvest + newLoan;
      debt = newLoan;

      const btcGain = Math.max(0, btcVal - btcBase);
      const btcTax = Math.max(0, btcGain - annualExcl) * effectiveCGT;
      const equity = amc - debt;
      const aGross = btcVal + equity;
      const aNet = aGross - btcTax;

      const bGain = Math.max(0, bVal - bBase);
      const bTax = Math.max(0, bGain - annualExcl) * effectiveCGT;
      const bNet = bVal - bTax;

      const aRate = prevANet > 0 ? (aNet / prevANet - 1) * 100 : 0;
      const bRate = prevBNet > 0 ? (bNet / prevBNet - 1) * 100 : 0;

      rowsA.push({
        year: y,
        btcVal,
        btcBase,
        amcDeployed: amc,
        debt,
        equity: reinvest,
        amcGain,
        amcTax,
        netCash,
        newLoan,
        btcTax,
        totTaxA,
        gross: aGross,
        net: aNet,
        contributed: cumA,
        growthRate: aRate,
        monthlyAtYear: curContrib,
      });
      rowsB.push({
        year: y,
        gross: bVal,
        base: bBase,
        gain: bGain,
        exitTax: bTax,
        net: bNet,
        contributed: cumB,
        growthRate: bRate,
      });

      prevANet = aNet;
      prevBNet = bNet;
    }

    if (m % 3 === 0) {
      const sBtcG = Math.max(0, btcVal - btcBase);
      const sBtcT = sBtcG * effectiveCGT;
      const sEq = Math.max(0, amc - debt);
      snapsA.push({ month: m, net: btcVal + sEq - sBtcT });

      const sBG = Math.max(0, bVal - bBase);
      const sBT = sBG * effectiveCGT;
      snapsB.push({ month: m, net: bVal - sBT });
    }
  }

  const grossEffA = btcGrowth + ltvFrac * (optionsReturn - borrowCost);
  const grossEffB = optionsReturn;

  // Borrow cost above which A's gross ≤ B's:
  //   btcGrowth + ltvFrac*(optionsReturn − x) = optionsReturn
  //   → x = optionsReturn − (optionsReturn − btcGrowth) / ltvFrac
  const breakEvenBorrowPct =
    ltvFrac > 0
      ? optionsReturn - (optionsReturn - btcGrowth) / ltvFrac
      : Number.POSITIVE_INFINITY;

  // BTC drop% to liquidation: at current LTV chosen, what fraction of BTC
  // price decline lifts LTV from chosen→80?  newLtv = ltv / (1 - drop)
  //   → drop = 1 − ltv/LIQ_LTV
  const liquidationDropPct = Math.max(0, (1 - ltv / LIQ_LTV) * 100);

  return {
    rowsA,
    rowsB,
    snapsA,
    snapsB,
    grossEffA,
    grossEffB,
    effectiveCGT,
    annualExcl,
    totTaxA,
    breakEvenBorrowPct,
    liquidationDropPct,
  };
}

export const DEFAULT_INPUTS: LeverageInputs = {
  btcGrowth: 29,
  optionsReturn: 45,
  ltv: 60,
  borrowCost: 3,
  startingCapital: 0,
  monthlyContrib: 600_000,
  contribEscalation: 0,
  years: 10,
  taxMode: "personal", // explicit: never assume trust
  startMonth: 1,
  rebalanceMonth: 1, // same as start → first rebalance at m=12 (legacy)
};

/**
 * Build a prefill snapshot from the user's live Binance loans. Returns
 * the collateralized BTC value (ZAR), the debt-weighted APR (%), and the
 * current aggregate LTV (%) so the simulator can mirror reality.
 *
 * If there are no BTC-collateralized loans, returns nulls and the caller
 * should fall back to defaults / user-entered values.
 */
export function snapshotFromLoans(
  loans: Loan[] | null | undefined,
): {
  collateralZar: number | null;
  weightedAprPct: number | null;
  currentLtvPct: number | null;
} {
  const btcLoans = (loans ?? []).filter(
    (l) => l.collateral?.asset?.toUpperCase() === "BTC",
  );
  if (btcLoans.length === 0)
    return { collateralZar: null, weightedAprPct: null, currentLtvPct: null };

  const collateralUsd = btcLoans.reduce(
    (s, l) => s + (l.collateral?.valueUsd ?? 0),
    0,
  );
  const debtUsd = btcLoans.reduce((s, l) => s + (l.debtUsd ?? 0), 0);
  const weightedApr =
    debtUsd > 0
      ? btcLoans.reduce((s, l) => s + (l.apr ?? 0) * (l.debtUsd ?? 0), 0) /
        debtUsd
      : null;

  return {
    collateralZar: collateralUsd * USD_TO_ZAR,
    weightedAprPct: weightedApr,
    currentLtvPct: collateralUsd > 0 ? (debtUsd / collateralUsd) * 100 : null,
  };
}
