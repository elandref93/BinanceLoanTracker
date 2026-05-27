---
name: Multi-account fan-out limits must be global
description: When an endpoint with a `limit` parameter multiplexes across N upstream accounts, divide budget per-account and re-sort + trim post-merge.
---

If a server endpoint exposes `limit` and fans the request out across N per-account upstream clients, naïvely passing the caller's full `limit` to each client and concatenating the results breaks the wire contract two ways:

1. The response can contain up to `N × limit` rows — clients budgeting on the documented cap get blown out.
2. The concatenated stream is only sorted within each account, not across them, so "newest first" is a lie as soon as N > 1.

**Why:** This shipped in the Luno multiplex before architect caught it. Same shape applies to any future Binance/exchange multiplex.

**How to apply:** Compute a per-account budget (`ceil(limit / N) + headroom`), pass that to each upstream call, then sort the merged array on the documented sort key and slice to `limit` before returning. Headroom protects against one account being denser than another swallowing the top global rows.

```ts
const perAccount = Math.max(MIN, Math.ceil(limit / Math.max(1, N)) + HEADROOM);
const merged = await fanOut(members, op, (m) =>
  m.client.list({ ...opts, limit: perAccount }),
);
merged.sort(byTimestampDesc);
return merged.slice(0, limit);
```

Endpoints without a `limit` (e.g. `/wallets`, `/pending`) don't need this — concatenation is correct since each account's full set is requested.
