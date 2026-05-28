# BTC Leverage vs Pure AMC — Calculator Engine Documentation

> For porting the `compute()` engine into a React Native app.
> The math is framework-agnostic; only the UI layer needs rewriting.

---

## 1. What This Calculator Does

It compares two long-term wealth strategies side by side, month by month, after tax:

- **Strategy A — "BTC + Lever → AMC":** Hold Bitcoin as a permanent collateral base, borrow against it, and deploy the borrowed cash into an Actively Managed Certificate (AMC) earning a target return. Rebalance once a year.
- **Strategy B — "Pure AMC":** Put the same money straight into the AMC and let it compound untouched until exit.

The whole point is to answer: *does it beat the simple approach to keep your BTC, borrow cheaply against it, and farm the spread — once you account for South African tax?*

The headline finding the model surfaces: **A wins under low tax (personal/tax-free) but the trust's 36% annual CGT drag can let B overtake A**, because A realises gains every year while B defers all tax to exit.

---

## 2. The Two Strategies in Detail

### Strategy A — BTC + Leverage
1. **Day 1 (if starting capital > 0):** the starting lump sum is bought as BTC. Immediately borrow `LTV%` of it and deploy that loan into the AMC.
2. **Every month:** the contribution buys more BTC. Immediately borrow `LTV%` of that contribution and deploy into the AMC.
3. **Everything grows monthly:** BTC at the BTC growth rate, AMC at the options/AMC return, and the outstanding loan accrues interest at the borrow cost.
4. **Once a year (rebalance):**
   - Sell the entire AMC position → realise the gain.
   - Pay CGT on that gain **now** (this is the key tax drag).
   - Repay all outstanding loans (principal + accrued interest).
   - Whatever after-tax cash is left over is profit.
   - **Re-gear:** take a fresh loan equal to `LTV%` of the *total* current BTC value, and redeploy (leftover profit + fresh loan) into the AMC with a fresh cost base.
5. **BTC is never sold** during the run — it's only ever borrowed against. Under SA law, borrowing is not a disposal, so **no CGT is triggered on the BTC** until a real exit.

### Strategy B — Pure AMC
1. **Day 1:** starting capital goes straight into the AMC.
2. **Every month:** the contribution goes into the AMC.
3. The AMC compounds at the options/AMC return. **Nothing is ever sold**, so all gains stay inside the wrapper, tax-deferred.
4. CGT is only ever paid once, hypothetically, at the exit (snapshot) year.

---

## 3. Inputs

| Input | Type | Range / Notes |
|-------|------|---------------|
| `btcGrowth` | % p.a. | BTC annual appreciation (e.g. 29) |
| `optionsReturn` | % p.a. | AMC / options annual return (e.g. 45) |
| `ltv` | % | Loan-to-value ratio borrowed against BTC (e.g. 60) |
| `borrowCost` | % p.a. | Interest rate on the BTC-backed loan (e.g. 3) |
| `startingCapital` | ZAR | Lump sum at day 1 (assumed held in BTC). Editable, uncapped. |
| `monthlyContrib` | ZAR | Monthly contribution. Editable, uncapped. |
| `contribEscalation` | % p.a. | Annual increase applied to the monthly contribution |
| `years` | integer | Horizon, 1–20 |
| `taxMode` | enum | `"personal"`, `"trust"`, or `"taxfree"` |

---

## 4. Tax Treatment (South Africa)

CGT is calculated as: **effective rate = inclusion rate × 45% marginal rate**, applied to the *gain* only.

| Mode | Inclusion | Effective CGT | Annual Exclusion |
|------|-----------|---------------|------------------|
| Personal | 40% | **18%** | R40,000 / year |
| Trust | 80% | **36%** | R0 (trusts get none) |
| Tax-Free | 0% | **0%** | N/A |

**The critical asymmetry:**
- **A pays CGT every year** on its realised AMC gains. That tax leaves the system and can never compound again.
- **B defers all CGT to exit** — the full gross amount keeps compounding the whole time.

This is why a higher tax rate hurts A far more than B. At 36% (trust), the annual bleed can overwhelm A's higher gross return. At 18% (personal) or 0% (tax-free), A's leverage advantage wins.

---

