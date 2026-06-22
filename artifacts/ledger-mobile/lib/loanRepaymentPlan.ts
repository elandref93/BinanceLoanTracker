export type ScheduleRow = {
  month: number;
  interest: number;
  payment: number;
  endBalance: number;
};

/** Month-by-month payoff simulation; returns null when contribution never clears debt. */
export function monthsToSettle(
  principal: number,
  monthlyRate: number,
  contribution: number,
): number | null {
  if (principal <= 0) return 0;
  if (contribution <= 0) return null;
  let balance = principal;
  for (let m = 1; m <= 600; m++) {
    balance = balance * (1 + monthlyRate) - contribution;
    if (balance <= 0) return m;
  }
  return null;
}

/** Required monthly payment to clear principal in n months at monthlyRate. */
export function requiredMonthly(
  principal: number,
  monthlyRate: number,
  n: number,
): number {
  if (n <= 0) return principal;
  if (monthlyRate <= 1e-9) return principal / n;
  const f = Math.pow(1 + monthlyRate, -n);
  return (principal * monthlyRate) / (1 - f);
}

/** Month-by-month amortisation schedule aligned with monthsToSettle / requiredMonthly. */
export function buildSchedule(
  principal: number,
  monthlyRate: number,
  payment: number,
  maxMonths: number,
): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  let balance = principal;
  const cap = Math.min(Math.max(0, Math.round(maxMonths)), 600);
  for (let m = 1; m <= cap && balance > 0; m++) {
    const interest = balance * monthlyRate;
    const due = balance + interest;
    const pay = Math.min(payment, due);
    const endBalance = Math.max(0, due - pay);
    rows.push({ month: m, interest, payment: pay, endBalance });
    balance = endBalance;
  }
  return rows;
}

// ── "Build collateral" mode ──
// Instead of paying down the debt, the user keeps buying a collateral asset
// (e.g. BTC) at today's rate and adding it to the position. The debt keeps
// accruing interest, but the growing collateral lowers LTV over time. All
// amounts are in a single currency (USD) and the collateral price is assumed
// flat — the contribution simply adds that much value each month.

export type CollateralRow = {
  month: number;
  /** Debt interest accrued this month. */
  interest: number;
  /** Collateral value added this month (= the monthly contribution). */
  collateralAdded: number;
  /** Debt outstanding at month end. */
  debt: number;
  /** Total collateral value at month end. */
  collateralValue: number;
  /** LTV (%) at month end. */
  ltv: number;
};

export type CollateralPlanInput = {
  debt: number;
  collateralValue: number;
  monthlyRate: number;
  /** Value added to collateral each month (collateral price assumed flat). */
  monthlyContribution: number;
  /** Stop once LTV reaches/drops below this (%). */
  targetLtv: number;
  maxMonths?: number;
};

/**
 * Project LTV month-by-month as the borrower adds to collateral while interest
 * accrues on the debt. Returns the schedule up to (and including) the month the
 * target LTV is reached, or up to maxMonths if it is never reached.
 */
export function buildCollateralSchedule(input: CollateralPlanInput): CollateralRow[] {
  const {
    debt,
    collateralValue,
    monthlyRate,
    monthlyContribution,
    targetLtv,
    maxMonths = 600,
  } = input;
  const rows: CollateralRow[] = [];
  let bal = debt;
  let col = collateralValue;
  const cap = Math.min(Math.max(0, Math.round(maxMonths)), 600);
  for (let m = 1; m <= cap; m++) {
    const interest = bal * monthlyRate;
    bal = bal + interest;
    col = col + monthlyContribution;
    const ltv = col > 0 ? (bal / col) * 100 : Infinity;
    rows.push({
      month: m,
      interest,
      collateralAdded: monthlyContribution,
      debt: bal,
      collateralValue: col,
      ltv,
    });
    if (ltv <= targetLtv) break;
  }
  return rows;
}

/**
 * Months until the target LTV is reached under {@link buildCollateralSchedule},
 * or null when the contribution never outpaces interest growth within the cap.
 */
export function monthsToTargetLtv(input: CollateralPlanInput): number | null {
  const startLtv =
    input.collateralValue > 0
      ? (input.debt / input.collateralValue) * 100
      : Infinity;
  if (startLtv <= input.targetLtv) return 0;
  const rows = buildCollateralSchedule(input);
  const last = rows[rows.length - 1];
  if (last && last.ltv <= input.targetLtv) return last.month;
  return null;
}
