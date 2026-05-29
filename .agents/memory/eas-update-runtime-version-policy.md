---
name: EAS Update runtimeVersion policy in pnpm monorepo
description: Use appVersion, not fingerprint, for runtimeVersion in this pnpm monorepo Expo app.
---

For `artifacts/ledger-mobile`, set `runtimeVersion.policy` to `"appVersion"` in
app.json, NOT `"fingerprint"`.

**Why:** the fingerprint policy hashes the native input set including pnpm's
content-hashed `node_modules/.pnpm/<pkg>@ver_<hash>` directory names plus a
`bareNativeDir: ios` entry. Those hashes differ between the Replit container and
the EAS build worker, so `eas build` fails with a "Runtime version mismatch"
(local fingerprint != EAS fingerprint), meaning locally-published updates would
be incompatible with the build.

**How to apply:** keep `appVersion` — runtime version becomes the `version`
string (e.g. "1.0.0"), computed identically everywhere. OTA updates reach any
build sharing that version. When a native change ships (new native module,
app.json native config, SDK upgrade), bump `version` and do a fresh TestFlight
build so OTA bundles can't target an incompatible binary.
