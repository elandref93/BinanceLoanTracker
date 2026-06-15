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
