---
name: Binance batch ticker pricing is all-or-nothing
description: Why pricing holdings via a batched /api/v3/ticker/price call can blank an entire portfolio, and how to keep it resilient.
---

Binance `/api/v3/ticker/price?symbols=[...]` rejects the ENTIRE batch with
HTTP 400 (`-1121 Invalid symbol`) if even one requested pair doesn't exist.
Holdings sets routinely contain assets with no `<ASSET>USDT` pair (delisted
coins, Earn-only tokens, dust), so a single bad symbol throws and aborts the
whole holdings response.

**Why:** This produced a real outage — the mobile app showed ZERO Binance
assets while loans rendered fine. Loans only price liquid majors (BTC/ETH/USDT)
which always have USDT pairs, so they never tripped the invalid-symbol error.
The price helper awaited the batch call unguarded, so the throw bubbled up
through `getHoldings()` to the route.

**How to apply:** Any price lookup that batches per-symbol against Binance must
tolerate invalid symbols. Pattern used: try the batch; on failure fall back to
the FULL ticker list (one call, no per-symbol validation) and look up locally;
if that also fails, default prices to 0 so quantities still render. Never let a
pricing failure blank the whole holdings/loans payload — degrade to usd=0, not
to an empty list. Note pricing still resolves only via `<ASSET>USDT`, so assets
quoted only in USDC/BTC/etc. value at 0 (understated, not an outage).
