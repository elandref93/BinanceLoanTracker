---
name: expo-haptics from background contexts
description: Whether to gate haptics calls behind AppState when they may fire from background-fetch tasks.
---

When a function might run in both foreground (from a screen) and background (from `expo-task-manager` / `expo-background-fetch`), don't add an extra `AppState.currentState === 'active'` guard before calling `expo-haptics` — it's redundant.

**Why:** `expo-haptics` on iOS is a no-op when the app is suspended, and any
throw is already caught by a thin `safe(fn)` wrapper. Adding an AppState
read in every shared code path costs a JSI hop and makes the foreground
path harder to read, without changing user-visible behaviour.

**How to apply:** Keep a single `haptic.*` helper that wraps each call in
try/catch + Platform.OS check. Call it from shared code (e.g. alert-fire
functions) without an extra AppState branch. Only gate on AppState if you
have a stronger reason (e.g. avoiding console warnings the OS actually
emits).
