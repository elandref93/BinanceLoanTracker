---
name: Expo SDK native-module version mismatch
description: Native modules pinned to a different Expo SDK major than the `expo` package cause instant launch crashes on device (often green in simulator/dev).
---

When a package like `expo-camera`, `expo-apple-authentication`, `expo-background-fetch`, `expo-task-manager`, etc. is installed at a version belonging to a **different** Expo SDK major than the project's `expo` package, the dev build and EAS build can both compile and ship — but the app hard-crashes on launch on real devices because the native module ABI doesn't match the React Native version Expo prebuilds.

**Why:** Each Expo SDK pins a coordinated set of native module versions. Mixing (e.g. SDK 56 modules in an SDK 54 project) ships incompatible ObjC/Swift binaries; the first JS `import` that touches the broken module triggers `dyld`/TurboModule failure. Symptom is "TestFlight build crashes immediately on tap" with no JS error visible.

**How to apply:** Before any iOS build that the user will install, run `pnpm exec expo install --check` inside the Expo artifact. Any "expected version" lines must be resolved with `pnpm exec expo install <pkg>@<expected-range>` — do not just `pnpm add` modern versions, as pnpm/npm will happily install the wrong SDK's release. Never use `^56.x` style ranges on Expo-managed packages; let `expo install` pin them.
