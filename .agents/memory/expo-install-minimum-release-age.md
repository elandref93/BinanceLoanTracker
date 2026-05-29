---
name: Installing Expo SDK packages vs pnpm minimumReleaseAge
description: New Expo SDK packages get blocked by the workspace minimumReleaseAge gate; allowlist them temporarily.
---

Installing an Expo package (e.g. `expo-updates`) shortly after an SDK point
release fails with `ERR_PNPM_NO_MATURE_MATCHING_VERSION`, because
`pnpm-workspace.yaml` sets `minimumReleaseAge: 1440` (24h) and Expo often
publishes the SDK-matched version (and its transitive `@expo/*` deps) within
that window.

**Why:** the gate is a supply-chain safeguard and must NOT be disabled. But
Expo is a trusted publisher, so the correct workaround is the allowlist, not
lowering the gate.

**How to apply:** add the package and `@expo/*` (transitive deps like
`@expo/plist` get blocked too) to `minimumReleaseAgeExclude` in
`pnpm-workspace.yaml`, install with `npx expo install <pkg>` (or `pnpm add`),
then remove the exclusions once the 24h window has passed. Never set
`minimumReleaseAge` to 0.
