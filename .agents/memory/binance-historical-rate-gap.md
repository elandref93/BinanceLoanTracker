---
name: Binance historical-rate gap
description: Binance Loan APIs expose no historical APR series and no per-day interest rows for flexible loans — derive history client-side from local snapshots.
---

Binance's Loan API has two structural gaps that bite any "rate over time" UI:

1. **No historical-APR endpoint.** `flexible/loanable/data` returns *current*
   rates only. Server-computed `avg30dApr`/`min`/`max`/sparkline collapse to a
   flat line at today's rate. Any UI that compares "now vs 30d avg" will show
   a 0% delta forever if it trusts the server.

2. **Flexible loans post no per-day interest rows.** `/sapi/v1/loan/income`
   only emits `BORROW_DAILY_INTEREST` for fixed-term loans. Flexible-loan
   interest is silently deducted from the redeemable balance, so any bar
   chart fed from income rows is flat-zero for flexible-only users.

**How to apply:** when you need a real rate-history view, record snapshots
client-side (`lib/loanSnapshots.ts` already does this — AsyncStorage ring
buffer recorded on every successful loans fetch, gated on fresh network data
not cache, serialized through a promise-chain mutex so foreground +
bg-fetch don't clobber each other). Server values are the right fallback
until enough local samples accrue; surface that explicitly to the user
("Building rate history locally…") rather than showing a fake flat line.

Lifetime interest for flexible loans *can* be reconstructed from
`flexible/borrow/history` + `repay/history` as
`currentDebt + Σrepay − Σborrow` × spot — already implemented in
`BinanceClient.getLifetimeInterestUsd`. Uses current spot for past
transactions; only material for non-stablecoin loan assets.
