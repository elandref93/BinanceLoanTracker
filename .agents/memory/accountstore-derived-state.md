---
name: accountStore-derived state must subscribe
description: Any React context/hook caching data derived from accountStore must subscribe() or it serves a stale container/account list within a session.
---

Rule: If a context or hook in `artifacts/ledger-mobile` caches data derived from
`lib/accountStore` (containers, links, account→container maps), it MUST call
`accountStore.subscribe(...)` and re-load on notify — not just load once on mount.

**Why:** accountStore mutations (add/remove account, add/remove exchange link)
fire `notify()` to a private listener set. A one-time `useEffect` load goes stale
after any mutation until the provider remounts, producing wrong per-account
targets, home chips, strategy account options, and loan→container resolution
within the same session.

**How to apply:** In the provider effect, run the initial load AND
`return subscribe(() => reload())` so the cleanup unsubscribes. `subscribe` is an
exported function in `lib/accountStore.ts`.
