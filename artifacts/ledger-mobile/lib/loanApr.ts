/** Hours in a year — keep in sync with the server's rate math. */
export const HOURS_PER_YEAR = 24 * 365;

type LoanRateFields = {
  apr: number;
  hourlyInterestRate: number;
};

/**
 * Best-effort APR % for display. Binance sometimes omits or zeroes `apr` on
 * the loan row while still shipping a usable hourly rate, or the interest
 * endpoint has a trailing average from real accruals.
 */
export function effectiveLoanApr(
  loan: LoanRateFields,
  fallbackApr?: number,
): number {
  if (Number.isFinite(loan.apr) && loan.apr > 0) return loan.apr;
  if (Number.isFinite(loan.hourlyInterestRate) && loan.hourlyInterestRate > 0) {
    return loan.hourlyInterestRate * HOURS_PER_YEAR * 100;
  }
  if (fallbackApr != null && Number.isFinite(fallbackApr) && fallbackApr > 0) {
    return fallbackApr;
  }
  return 0;
}
