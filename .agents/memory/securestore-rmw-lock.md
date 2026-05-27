---
name: SecureStore RMW writes need a chain lock
description: SecureStore (and AsyncStorage) have no compare-and-swap, so two concurrent read-modify-write mutators silently lose updates. Serialize via a promise chain.
---

When a mutator looks like `read → modify → write` on Expo's `SecureStore` (same applies to `AsyncStorage`), two concurrent mutators interleave and the second write clobbers the first's changes — no error, no conflict surface, just a silent lost update.

**Why:** This bit the accountStore refactor: a user double-tapping "Add link" or a background refresh racing a UI remove could erase a freshly-added container. Architect flagged it before users hit it.

**How to apply:** Funnel every mutator through a single promise chain so RMW cycles run strictly in series. Reads remain unsynchronized (idempotent). The pattern:

```ts
let writeChain: Promise<unknown> = Promise.resolve();
function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  writeChain = next.catch(() => undefined); // swallow on chain only
  return next;
}
```

Catch on the chain so a failure in one mutator doesn't poison subsequent ones; the caller's promise still rejects normally.

Don't reach for this when the operation is a single `setItemAsync` with no prior read — that's already atomic w.r.t. itself.
