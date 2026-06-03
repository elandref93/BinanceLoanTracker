---
name: Silent-failure UX patterns in Ledger mobile
description: Two recurring ways failures become invisible to users in this app, and the fix shape for each.
---

# Errors below the fold read as "nothing happened"
On long scrolling forms whose primary action button sits in the header
(e.g. add-account.tsx Save), an inline error rendered at the BOTTOM is
off-screen when the user taps Save — so validation / duplicate-link /
QR-parse failures look like a no-op.

**Why:** the action and its feedback are at opposite ends of a scroll view.
**How to apply:** route every failure path through a single helper that BOTH
sets inline state AND fires `Alert.alert`, and place the inline banner next to
the action (top of form), not at the end.

# Resilient multiplex clients hide dead exchange keys
`api-server` `createMultiplexBinanceClient` fans out with
`Promise.allSettled` and omits failed accounts, returning HTTP 200 with a
shorter list. A revoked/expired Binance key therefore silently disappears
from the combined Binance+Luno portfolio with no error.

**Why:** partial-success multiplexing trades visibility for resilience.
**How to apply:** never rely on the aggregate call to surface a bad key.
Probe each key individually where the user can act on it (Accounts screen
uses `lib/keyHealth.ts probeAccount`, which was built for this) and show a
per-key "not working — tap to replace" recovery path.