## 5. The Core Algorithm (pseudocode)

```
# Derive effective tax params from taxMode
inclusion   = {personal: 0.40, trust: 0.80, taxfree: 0.0}[taxMode]
effectiveCGT = inclusion * 0.45
annualExcl  = (taxMode == "personal") ? 40000 : 0
ltvFrac     = ltv / 100

# Convert annual rates to monthly (geometric, NOT simple division)
mBtc = (1 + btcGrowth/100)^(1/12) - 1
mOpt = (1 + optionsReturn/100)^(1/12) - 1
mBor = (1 + borrowCost/100)^(1/12) - 1

# ---- Strategy A initial state: starting capital is BTC, immediately levered ----
initLoan = startingCapital * ltvFrac
btcVal   = startingCapital      # BTC market value
btcBase  = startingCapital      # BTC cost base (for CGT)
amc      = initLoan             # AMC market value
amcBase  = initLoan             # AMC cost base
debt     = initLoan             # outstanding loan
cumA     = startingCapital      # total contributed
totTaxA  = 0                    # cumulative tax paid

# ---- Strategy B initial state: starting capital straight into AMC ----
bVal  = startingCapital
bBase = startingCapital

for month in 1..(years*12):
    yearIndex = floor((month - 1) / 12)
    curContrib = monthlyContrib * (1 + contribEscalation/100)^yearIndex

    # 1. Grow existing positions
    btcVal *= (1 + mBtc)
    if amc  > 0: amc  *= (1 + mOpt)
    if debt > 0: debt *= (1 + mBor)

    # 2. Contribution buys BTC
    btcVal += curContrib;  btcBase += curContrib;  cumA += curContrib

    # 3. Immediately lever the new BTC
    mLoan = curContrib * ltvFrac
    amc  += mLoan;  amcBase += mLoan;  debt += mLoan

    # 4. Strategy B: grow then contribute
    bVal *= (1 + mOpt);  bVal += curContrib;  bBase += curContrib

    # 5. ANNUAL REBALANCE
    if month % 12 == 0:
        amcGain = max(0, amc - amcBase)
        amcTax  = max(0, amcGain - annualExcl) * effectiveCGT   # PAY TAX NOW
        totTaxA += amcTax
        afterTax = amc - amcTax
        netCash  = afterTax - debt          # repay all loans
        newLoan  = btcVal * ltvFrac          # re-gear against TOTAL BTC
        reinvest = max(0, netCash)
        amc      = reinvest + newLoan         # redeploy
        amcBase  = reinvest + newLoan         # fresh cost base (already taxed)
        debt     = newLoan

        # ---- Snapshot exit value at this year ----
        # A: BTC unrealised (CGT only hypothetically at exit) + AMC equity (already taxed)
        btcGain  = max(0, btcVal - btcBase)
        btcTax   = max(0, btcGain - annualExcl) * effectiveCGT
        equity   = amc - debt                 # == reinvest
        aNet     = btcVal + equity - btcTax

        # B: market value minus hypothetical exit CGT
        bGain    = max(0, bVal - bBase)
        bTax     = max(0, bGain - annualExcl) * effectiveCGT
        bNet     = bVal - bTax

        record year-row { aNet, bNet, btcVal, amc, debt, equity,
                          amcGain, amcTax, btcTax, netCash, newLoan,
                          contributed: cumA, monthlyAtYear: curContrib }
```

**Growth rate** for the year-over-year table = `(thisYearNet / lastYearNet) - 1`. Watching A's rate decline while B's holds steady is what reveals the crossover.

---

## 6. Output Data Per Year

Each rebalance pushes a row with:

| Field | Meaning |
|-------|---------|
| `aNet` / `bNet` | After-tax exit value at that year |
| `btcVal` | BTC market value (A) |
| `amc` | AMC deployed (after re-gear) |
| `debt` | Outstanding loan after re-gear |
| `equity` | After-tax profit reinvested (amc − debt) |
| `amcGain` | Realised AMC gain that year |
| `amcTax` | CGT paid that year on AMC gain |
| `btcTax` | Hypothetical BTC exit CGT at that year |
| `netCash` | Cash after tax + loan repayment |
| `newLoan` | Re-geared loan = LTV% × BTC |
| `contributed` | Cumulative capital in |
| `monthlyAtYear` | The escalated monthly amount in that year |
| `growthRate` | YoY % change in net value |

