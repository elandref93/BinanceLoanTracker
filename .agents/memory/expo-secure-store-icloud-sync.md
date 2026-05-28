---
name: expo-secure-store iCloud Keychain sync
description: expo-secure-store does not support iCloud Keychain sync; cross-device sync of secrets must go through the backend.
---

**Rule:** Do not try to make `expo-secure-store` items sync across a user's devices via iCloud Keychain. The native module does not expose `kSecAttrSynchronizable` and there is no config option for it. If a user reports "my data doesn't appear on my second device on the same Apple ID," the answer is always a backend sync layer (or a patched fork), never a SecureStore flag.

**Why:** Burnt a half-task investigating SecureStore options for the Ledger app's API-key cross-device sync before confirming the upstream module simply doesn't surface this attribute. The replacement design — backend blob keyed on Apple Sign In `sub`, last-write-wins by client-monotonic timestamp — is what shipped.

**How to apply:** When the user says iOS Keychain-stored secrets should "show up on my other device," skip the SecureStore docs and go straight to: (1) is there already an auth identity we can key on (Apple sub, Clerk userId, etc.)? (2) add a small backend endpoint that stores the opaque blob; (3) hydrate on sign-in and push on every local mutation.
