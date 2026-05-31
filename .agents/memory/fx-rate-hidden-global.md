---
name: USD->ZAR rate is a hidden mutable global
description: Why getUsdToZar() reads inside useMemo go stale, and how to keep ZAR figures live.
---

`utils/format.ts` holds the USD->ZAR rate in a **mutable module-level variable**
exposed via `getUsdToZar()` / `setUsdToZar()`. `CurrencyContext` hydrates it on
mount (live fetch via `lib/fxRate.ts`, cached in AsyncStorage, fallback 18.5) and
also mirrors it into context state as `usdToZar`.

**Why:** A `getUsdToZar()` call is a hidden global read. Render-time reads update
fine (context value identity changes on rate hydrate → consumers re-render). But
anything memoized (`useMemo`/`useCallback`) that calls `getUsdToZar()` will NOT
recompute when the rate changes unless `usdToZar` (from `useCurrency()`) is in its
dependency array. This bit `strategy.tsx`'s `livePosition` and `liveNetZar` —
they stayed stale until loan data changed.

**How to apply:** Any new memoized value that depends on the FX rate (directly via
`getUsdToZar()`, or indirectly via helpers like `snapshotFromLoans()`/`leverageSim`
which read it internally) MUST list `usdToZar` from `useCurrency()` in its deps.
