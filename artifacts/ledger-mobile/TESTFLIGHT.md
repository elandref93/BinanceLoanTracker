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

Open `artifacts/ledger-mobile/eas.json` and replace the placeholders:

- `EXPO_PUBLIC_DOMAIN` (in every build profile) — the public hostname of
  the deployed Replit API server, e.g. `ledger-api.your-name.replit.app`.
  This is what the mobile app calls for `/api/loans` etc.
- `submit.production.ios.appleId` — the email of your Apple Developer account.
- `submit.production.ios.ascAppId` — the 10-digit ID from step 2.
- `submit.production.ios.appleTeamId` — the 10-char team ID from step 2.

## 5. Set EAS secrets (the Clerk publishable key)

`EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` is read at build time and baked into the
JS bundle. Put it in EAS rather than committing it:

```
cd artifacts/ledger-mobile
eas login                 # one-time, asks for your Expo account
eas init                  # creates the EAS project (links to expo.dev)
eas env:create --scope project --name EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY \
  --value 'pk_live_xxx...' --environment production --environment preview
```

If you don't have a Clerk production key yet, run with the dev key for now
and swap later — Clerk dev keys work in TestFlight builds (you'll see the
yellow dev-warning banner on first launch).

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

## 9. Widget extension (separate, optional)

The widget Swift sources in `ios-widget/` are NOT included in the EAS build
yet — Expo can't add a Widget Extension target through config alone. To ship
them:

1. `npx expo prebuild --platform ios` (creates a real `ios/` Xcode project).
2. Open `ios/Ledger.xcworkspace` in Xcode.
3. **File → New → Target → Widget Extension**, name it `LedgerWidget`.
4. Drag the files from `ios-widget/` into the new target.
5. Set the App Group (`group.com.ledger.app` or whatever your bundle id
   prefix is) on both the main app and widget targets so they can share the
   SecureStore snapshot.
6. Build once locally to validate, then `eas build` will pick up the
   committed `ios/` folder.

After prebuilding once, you're in the "Bare workflow" — keep the `ios/`
folder committed and only run `expo prebuild --clean` when you change
native config in `app.json`.

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
- **Clerk sign-in loops** — TestFlight bundle is using a Clerk dev key but
  Clerk thinks the bundle id isn't allowed. In the Clerk dashboard, add
  your bundle id to the allowed list under Native Applications.
