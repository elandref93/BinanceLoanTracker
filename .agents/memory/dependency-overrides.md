---
name: pnpm override duplication for security CVEs
description: This repo declares pnpm overrides in TWO places that must be kept in sync; how transitive CVE alerts are remediated.
---

# pnpm overrides live in two files — keep them in sync

This workspace declares `overrides` in **both** `package.json` (`pnpm.overrides`) **and**
`pnpm-workspace.yaml` (`overrides`). They are maintained as identical sets. When adding or
removing an override, edit BOTH or the lockfile resolution can drift unexpectedly.

**Why:** the repo was set up with both blocks populated identically (platform-binary `"-"`
prunes plus security pins). Touching only one leaves the other stale.

**How to apply (clearing Dependabot transitive CVE alerts):**
- These alerts are almost always **build-tooling-only** transitives — `eas-cli`,
  `@bacons/apple-targets`, `@bacons/xcode`, `@expo/ngrok` (mobile build/prebuild) — none ship
  in the app bundle or the API runtime. Risk is low, but they still trip Dependabot.
- Fix with **version-scoped** overrides (`"pkg@badversion": "patched"`), matching the existing
  style, so unaffected paths aren't regressed. Get the exact resolved bad versions from the
  lockfile (`rg "^  pkg@" pnpm-lock.yaml`) before writing pins.
- `minimumReleaseAge: 1440` (1 day) is enforced — verify a patched version is >1 day old
  (`npm view pkg time`) or the install is rejected. Never disable this setting.
- After editing, `pnpm install` then `pnpm audit` to confirm `No known vulnerabilities found`.
- Verify the build tool still runs: `pnpm --filter @workspace/ledger-mobile exec eas --version`.

**Note:** `uuid` overrides up to 11.x are safe for consumers that do `require("uuid").v4()`
(named export), but would break any consumer using legacy deep imports (`require("uuid/v4")`).
`@expo/ngrok` uses the named form, so it's fine.
