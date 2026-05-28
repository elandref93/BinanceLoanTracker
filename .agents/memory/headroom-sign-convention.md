---
name: headroomToTarget sign convention
description: utils/risk.ts `headroomToTarget` must return POSITIVE for actual buffer and NEGATIVE for over-target. Earlier inversion produced "+$128k headroom" on a loan that was $128k over target.
---

`utils/risk.ts::headroomToTarget(loan, targetLtv)` returns the **signed**
USD distance between the loan's current collateral and the collateral
level required to sit exactly at `targetLtv`:

- **Positive** → current LTV is **below** target; this much excess
  collateral could be removed (or extra debt taken) before hitting
  target. Real headroom.
- **Negative** → current LTV is **above** target; this much *additional*
  collateral would need to be added to bring LTV back to target. **No**
  headroom — already over.

**Why:** An earlier revision returned the inverted sign
(`requiredCollateral - currentCollateral`). The UI then read a positive
return value as headroom and rendered "+$128,169 headroom" for a BTC
loan at 54.9% LTV with a 50% target — i.e. a loan that was $128k of
collateral *short* of target. Real users on TestFlight saw this as a
green-light to add more debt.

**How to apply:**
- New display sites must branch on sign and use the right label
  ("Headroom to target" when ≥ 0, "Over target by" when < 0).
- Aggregate widgets across multiple loans must **not** net positives
  against negatives — one over-target loan is the user's problem even
  if others have buffer. Sum shortfalls (negatives) and headrooms
  (positives) separately and surface the worse of the two.
- `collateralShortfallToTarget(loan, targetLtv)` is provided as the
  always-non-negative helper for "how much collateral do I need to
  add" copy; use it instead of negating `headroomToTarget` inline.
