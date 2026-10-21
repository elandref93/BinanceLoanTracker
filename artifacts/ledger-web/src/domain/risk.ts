/**
 * LTV helpers used by the dashboard, ported from the mobile risk module.
 * Headroom is signed: positive means collateral can be removed before the
 * target, negative means collateral is already short of the target.
 */

export const DEFAULT_TARGET_LTV = 65;
export const WARNING_LTV = 85;
export const LIQ_LTV = 91;

export type Status = "ok" | "warn" | "danger";

export type RiskLoan = {
  id: string;
  debtUsd: number;
  ltv: number;
  collateral: {
    asset: string;
    qty: number;
    valueUsd: number;
  };
};

export function statusFromLtv(ltv: number, target: number = DEFAULT_TARGET_LTV): Status {
  if (ltv >= WARNING_LTV) return "danger";
  if (ltv >= target) return "warn";
  return "ok";
}

export type RiskBand = "healthy" | "above" | "margin" | "liquidation";

/**
 * Four LTV bands that match Binance: below the profile target is healthy,
 * target to 85% is above target, 85% to 91% is margin call, 91% and over is
 * liquidation. A missing target falls back to the 65% default.
 */
export function riskBand(ltv: number, target: number = DEFAULT_TARGET_LTV): RiskBand {
  if (ltv >= LIQ_LTV) return "liquidation";
  if (ltv >= WARNING_LTV) return "margin";
  if (ltv >= target) return "above";
  return "healthy";
}

export function riskBandLabel(band: RiskBand): string {
  if (band === "healthy") return "Healthy";
  if (band === "above") return "Above target";
  if (band === "margin") return "Margin call";
  return "Liquidation";
}

/** Higher is worse. Used to rank loans worst first. */
export function riskSeverity(ltv: number, target: number = DEFAULT_TARGET_LTV): number {
  const order: Record<RiskBand, number> = { healthy: 0, above: 1, margin: 2, liquidation: 3 };
  return order[riskBand(ltv, target)] * 1000 + (Number.isFinite(ltv) ? ltv - target : 0);
}

export function statusLabel(status: Status): string {
  return status === "ok" ? "Healthy" : status === "warn" ? "Caution" : "At risk";
}

export function priceAtLtv(loan: RiskLoan, targetLtv: number): number {
  const qty = loan.collateral.qty;
  if (qty <= 0 || targetLtv <= 0) return 0;
  return loan.debtUsd / qty / (targetLtv / 100);
}

export function currentCollateralPrice(loan: RiskLoan): number {
  const qty = loan.collateral.qty;
  if (qty <= 0) return 0;
  return loan.collateral.valueUsd / qty;
}

export function priceDropPctTo(loan: RiskLoan, targetLtv: number): number {
  const now = currentCollateralPrice(loan);
  if (now <= 0) return 0;
  const target = priceAtLtv(loan, targetLtv);
  return ((now - target) / now) * 100;
}

export function headroomToTarget(loan: RiskLoan, targetLtv: number = DEFAULT_TARGET_LTV): number {
  const requiredCollateral = loan.debtUsd / (targetLtv / 100);
  return loan.collateral.valueUsd - requiredCollateral;
}

export function collateralShortfallToTarget(
  loan: RiskLoan,
  targetLtv: number = DEFAULT_TARGET_LTV,
): number {
  const headroom = headroomToTarget(loan, targetLtv);
  return headroom < 0 ? -headroom : 0;
}

/** Snapshot loans do not include a collateral quantity, so a price cannot be derived. */
export function canDeriveCollateralPrice(loan: RiskLoan): boolean {
  return loan.collateral.qty > 0 && currentCollateralPrice(loan) > 0;
}
