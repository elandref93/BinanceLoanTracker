import type { Loan } from "@workspace/api-client-react";

export const DEFAULT_TARGET_LTV = 65;
/** @deprecated Prefer `useTargetLtv()` from `@/context/RiskSettingsContext`. */
export const TARGET_LTV = DEFAULT_TARGET_LTV;
// Binance Flexible Rate Loan thresholds for major collateral (BTC/ETH/BNB):
//   Initial LTV     78%  — you can open a loan up to this LTV
//   Margin call     85%  — Binance starts notifying / freezing actions
//   Liquidation     91%  — Binance liquidates collateral
// These vary slightly by collateral asset; 91% matches what Binance displays
// for BTC-collateralised USDC loans (cross-checked against the Binance app).
// If we ever support exotic collateral with different tiers, move this into a
// per-asset table keyed on collateral.asset.
export const WARNING_LTV = 85;
export const LIQ_LTV = 91;

export type Status = "ok" | "warn" | "danger";

export function statusFromLtv(ltv: number, target: number = DEFAULT_TARGET_LTV): Status {
  if (ltv >= WARNING_LTV) return "danger";
  if (ltv >= target) return "warn";
  return "ok";
}

export function statusLabel(s: Status): string {
  return s === "ok" ? "Healthy" : s === "warn" ? "Caution" : "At risk";
}

/**
 * Price of the collateral asset at which the loan reaches `targetLtv`.
 */
export function priceAtLtv(loan: Loan, targetLtv: number): number {
  // ltv = debt / (qty * price) * 100 => price = debt / qty / (targetLtv/100)
  return loan.debtUsd / loan.collateral.qty / (targetLtv / 100);
}

export function currentCollateralPrice(loan: Loan): number {
  return loan.collateral.valueUsd / loan.collateral.qty;
}

export function priceDropPctTo(loan: Loan, targetLtv: number): number {
  const now = currentCollateralPrice(loan);
  const target = priceAtLtv(loan, targetLtv);
  return ((now - target) / now) * 100;
}

/**
 * Signed USD distance between the loan's current collateral and the
 * collateral level required to sit exactly at `targetLtv`.
 *
 *   POSITIVE → current LTV is BELOW target; this much excess collateral
 *              could be removed (or this much extra debt taken) before
 *              hitting target. This is genuine headroom.
 *   NEGATIVE → current LTV is ABOVE target; this much *additional*
 *              collateral would need to be added to bring LTV back down
 *              to target. There is NO headroom — you're already over.
 *   ZERO     → exactly at target.
 *
 * Callers must respect the sign. Earlier revisions returned the opposite
 * sign and the UI cheerfully showed a "+$128k headroom" for a loan that
 * was actually $128k over target.
 */
export function headroomToTarget(loan: Loan, targetLtv: number = DEFAULT_TARGET_LTV): number {
  const requiredCollateral = loan.debtUsd / (targetLtv / 100);
  return loan.collateral.valueUsd - requiredCollateral;
}

/**
 * USD of extra collateral needed to bring a loan DOWN to `targetLtv`.
 * Zero when the loan is already at or below target. Always non-negative.
 */
export function collateralShortfallToTarget(
  loan: Loan,
  targetLtv: number = DEFAULT_TARGET_LTV,
): number {
  const h = headroomToTarget(loan, targetLtv);
  return h < 0 ? -h : 0;
}

export function nextAction(
  loans: Loan[],
  targetLtv: number = DEFAULT_TARGET_LTV,
): { loanId: string; asset: string; amountUsd: number } | null {
  const worst = [...loans].sort((a, b) => b.ltv - a.ltv)[0];
  if (!worst || worst.ltv < targetLtv) return null;
  const need = collateralShortfallToTarget(worst, targetLtv);
  if (need <= 0) return null;
  return {
    loanId: worst.id,
    asset: worst.collateral.asset,
    amountUsd: need,
  };
}
