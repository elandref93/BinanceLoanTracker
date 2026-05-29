---
name: WidgetKit snapshot staleness
description: Why iOS widgets drift behind the app and the two writes required to keep them fresh
---

# WidgetKit widgets go stale unless you reload AND cover the empty case

iOS WidgetKit widgets read a snapshot the app writes into the shared App Group
(`UserDefaults(suiteName:)`). Writing the value alone does NOT update the widget —
the widget only re-reads on its own `getTimeline` policy (here `.after(15min)`),
which iOS throttles heavily, so the widget drifts behind the app.

**Rule 1 — reload after every write.** After writing the App Group snapshot, call
`WidgetCenter.shared.reloadAllTimelines()`. From JS use
`ExtensionStorage.reloadWidget()` (from `@bacons/apple-targets`, whose native
module is already in the build); it no-ops safely in Expo Go / Android.

**Rule 2 — write on the empty transition too.** Early-returning when there are
zero loans (or zero items) leaves the widget showing the LAST non-empty values
forever. Always write a zeroed snapshot on a *successful* empty response so the
widget zeroes out. This applies to BOTH the foreground write and the headless
background-fetch write.

**Why:** the original bug was reported as "widget data is stale vs the app." Two
distinct causes: (a) no reload call after the App Group write, (b) empty-loans
responses skipped the write entirely.

**How to apply:** any feature that surfaces app data in a widget/complication
must (1) reload the widget after writing shared storage, and (2) write on empty
results, not just non-empty ones. Keep the snapshot write in its own effect,
decoupled from alert/history side effects (those should stay gated on non-empty).
