---
name: Diagnosing a stale OTA bundle on the Ledger TestFlight app
description: How to tell a user is running an old JS bundle (not a code/data bug), and what actually fixes it.
---

When a Ledger user reports a feature "missing" or "not showing anymore" that
demonstrably exists and is published, suspect a STALE OTA bundle before
suspecting the merge logic, the server, or their exchange keys.

**Tells of a stale bundle (strongest signal): the screenshot UI matches an
OLD commit, not current code.** e.g. Crypto tab titled "Crypto" with a
"WALLETS" section + "BTC ON LUNO"/"TOTAL · LUNO" tiles, and a Settings tab with
inline account management showing "Healthy · checked just now" — that layout is
from the pre-consolidation era (~commit 624cd64 / 8fbf224), long before the
"Portfolio" merged Binance+Luno donut view. `git log -S "<unique UI string>"`
pins the era the device is stuck on.

**Rule out runtimeVersion mismatch:** `eas update:list --branch production`.
If every update (and the embedded build) is the same runtimeVersion (here all
`1.0.0`, policy `appVersion`), delivery is NOT blocked by a mismatch — the
device simply isn't applying staged updates.

**Why it gets stuck:** `app.json` has `fallbackToCacheTimeout: 0` +
`checkAutomatically: ON_LOAD`, so a new bundle only applies on the launch AFTER
a successful background download, and only on a genuine cold launch (not iOS
resume). A device many versions behind despite days of use means the
download/apply is failing on that native build — classic chicken-and-egg when
the broken-updater fix lives in an OTA the device can't reach.

**Reliable fix:** cut a fresh native TestFlight build that embeds current JS —
`pnpm --filter @workspace/ledger-mobile run tf:build` (eas build -p ios
--profile production --auto-submit --no-wait). Double cold-launch is the only
zero-cost thing to try first, but rarely rescues a long-stuck device.
