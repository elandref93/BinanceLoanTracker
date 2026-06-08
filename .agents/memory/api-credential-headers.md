---
name: Stateless API server — per-request exchange credential headers
description: How ledger-mobile passes Binance/Luno keys to the stateless api-server, and why non-foreground callers must replicate the headers.
---

The `api-server` is intentionally **stateless about exchange credentials** — it
never stores Binance/Luno API keys. The device sends them on **every request**
as base64-encoded JSON headers: `X-Binance-Accounts` and `X-Luno-Accounts`
(shape `{id,name,apiKey,apiSecret}[]`). `/api/loans` builds a per-request client
from these; if the header is missing it returns **zero loans** (no error).

In the app, these headers are injected centrally via `setExtraHeadersGetter(...)`
in `app/(tabs)/_layout.tsx`, sourced from `getBinanceLinks()` / `getLunoLinks()`
(`lib/accountStore.ts`) and encoded with `toBase64` (`lib/encoding.ts`). That
getter only runs while the tab UI is mounted (foreground).

**Why this matters / the trap:** any caller that hits `/api/loans` *outside* the
foreground api-client must rebuild these headers itself. The headless
`expo-background-fetch` task (`lib/backgroundTask.ts`) originally sent only the
`Bearer` session token, so every background run got zero loans → no LTV sample,
and could even zero out the widget. Fixed by replicating the header builder there.

**How to apply:** before adding any new server-side scheduler, headless task, or
out-of-band caller of `/api/loans` (or other exchange-backed routes), remember
the server has no keys — you must supply `X-Binance-Accounts` (and Luno) or you
get empty data. A true server-side background refresh is impossible without
changing this design to store keys server-side (a deliberate security tradeoff).

**iOS background reality:** `expo-background-fetch` (BGAppRefreshTask) is
opportunistic — iOS decides cadence by usage/battery/network and does **not**
run it at all when the user force-quits (swipes away) the app. So even with the
header fix, background LTV updates are best-effort, not guaranteed; data updates
reliably only on foreground. Requires "Background App Refresh" enabled too.
