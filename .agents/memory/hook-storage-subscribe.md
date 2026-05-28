---
name: React hook reading module-level storage needs subscribe
description: A hook that reads a persisted ring buffer (AsyncStorage, SecureStore, file) won't see new writes until remount unless the storage module exposes a pub/sub channel.
---

If a React hook calls `useEffect(() => { void read().then(setState) }, [args])` to surface persisted data, it only re-reads when its dependency array changes — not when something else in the app writes to the same storage. The chart stays stale until the screen unmounts or the user changes a filter.

**Why:** Hit this on the Luno 7d sparkline: `recordLunoSample()` was writing happily, but `useLunoHistory()` had no signal back. Sparkline updated only after a tab switch or currency toggle.

**How to apply:** In any storage module that has both reads and writes consumed by the UI:

1. Add a tiny pub/sub on the module:
   ```ts
   const listeners = new Set<() => void>();
   export function subscribe(fn: () => void) {
     listeners.add(fn);
     return () => listeners.delete(fn);
   }
   function notify() { for (const fn of listeners) fn(); }
   ```
2. Call `notify()` at the end of every successful mutator (inside the write lock if you have one, so subscribers don't re-read mid-RMW).
3. In the hook, `subscribe(refresh)` in the effect and unsub on cleanup.

`accountStore.ts` already uses this exact pattern — match it for any new persisted reactive surface (LTV history, Luno history, alert prefs, etc.). Don't reach for a global event bus or context provider just for this — module-scoped listeners are enough for single-process state.
