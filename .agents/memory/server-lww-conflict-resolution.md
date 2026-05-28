---
name: Server-side last-write-wins conflict resolution
description: Two pitfalls when implementing LWW sync on a Node/Express backend — async interleaving (not "single-threaded") and client clock skew.
---

**Rule:** When a Node/Express endpoint does read-compare-write on a per-user blob (LWW conflict check, optimistic concurrency, etc.), two things must be true:

1. The read and the write must be serialized **per user**, not globally. Node's single-threaded event loop is NOT a serialization guarantee — every `await` is an interleave point, so two concurrent PUTs for the same user can both read the same "old" timestamp, both pass the conflict check, and the later disk write silently wins. Use a per-key promise-chain mutex.
2. The client must emit **process-monotonic** timestamps, not raw `new Date()`. Two writes in the same millisecond, NTP adjustments, or manual clock changes will otherwise collide with the server's strict-greater check (or worse, look identical). On the client, clamp each issued timestamp to `max(Date.now(), lastIssued + 1)` and pull the high-water mark forward from any server response you observe.

Use `>=` (not `>`) on the server when deciding "stored is at least as new as incoming → reject" so equal timestamps don't silently overwrite.

**Why:** First pass of the Ledger account-sync route had a global mutex assumption ("Node is single-threaded so I'm fine") plus `new Date().toISOString()` on the client. Architect review caught both — under the documented 3-user iPhone+iPad workload they were latent rather than reproducible, but they would have eaten edits the first time someone made rapid changes on two devices at once.

**How to apply:** Any LWW endpoint touching per-user state needs:
- A `Map<key, Promise>` per-user mutex around the read+compare+write block.
- A `nextMonotonicTimestamp()` helper on the client; never call `Date.now()` directly at write sites.
- Symmetric `>=` comparison on the server.
- 409 response that returns the current server blob so the client can re-hydrate without an extra round trip.
