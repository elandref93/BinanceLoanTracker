import type { Loan } from "@workspace/api-client-react";

export const DEFAULT_TARGET_LTV = 65;
/** @deprecated Prefer `useTargetLtv()` from `@/context/RiskSettingsContext`. */
export const TARGET_LTV = DEFAULT_TARGET_LTV;
export const WARNING_LTV = 72;
export const LIQ_LTV = 78;

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
 * USD amount of additional collateral that would lower LTV to `targetLtv`.
 * Positive = need to add collateral, negative = could remove.
 */
export function headroomToTarget(loan: Loan, targetLtv: number = DEFAULT_TARGET_LTV): number {
  const requiredCollateral = loan.debtUsd / (targetLtv / 100);
  return requiredCollateral - loan.collateral.valueUsd;
}

export function nextAction(
  loans: Loan[],
  targetLtv: number = DEFAULT_TARGET_LTV,
): { loanId: string; asset: string; amountUsd: number } | null {
  const worst = [...loans].sort((a, b) => b.ltv - a.ltv)[0];
  if (!worst || worst.ltv < targetLtv) return null;
  const need = headroomToTarget(worst, targetLtv);
  if (need <= 0) return null;
  return {
    loanId: worst.id,
    asset: worst.collateral.asset,
    amountUsd: need,
  };
}
