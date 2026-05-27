# Ledger (mobile)

Private iOS app for tracking Binance flexible-loan health. Three users,
TestFlight only. Stack: Expo + Swift WidgetKit + Express api-server.

## Quick start

```bash
pnpm --filter @workspace/ledger-mobile dev   # Expo (Replit workflow)
pnpm --filter @workspace/api-server dev      # backend (separate workflow)
```

Then scan the QR with Expo Go on a real iPhone signed into an Apple ID.
Apple Sign In does not work on the iOS simulator.

## What's where

- `app/` — Expo Router screens (`(tabs)/`, `loan/[id]`, `add-account`,
  `(auth)/`, `(onboarding)/`)
- `components/` — UI primitives (`Container`, `ScreenLoader`, `ErrorView`,
  `LtvHistoryChart`, etc.)
- `context/` — `SessionContext`, `CurrencyContext`, `RiskSettingsContext`
- `lib/` — non-UI logic: `session.ts` (auth), `alerts.ts` (local notifs),
  `backgroundTask.ts` (BGAppRefresh), `widgetSnapshot.ts` (App Group write),
  `ltvHistory.ts` (AsyncStorage ring buffer), `haptics.ts`,
  `liveActivity.ts` (stub), `crashReporting.ts` (stub)
- `targets/widget/` — Swift Home + Lock widgets + Live Activity scaffold
- `targets/watch/` — watchOS app
- `targets/watch-complication/` — watchOS complication (separate target)
- `utils/risk.ts` — LTV/headroom math (shared across app + snapshot)

## TestFlight & release

See [`TESTFLIGHT.md`](./TESTFLIGHT.md) for credentials, build commands,
background-fetch + Live Activity + Watch notes, and troubleshooting.

## Known deferred items

These were catalogued and consciously postponed:

- **Tests** — no automated test suite. Highest priority next addition is
  `utils/risk.ts` (LTV math drives liquidation logic).
- **Crash reporting** — `lib/crashReporting.ts` is a console-only stub; swap
  to Sentry when there's a DSN.
- **i18n** — strings are hard-coded English; fine for 3 English users.
- **OTA updates** — `expo-updates` channels not wired in `eas.json`; every
  JS-only fix still requires a TestFlight build.
- **ZAR FX rate** — `useCurrency` does not yet pull a live USD↔ZAR rate.
