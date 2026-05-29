# Ledger iOS Widget (WidgetKit)

Two widgets, both reading the same shared snapshot the app writes after every loan refresh:

- **Home screen** (`HomeWidget.swift`) — small + medium families
  - Small: aggregate LTV + status label
  - Medium: aggregate LTV alongside the loan closest to liquidation and the % collateral price drop until 91% (Binance liquidation LTV)
- **Lock screen** (`LockWidget.swift`) — circular, rectangular, inline accessory families

## Architecture

```
Expo app (JS)          App Group container          Widget extension (Swift)
  ─────────              ─────────────────            ────────────────────────
  buildSnapshot()  →   UserDefaults(suiteName:    →  LoanSnapshot.load()
  writeWidgetSnapshot()  "group.com.ledger.shared")    SnapshotProvider
                         key: "ledger.snapshot.v1"     HomeWidget / LockWidget
```

The JS side calls `writeWidgetSnapshot(buildSnapshot(loans, targetLtv, accounts))` on the dashboard after each data refresh. It writes through `ExtensionStorage` (from `@bacons/apple-targets`) into the shared App Group and then calls `ExtensionStorage.reloadWidget()`, which invokes `WidgetCenter.shared.reloadAllTimelines()` so the widget updates immediately instead of waiting for its own ~15-minute timeline tick. In Expo Go / on Android the native module is absent, so it's a safe no-op.

The snapshot carries the aggregate LTV, total debt/collateral/equity, loan count, the loan closest to liquidation, and a per-account (Personal / Trust container) breakdown used by the large widget.

## Build integration (automated)

The widget extension is wired into the iOS build automatically via the [`@bacons/apple-targets`](https://github.com/EvanBacon/expo-apple-targets) config plugin (registered in `app.json` → `plugins`). The config lives in `expo-target.config.js` in this directory.

On every `eas build` (or `expo prebuild`) the plugin:

1. Creates a `LedgerWidget` Widget Extension target in the Xcode project.
2. Copies every `*.swift` and the `Info.plist` from this directory into the target.
3. Wires the `LedgerWidget.entitlements` (App Group `group.com.ledger.shared`).
4. Adds the matching App Group entitlement to the main app target (declared in `app.json` → `ios.entitlements`).

**No manual Xcode work is required.** EAS builds will include the widget out of the box.

## Local device test (optional)

```bash
cd artifacts/ledger-mobile
pnpm exec expo prebuild --platform ios --clean
pnpm exec expo run:ios --device
```

Long-press the home screen → + → Ledger to add widgets. Lock screen: long-press lock screen → Customize → tap a widget slot → Ledger.

## App Group identifier

`group.com.ledger.shared` must match in three places (kept in sync — change all if you ever rename):

- `app.json` → `ios.entitlements["com.apple.security.application-groups"]`
- `targets/widget/expo-target.config.js` → `entitlements["com.apple.security.application-groups"]`
- `targets/widget/SharedData.swift` → `kAppGroup`
- The JS snapshot writer in `lib/widgetSnapshot.ts` → `APP_GROUP`

## Force a widget refresh from JS (optional)

Widgets refresh on iOS's schedule (~15 min) by default. To poke them immediately after `writeWidgetSnapshot`, add `WidgetCenter.shared.reloadAllTimelines()` via a tiny Swift bridge, or adopt the `expo-widget-kit` community module later.

## Color & font conventions

The widgets mirror the app's dark fintech palette (`SharedData.swift` → `Color` extension):

- Background `#06090C`
- Foreground `#E6F1F7`
- Muted `#6E8290`
- Tint `#00F0FF`
- OK `#1FB6A6` / Warn `#F5A524` / Danger `#FF4D6D`

Numbers use SF Rounded + `.monospacedDigit()` — closest equivalent to the app's Inter + `tabular-nums`.

## Live Activity (scaffold)

`LedgerLiveActivity.swift` declares an ActivityKit `Widget` with Dynamic
Island + Lock Screen presentations. It is _not_ started by the app yet —
the JS bridge in `../../lib/liveActivity.ts` calls a not-yet-built
`LedgerLiveActivityModule` native module and gracefully no-ops when
absent. Add the native module (Swift `Activity<LedgerActivityAttributes>
.request(...)` wrapper) when we want LTV pinned in the Dynamic Island
during volatile sessions.
