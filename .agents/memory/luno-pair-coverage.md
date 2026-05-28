---
name: Luno pair coverage is region-shaped
description: Luno lists most pairs against ZAR (home market). USD-anchored display must route via USDC. Some conversions need the inverse pair (1 / lastTrade).
---

Luno's pair universe isn't symmetrical. Pricing helpers and any "total fiat value" calculation must respect this or USD-display users see zeros.

**Why:** Luno is South-Africa-first. Crypto assets list directly against ZAR (XBTZAR, ETHZAR, SOLZAR, USDCZAR, etc.). They do NOT list a `XYZUSD` pair. They list `XYZUSDC` for some assets, and `USDCZAR` for the stablecoin itself — but there is no `ZARUSDC`, so converting ZAR cash to USD must go via `1 / USDCZAR.lastTrade`.

**How to apply:**

- For display currency **ZAR**: every crypto asset uses `{ASSET}ZAR` directly.
- For display currency **USD**:
  - Treat `USD`, `USDC`, `USDT` as 1:1 cash (no ticker needed).
  - Quote crypto via `{ASSET}USDC` (USDC ≈ USD for read-only valuation).
  - ZAR cash needs the *inverse* pair: amount-in-USD = ZAR / USDCZAR.lastTrade.
- The batch ticker endpoint silently drops unsupported pairs — callers must always gracefully return 0 for a missing quote and never block on it. Don't error a whole dashboard because Luno doesn't list SOLZAR yet.

Centralize this in one helper module (we use `lib/lunoPricing.ts`) and have every consumer — dashboard tile, crypto tab, history sampler — use it, so they all agree on which pairs to fetch and how to combine balance × price.
