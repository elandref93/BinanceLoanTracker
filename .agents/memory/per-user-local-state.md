---
name: Per-user local (AsyncStorage) state on a shared device
description: How to load/save per-user drafts without leaking the previous user's state across a sign-out/sign-in.
---

When persisting per-user working state to AsyncStorage (keyed by userId) and
restoring it into React component state on sign-in:

- On user switch, if the new user has NO saved entry, you must explicitly reset
  the component state to a clean baseline. Otherwise the previous user's
  in-progress state stays on screen and then gets persisted under the new user's
  key — a real privacy leak on a shared device.
- Gate saving behind a `loaded` ref that you set `false` **synchronously** at the
  top of the load effect, and declare the load effect BEFORE the save effect, so
  on a userId change the save effect bails before it can write stale state under
  the new key.

**Why:** the Ledger calculator draft feature shipped with both gaps caught only
in review; the symptom is subtle (state looks fine until you switch accounts).

**How to apply:** any "remember my last state per user" feature backed by local
storage on the 3-user Ledger app.
