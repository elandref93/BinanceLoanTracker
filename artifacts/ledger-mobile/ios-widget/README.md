# Ledger iOS Widget (WidgetKit)

Two widgets, both reading the same shared snapshot the app writes after every loan refresh:

- **Home screen** (`HomeWidget.swift`) — small + medium families
  - Small: aggregate LTV + status label
  - Medium: aggregate LTV alongside the loan closest to liquidation and the % collateral price drop until 78%
- **Lock screen** (`LockWidget.swift`) — circular, rectangular, inline accessory families

## Architecture

```
Expo app (JS)          App Group container          Widget extension (Swift)
  ─────────              ─────────────────            ────────────────────────
  buildSnapshot()  →   UserDefaults(suiteName:    →  LoanSnapshot.load()
  writeWidgetSnapshot()  "group.com.ledger.shared")    SnapshotProvider
                         key: "ledger.snapshot.v1"     HomeWidget / LockWidget
```

The JS side already calls `writeWidgetSnapshot(buildSnapshot(loans))` on the dashboard after each data refresh. In Expo Go it's a no-op. In a dev / TestFlight build it writes through `react-native-shared-group-preferences` (see install step below).

## One-time Xcode integration

Do this once, from a Mac with Xcode + an Apple Developer account.

### 1. Generate the native iOS project

```bash
cd artifacts/ledger-mobile
pnpm exec expo prebuild --platform ios --clean
```

### 2. Install the shared-prefs bridge (JS → App Group)

```bash
pnpm --filter @workspace/ledger-mobile add react-native-shared-group-preferences
cd ios && pod install && cd ..
```

### 3. Add the widget extension target

1. Open `ios/LedgerMobile.xcworkspace` in Xcode.
2. File → New → Target → **Widget Extension**. Name it `LedgerWidget`. Uncheck "Include Configuration Intent".
3. Delete the boilerplate Swift / Info.plist Xcode generated.
4. Right-click the `LedgerWidget` group → Add Files to "LedgerMobile"… → select every file in this directory (`*.swift`, `Info.plist`, `LedgerWidget.entitlements`). Tick **Copy items if needed** and check the `LedgerWidget` target only.
5. In the `LedgerWidget` target → Build Settings → "Code Signing Entitlements", set the path to `LedgerWidget/LedgerWidget.entitlements`.

### 4. Create the App Group on both targets

In both the main app target **and** the `LedgerWidget` target:

1. Signing & Capabilities → **+ Capability** → App Groups.
2. Add group: `group.com.ledger.shared`.

The identifier must match `kAppGroup` in `SharedData.swift` and `APP_GROUP` in `lib/widgetSnapshot.ts`. If you change it, change it in all three places.

### 5. Build to a device

```bash
pnpm exec expo run:ios --device
```

Then long-press the home screen → + → Ledger to add widgets. Lock screen widgets: long-press lock screen → Customize → Lock Screen → tap a widget slot → Ledger.

### 6. Force a widget refresh from JS (optional)

Widgets refresh on iOS's schedule (~15 min) by default. To poke them immediately after `writeWidgetSnapshot`, add `WidgetCenter.shared.reloadAllTimelines()` via a tiny Swift bridge, or use the `expo-widget-kit` community module if you adopt it later.

## Color & font conventions

The widgets mirror the app's dark fintech palette (`SharedData.swift` → `Color` extension):

- Background `#06090C`
- Foreground `#E6F1F7`
- Muted `#6E8290`
- Tint `#00F0FF`
- OK `#1FB6A6` / Warn `#F5A524` / Danger `#FF4D6D`

Numbers use SF Rounded + `.monospacedDigit()` — closest equivalent to the app's Inter + `tabular-nums`.