---

## 7. Verified Results (regression fixtures)

These are exact outputs the ported engine must reproduce. Use them as unit tests.

**Defaults: BTC 29%, AMC 45%, LTV 60%, borrow 3%, R600k/mo, 0% esc, 10yr**

| Scenario | A Net (Y10) | B Net (Y10) | A Total Tax |
|----------|-------------|-------------|-------------|
| Trust, R0 start | R507,032,037 | R515,379,634 | R161,160,147 |
| Personal, R0 start | R725,693,156 | R640,087,356 | R100,645,095 |
| Tax-Free, R0 start | R1,017,828,134 | R764,780,678 | R0 |
| Trust, R5m start | R625,704,593 | R648,650,644 | — |

**Escalation: 10% esc, R600k/mo, R0 start, 10yr** → Total contributed = **R114,749,457**; Y1 monthly R600,000; Y10 monthly R1,414,769.

**Sanity flips:**
- Trust: B overtakes A's *growth rate* around Y6; B's net passes A's around Y10.
- Borrow cost 30% (trust): A collapses to R236.5m, B wins decisively.

---

## 8. Key Modelling Assumptions (document these in-app)

1. Borrowing against BTC is **not a disposal** → no CGT on BTC from leveraging (correct SA law).
2. Strategy A sells the **entire** AMC annually → realises gains → triggers annual CGT.
3. After-tax AMC profit is reinvested with a **fresh cost base** (it's already been taxed).
4. Strategy B **never sells** until exit → full tax deferral inside the AMC wrapper.
5. Re-gearing borrows `LTV%` of **total** BTC value, not just new contributions.
6. Returns are **deterministic** — smooth compounding, no volatility or drawdowns.
7. Loan interest accrues monthly and is repaid in full at each annual rebalance.
8. BTC CGT is shown as a **hypothetical exit tax** at each snapshot year (BTC isn't actually sold).
9. Trusts: 80% inclusion, no annual exclusion. Personal: 40% inclusion, R40k annual exclusion.
10. Monthly rates use **geometric** conversion `(1+annual)^(1/12) − 1`, not annual÷12.

---

## 9. What the Model Does NOT Cover (disclaimers)

- BTC price **volatility** and **liquidation cascades** (a 40%+ drawdown at 60% LTV triggers margin calls).
- Intra-year margin top-ups.
- AMC management fees and performance fees.
- ZAR/USD **forex risk** (if BTC priced in USD, AMC in ZAR, or vice versa).
- **Section 7C** loan implications for trust structures.
- SARS audit / re-characterisation risk.
- Liquidity timing of the annual sell-and-rebuy.

This is a planning tool, not financial advice — surface this prominently.

---

## 10. React Native Porting Notes

- **The `compute()` function is pure** — no DOM, no React. Drop it into a `utils/` module unchanged. It takes a params object and returns `{ rowsA, rowsB, grossEffA, grossEffB, effectiveCGT, annualExcl, totTaxA }`.
- Wrap it in `useMemo` keyed on the input params (same as the web version) so it only recomputes on change.
- **Sliders:** React Native has no `<input type=range>`. Use `@react-native-community/slider`. The "tap-to-type custom value" behaviour maps to a `TextInput` toggled by state — keep `editable` numeric fields uncapped while the slider stays bounded.
- **Charts:** the web version hand-rolls SVG polylines. In RN use `react-native-svg` (same `<Polyline>`/`<Path>` primitives) or a lib like `victory-native` / `react-native-gifted-charts`.
- **Currency formatting:** the `fmt()` helper (bn/m/k suffixes) is plain JS — reuse as-is.
- **Number precision:** all math is float64; no rounding until display. Keep it that way for the fixtures above to match.
- **Effective gross rate** (shown on the A card) = `btcGrowth + ltvFrac × (optionsReturn − borrowCost)`. This is A's theoretical pre-tax compounding rate; useful as a headline metric.
- **Break-even borrow rate** = `optionsReturn − (optionsReturn − btcGrowth) / ltvFrac`. Above this borrow cost, leverage stops adding value.
