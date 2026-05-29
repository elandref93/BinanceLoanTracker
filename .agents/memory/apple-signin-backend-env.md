---
name: Apple Sign In backend env requirements
description: Why Apple sign-in returns 500 from the api-server, and the env vars that must be set
---

# Apple Sign In 500 from api-server

The `api-server` `/api/auth/apple` route returns **HTTP 500** (not a network/connection
error) when its required env vars are missing. Two vars gate a successful login:

- `APPLE_BUNDLE_ID` — must exactly equal the mobile app's `bundleIdentifier`
  (`com.ubuntu.life.ledger`). Apple sets each identity token's `aud` claim to the
  requesting app's bundle id; the backend rejects any token whose `aud` doesn't match.
  Missing → 500 "Server is not configured for Apple Sign In".
- `SESSION_JWT_SECRET` — ≥32 chars, used to sign the 30-day session JWT. Missing →
  `signSession` throws → 500. Generate with `openssl rand -hex 32` (or crypto.randomBytes).

**Why this bites:** a fresh Replit dev environment for this project has NO env vars set
(only DB/Clerk/Replit-managed secrets exist by default). Production runs on Azure with
its own env (see `artifacts/api-server/AZURE.md`), so the Replit dev backend needs these
set separately as `shared` env vars.

**Fast diagnosis:** `curl https://$REPLIT_DEV_DOMAIN/api/healthz` — the health route
lists exactly these missing vars (503 "degraded" with a `missing` array) when unset,
200 `{"status":"ok"}` when configured. Note healthz is at `/api/healthz`, not
`/api/health/healthz`; wrong paths fall through to the authenticated router and return 401.

**Simulator note:** Apple sign-in only returns an identity token if the simulator/device
is signed into an Apple ID. Otherwise the native flow fails before reaching the backend.
