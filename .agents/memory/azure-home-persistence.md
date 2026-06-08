---
name: Azure App Service /home persistence
description: Why api-server writes can fail in production and how the data dir falls back
---

# Azure App Service /home writability

On Azure App Service (the api-server's prod host: Docker -> ACR -> App Service),
the `/home` mount is NOT writable from the container unless the app setting
`WEBSITES_ENABLE_APP_SERVICE_STORAGE=true` is configured. Without it, any
`mkdir`/write under `/home` throws `EACCES`/`EPERM`/`EROFS`.

**Why this matters:** the app is file-based (no SQL DB — drizzle is present but
unused). Account-sync, credential, and LTV-snapshot persistence all write to a
data dir. If that dir is unwritable, every write 500s (this was a real Sentry
issue: `EACCES mkdir '/home/data'`).

**How it's handled:** `dataDir.ts` resolves the preferred dir and, on a
permission error, falls back to `os.tmpdir()/ledger-data` with one loud
`logger.error`. The API keeps serving but that fallback is EPHEMERAL — data is
lost on container restart. So for durable persistence in prod the Azure flag
above must be set; the fallback is a degraded-availability safety net, not a fix.

**How to apply:** if a user reports prod data not persisting (resets on
redeploy/restart), check whether `WEBSITES_ENABLE_APP_SERVICE_STORAGE=true` is
set on the App Service before touching code.
