# TestFlight setup for Ledger

Step-by-step to get a build into the hands of your three testers. Everything
in **bold** is something you actually need to do; everything else is context.

You only need to do steps 1–6 once. After that, every new build is just
`pnpm run eas:build:preview` (~15–25 min cloud build) followed by `eas submit`.

---

## 1. One-time prerequisites (on your Mac)

- **Apple Developer Program account** — $99/year, sign up at
  <https://developer.apple.com/programs/>. Wait for activation (can take a day).
- **Xcode** from the Mac App Store (latest stable). Open it once and accept
  the license, then run `xcode-select --install` to get command-line tools.
- **Node 20+** and **pnpm** (you already have these — same versions as the repl).
- **EAS CLI**:
  ```
  npm install -g eas-cli
  ```
- **Pull the repo** to your Mac and `pnpm install` from the monorepo root.

## 2. App Store Connect: register the app

1. Sign in at <https://appstoreconnect.apple.com>.
2. **Apps → "+" → New App**:
   - **Platform:** iOS
   - **Name:** `Ledger`
   - **Primary language:** English
   - **Bundle ID:** select **"Register a new identifier"** if it offers, or
     pre-create it in <https://developer.apple.com/account/resources/identifiers>
     using `com.ledger.app` (or change this to something you own — see step 3).
   - **SKU:** anything unique to you, e.g. `ledger-1`.
   - **User access:** Full access.
3. After creation, note two values:
   - **App Store Connect App ID** — a 10-digit number in the URL of the app's
     page, e.g. `1234567890`.
   - **Apple Team ID** — top-right of <https://developer.apple.com/account>,
     a 10-character alphanumeric like `AB12CD34EF`.

## 3. Pick a bundle identifier you own

`app.json` ships with `com.ledger.app`. If you don't own the `com.ledger`
namespace (which you don't, by default), change it to something based on a
domain or Apple ID you control, e.g. `com.yourname.ledger`.

Edit **two** places to match:
- `artifacts/ledger-mobile/app.json` → `expo.ios.bundleIdentifier`
- The bundle ID you registered in App Store Connect (step 2)

They MUST match exactly.

## 4. Fill in eas.json

Open `artifacts/ledger-mobile/eas.json` and confirm the values:

- `EXPO_PUBLIC_DOMAIN` is pinned in every build profile to
  `binance-loan-tracker-backend.azurewebsites.net` — the Azure-hosted API
  server. The mobile app calls this for `/api/loans` etc. Change it only if
  the backend moves.
- `submit.production.ios.appleId` — the email of your Apple Developer account.
- `submit.production.ios.ascAppId` — the 10-digit ID from step 2.
- `submit.production.ios.appleTeamId` — the 10-char team ID from step 2.

## 5. EAS env vars

The mobile app signs in natively with Sign in with Apple — no third-party
auth dashboard. `EXPO_PUBLIC_DOMAIN` is baked into `eas.json` per profile,
so no `eas env:create` is required for builds to find the backend.

The backend authenticates Apple identity tokens against its `APPLE_BUNDLE_ID`
env var, which must exactly match the `expo.ios.bundleIdentifier` in
`app.json`. Currently both are `com.ubuntu.life.ledger`.

## 6. First build

From `artifacts/ledger-mobile/`:

```
pnpm run eas:build:preview
```

EAS will:
1. Ask if you want EAS to manage your iOS credentials (say **yes** — it
   creates a distribution certificate + provisioning profile for you).
2. Upload the source to its build farm.
3. Build an `.ipa` (~15–25 min). You'll get a URL to watch the log live.

When it finishes:

```
eas submit -p ios --latest
```

This uploads the `.ipa` to App Store Connect. The first time, it asks for an
**app-specific password** — generate one at <https://appleid.apple.com>
→ Sign-In and Security → App-Specific Passwords.

## 7. TestFlight: add your three testers

1. App Store Connect → your app → **TestFlight** tab.
2. Wait ~10–30 min for Apple to finish processing the build (status goes
   from "Processing" → "Ready to Test"). You'll get an email.
3. The first build needs **export compliance** — click the build,
   answer "No" to encryption (we set `ITSAppUsesNonExemptEncryption: false`
   in `app.json` so this should be auto-answered).
4. **Internal Testing → +** to create a group, add up to 100 testers by
   Apple ID email. They don't count against the 10,000-tester external cap.
5. Attach the build to the group. Apple emails each tester a TestFlight
   invite immediately.
6. Tester flow: install **TestFlight** from the App Store on their iPhone
   → tap the invite link in the email → install **Ledger**.

Internal builds don't need Apple review. External testers do (~24 h first
review), but you don't need them yet.

## 8. Subsequent builds

```
pnpm run eas:build:preview     # cloud build
eas submit -p ios --latest     # upload to App Store Connect
```

