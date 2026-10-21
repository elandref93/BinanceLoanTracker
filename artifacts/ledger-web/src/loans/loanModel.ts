import type { LoanHistoryPoint, LoanPosition, LoanProfile } from "@workspace/api-client-react";

import { DEFAULT_TARGET_LTV, LIQ_LTV, WARNING_LTV, riskBand, riskSeverity, type RiskBand } from "@/domain/risk";

export const USD_STABLES = new Set(["USDT", "USDC", "FDUSD", "TUSD", "DAI", "BUSD"]);

export type LoanTargetSource = { targetLtv: number | null };

export function loanTarget(loan: LoanTargetSource): number {
  const target = loan.targetLtv;
  return target != null && target > 0 && target < 100 ? target : DEFAULT_TARGET_LTV;
}

export function loanBand(loan: { ltv: number } & LoanTargetSource): RiskBand {
  return riskBand(loan.ltv, loanTarget(loan));
}

/** Worst first, each loan against its own profile's target; ties go to the larger debt. */
export function rankLoans<T extends { ltv: number; debtUsd: number } & LoanTargetSource>(loans: readonly T[]): T[] {
  return [...loans].sort((a, b) => {
    const severity = riskSeverity(b.ltv, loanTarget(b)) - riskSeverity(a.ltv, loanTarget(a));
    return severity !== 0 ? severity : b.debtUsd - a.debtUsd;
  });
}

export function bandCounts(loans: ReadonlyArray<{ ltv: number } & LoanTargetSource>): Record<RiskBand, number> {
  const counts: Record<RiskBand, number> = { healthy: 0, above: 0, margin: 0, liquidation: 0 };
  for (const loan of loans) counts[loanBand(loan)] += 1;
  return counts;
}

/**
 * Debt-weighted target across profiles, used only for the combined gauge and
 * chart when several profiles are shown together. One profile uses its own.
 */
export function combinedTarget(profiles: ReadonlyArray<Pick<LoanProfile, "debtUsd" | "targetLtv">>): number {
  const withDebt = profiles.filter((profile) => profile.debtUsd > 0);
  if (withDebt.length === 0) return DEFAULT_TARGET_LTV;
  if (withDebt.length === 1) return loanTarget(withDebt[0] as LoanTargetSource);
  const debt = withDebt.reduce((sum, profile) => sum + profile.debtUsd, 0);
  const weighted = withDebt.reduce((sum, profile) => sum + loanTarget(profile) * profile.debtUsd, 0);
  return Math.round((weighted / debt) * 10) / 10;
}

/** How far the collateral price can fall (percent) before LTV reaches the trigger. Negative means already past it. */
export function dropToPct(currentPrice: number | null, triggerPrice: number | null): number | null {
  if (currentPrice == null || triggerPrice == null || !(currentPrice > 0) || !(triggerPrice > 0)) return null;
  return (1 - triggerPrice / currentPrice) * 100;
}

/** LTV after the collateral price moves by `pricePct` percent, holding the debt constant. */
export function stressedLtv(ltv: number, pricePct: number): number {
  const factor = 1 + pricePct / 100;
  return factor > 0 ? ltv / factor : Infinity;
}

/**
 * What it takes to get back to the target. Positive `addCollateralUsd` or
 * `repayUsd` means the loan is above target; when below, `spareCollateralUsd`
 * is how much collateral could come out before reaching it.
 */
export function toTarget(loan: Pick<LoanPosition, "debtUsd" | "collateralUsd"> & LoanTargetSource): {
  addCollateralUsd: number;
  repayUsd: number;
  spareCollateralUsd: number;
} {
  const target = loanTarget(loan) / 100;
  const neededCollateral = loan.debtUsd / target;
  const gap = neededCollateral - loan.collateralUsd;
  return {
    addCollateralUsd: Math.max(0, gap),
    repayUsd: Math.max(0, loan.debtUsd - loan.collateralUsd * target),
    spareCollateralUsd: Math.max(0, -gap),
  };
}

export type LtvSeriesKey = { kind: "all" } | { kind: "loan"; id: string } | { kind: "profile"; id: string };

export type LtvSeriesPoint = { t: number; v: number };

export function ltvSeries(history: readonly LoanHistoryPoint[], key: LtvSeriesKey): LtvSeriesPoint[] {
  const out: LtvSeriesPoint[] = [];
  for (const point of history) {
    const t = Date.parse(point.t);
    const value = key.kind === "all" ? point.ltv : key.kind === "loan" ? point.loans[key.id] : point.profiles[key.id];
    if (Number.isFinite(t) && value != null && Number.isFinite(value)) out.push({ t, v: value });
  }
  return out;
}

export function seriesSummary(points: readonly LtvSeriesPoint[]): { start: number; end: number; low: number; high: number } | null {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return null;
  let low = first.v;
  let high = first.v;
  for (const point of points) {
    low = Math.min(low, point.v);
    high = Math.max(high, point.v);
  }
  return { start: first.v, end: last.v, low, high };
}

/** Vertical range for the banded chart: always shows the liquidation band so distance to danger is visible. */
export function ltvDomain(values: readonly number[]): [number, number] {
  const finite = values.filter((value) => Number.isFinite(value));
  const low = finite.length > 0 ? Math.min(...finite) : DEFAULT_TARGET_LTV;
  const high = finite.length > 0 ? Math.max(...finite) : DEFAULT_TARGET_LTV;
  const floor = Math.max(0, Math.floor((low - 8) / 5) * 5);
  const ceiling = Math.min(100, Math.max(LIQ_LTV + 4, Math.ceil((high + 4) / 5) * 5));
  return [floor, ceiling];
}

export type BandStop = { from: number; to: number; band: RiskBand };

export function bandStops(target: number, ceiling = 100): BandStop[] {
  return [
    { from: 0, to: Math.min(target, WARNING_LTV), band: "healthy" as const },
    { from: target, to: WARNING_LTV, band: "above" as const },
    { from: WARNING_LTV, to: LIQ_LTV, band: "margin" as const },
    { from: LIQ_LTV, to: ceiling, band: "liquidation" as const },
  ].filter((stop) => stop.to > stop.from);
}
