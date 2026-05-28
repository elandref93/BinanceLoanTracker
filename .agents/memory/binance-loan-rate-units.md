---
name: Binance loan interest-rate field unit ambiguity
description: Binance's loan/margin endpoints return interest rates under field names that don't reliably indicate the unit (annual vs daily vs hourly). Pick by name semantics, then sanity-clamp by implied APR.
---

Binance crypto-loans / margin endpoints return interest rates under field
names whose **unit cannot be inferred from the name** and which differ
across API revisions and product surfaces. Specifically:

- `flexibleInterestRate` on `/sapi/v2/loan/flexible/loanable/data` is the
  **annual** rate as a decimal — e.g. `"0.0502878"` means 5.02878% APR,
  not 5%/hour. Treating it as hourly inflates APR by 8760× (the
  44,052%-APR bug seen on TestFlight).
- `hourlyInterestRate` on flexible/fixed `ongoing/orders` rows is usually
  the actual hourly decimal, but Binance has shipped revisions where the
  same key carries an annual value.
- `nextHourlyInterestRate` on `/sapi/v1/margin/next-hourly-interest-rate`
  is reliably hourly decimal.

**Why:** A USDC loan at ~5% APR has hourly = ~5.7e-6. The user-facing
display is `apr = hourly × 24 × 365 × 100`. A unit confusion of 8760×
turns "5% APR / ~$100/day" into "44,052% APR / ~$880k/day" on a $730k
loan — silent and very wrong.

**How to apply:** Use a single `pickHourlyRate(row, context)` helper at
every Binance rate-extraction site (flexible loanable sheet, flexible
order rows, fixed order rows, future endpoints). It must:
1. Read each candidate field and normalise to hourly using the field's
   **name** semantics (annual → /8760, daily → /24, hourly → as-is).
2. Reject any candidate whose implied APR exceeds a plausibility cap
   (200% APR / 2.0 fractional) and log a warning with the field label.
3. Return the first surviving candidate.

Do **not** add new rate-extraction call sites that read raw fields and
multiply directly. New endpoints get a new entry in the candidate list
inside `pickHourlyRate` and inherit the sanity clamp.