The `production` profile has `autoIncrement: true` so the build number bumps
itself. For `preview` you can either bump `app.json` → `ios.buildNumber`
manually or switch to remote version source (`eas build:version:set`).

## 9. Widget extension (automatic)

The home + lock screen widgets live in `targets/widget/` and are wired into
every EAS build automatically by the `@bacons/apple-targets` config plugin
(registered in `app.json` → `plugins`). The plugin creates a `LedgerWidget`
Widget Extension target during `expo prebuild`, copies in the Swift sources,
and mirrors the App Group entitlement (`group.com.ledger.shared`) onto both
the main app and the widget target.

The widget extension's bundle ID is `com.ubuntu.life.ledger.widget`
(pinned in `targets/widget/expo-target.config.js`). The first build will
ask EAS to register that App ID and a matching provisioning profile — that
takes ~30 seconds and happens automatically.

After installing the TestFlight build: long-press home screen → **+** →
search **Ledger** to add the home widget. For the lock screen, long-press
lock screen → **Customize** → tap a slot → **Ledger**.

---

## Troubleshooting

- **"Bundle identifier is not available"** — someone else registered it.
  Pick a different one in step 3.
- **"Invalid provisioning profile"** during build — let EAS regenerate
  credentials: `eas credentials` → iOS → remove distribution cert, then
  re-run the build.
- **App opens to a blank screen** in TestFlight — your `EXPO_PUBLIC_DOMAIN`
  is wrong or the API server isn't deployed. Check the device's Settings →
  Ledger or just check that the URL works in Safari with `/api/healthz`.
- **Apple Sign In returns 401** — the backend rejected the identity token.
  Check Azure logs: `az webapp log download --resource-group ubuntu --name
  binance-loan-tracker-backend`. The api-server logs the specific reason on
  every Apple Sign In failure (`expired`, `invalid_signature`,
  `wrong_issuer_or_audience`, `jwks_unavailable`, etc). The most common
  cause is a mismatch between `expo.ios.bundleIdentifier` in `app.json` and
  the `APPLE_BUNDLE_ID` env var on Azure — they MUST be identical.
- **"Apple Sign In isn't available on this device"** — you're on the iOS
  simulator without an Apple ID, or running web/Android. Use a real iPhone
  signed into an Apple ID.

---

## 10. Background refresh & alerts (build #19+)

The app registers a `BGAppRefreshTask` (id `com.ubuntu.life.ledger.refresh`,
declared in `app.json` → `infoPlist.BGTaskSchedulerPermittedIdentifiers`)
that wakes up every ~15 min in the background, calls `/loans`, refreshes the
widget snapshot, samples the LTV-history ring buffer, and fires any
threshold-cross local notifications.

iOS imposes a soft floor on how often this actually runs — typically once
every 15–60 min depending on usage patterns and battery. There is no remote
push (APNs) on purpose: for 3 users, local notifications driven by
background-fetch give the same UX without standing up an Apple push key,
device-token registry, or a backend pusher.

To verify on device:
- Toggle Settings → Notifications → Push when LTV alerts trigger.
- Add an alert rule whose threshold is below your current LTV.
- Background the app; within a refresh cycle iOS should surface the
  notification.

## 11. Live Activity (scaffold, build #19)

`targets/widget/LedgerLiveActivity.swift` declares an ActivityKit
`Widget` (Dynamic Island + Lock Screen layouts). The accompanying JS
bridge `lib/liveActivity.ts` calls a native module
(`LedgerLiveActivityModule`) to `start`/`update`/`end` the activity. That
module is NOT yet shipped — every JS call no-ops cleanly today. Add it
when we want LTV to be live-pinned during volatile sessions.

Info.plist already declares `NSSupportsLiveActivities=true`, so no extra
config is needed when the module lands.

## 12. Apple Watch complication (scaffold, build #19)

Two cooperating targets, both wired in via `@bacons/apple-targets`:
- `targets/watch/` (`type: "watch"`) — minimal SwiftUI root view
  (`LedgerWatchApp.swift`) showing the aggregate LTV. This is the watch
  app container; its `@main` is the only entry point in that target.
- `targets/watch-complication/` (`type: "watch-widget"`) — a WidgetKit
  bundle (`LedgerComplication`, `accessoryCircular` +
  `accessoryRectangular`) that reads the same App Group snapshot the
  iPhone widget reads (`group.com.ledger.shared`,
  `ledger.snapshot.v1`). Splitting it from the watch app avoids the
  dual-`@main` compile error that occurs when a SwiftUI App and a
  WidgetBundle share a target.

The first device build needs a paired Apple Watch on the test iPhone for
Xcode/EAS to provision the companion app. Without one, the iPhone build
still succeeds — the watch app just won't install. Bundle ID for the
companion is `com.ubuntu.life.ledger.watchkitapp`.
