# Merging the two auth layers (Azure Easy Auth + app session JWT)

Goal: **one token** — the app's own session JWT — passes BOTH Azure App Service
Authentication ("Easy Auth", at the edge) AND the app's own `requireAuth`. We do
this by signing the session JWT with **RS256** and publishing OIDC discovery +
JWKS from this backend, then registering the backend as a **custom OIDC
provider** in Easy Auth so it validates our tokens against our own issuer.

The code is **backward-compatible**: it keeps signing the legacy **HS256** token
until `SESSION_JWT_PRIVATE_KEY` is provisioned, and it verifies both. So you can
deploy the code first and flip Azure last with no downtime.

---

## What the code already does

- `signSession()` signs **RS256** when `SESSION_JWT_PRIVATE_KEY` (PKCS8 PEM) is
  set; otherwise it falls back to legacy **HS256** (`SESSION_JWT_SECRET`).
- `verifySession()` accepts **both** families (RS256 current+previous public
  keys, HS256 current+previous secrets) and **both** issuers (the OIDC URL and
  the legacy `binance-loan-tracker-backend`), so existing 30-day sessions keep
  working until they expire.
- Public, unauthenticated endpoints (mounted at the root, before `/api`):
  - `GET /.well-known/openid-configuration`
  - `GET /.well-known/jwks.json`  (returns `{"keys":[]}` until the RSA key is set)
- The mobile app signs the user out on any `401`, so a token invalidated by the
  cutover triggers a clean re-sign-in.

## Environment variables

| Variable | Where | Notes |
| --- | --- | --- |
| `SESSION_JWT_PRIVATE_KEY` | **Azure** (and Replit dev, optional) | PKCS8 PEM. Enables RS256. |
| `SESSION_JWT_PRIVATE_KEY_PREVIOUS` | Azure | Optional, for key rotation. |
| `SESSION_JWT_SECRET` | Azure (existing) | Legacy HS256. Keep for ≥30 days after cutover. |
| `SESSION_JWT_ISSUER` | optional | Defaults to `https://binance-loan-tracker-backend.azurewebsites.net`. Must equal the discovery `issuer` and the issuer you configure in Easy Auth. |

Generate the RSA key:

```bash
openssl genpkey -algorithm RSA -pkcs8 -pkeyopt rsa_keygen_bits:2048
```

Paste the **entire** output (including the `-----BEGIN PRIVATE KEY-----` /
`-----END PRIVATE KEY-----` lines) as `SESSION_JWT_PRIVATE_KEY`. The backend
repairs common secret-store mangling (literal `\n` escapes or collapsed
newlines), so the key parses even if the manager flattens it onto one line.

> The private key never leaves the backend. Only the **public** half is exposed,
> via `/.well-known/jwks.json`.

## Azure configuration (portal or `az`)

1. **App setting**: add `SESSION_JWT_PRIVATE_KEY` (the PEM above) to the App
   Service. Redeploy/restart so the backend serves a non-empty JWKS. Confirm:
   `curl https://binance-loan-tracker-backend.azurewebsites.net/.well-known/jwks.json`
   returns one key.
2. **Easy Auth → custom OIDC provider** (authsettingsV2):
   - **Provider name**: use **no hyphens** (e.g. `appsession`) — Azure rejects
     hyphenated custom-OIDC provider names.
   - **Issuer / metadata URL**:
     `https://binance-loan-tracker-backend.azurewebsites.net/.well-known/openid-configuration`
     (issuer string must match **exactly** — no trailing-slash drift).
   - **Allowed audiences**: `binance-loan-tracker-mobile`.
   - **Client-directed (bearer) flow**: tokens arrive in the `Authorization:
     Bearer` header (Easy Auth passes the header through to the app, so
     `requireAuth` still runs).
3. **Unauthenticated exclusions** (`globalValidation`):
   - `unauthenticatedClientAction`: `RejectWith401`
   - `excludedPaths` must include (glob `*` is supported):
     - `/.well-known/*` — Easy Auth must read our metadata unauthenticated.
     - `/api/auth/*` — Apple Sign In carries an **Apple** identity token, not our
       session JWT, so the edge must let it through to be exchanged.
     - `/api/healthz` — Azure's own health probe.

## Rollout order (do not reorder)

1. **Deploy this code.** Nothing changes yet — still HS256, no key set.
2. **Set `SESSION_JWT_PRIVATE_KEY`** in Azure and restart. New sign-ins now get
   RS256 tokens; HS256 sessions keep working.
3. **Verify** discovery + JWKS are live and the issuer/audience are exact.
4. **Wait ≥5 minutes** for JWKS to propagate (discovery/JWKS are sent with
   `Cache-Control: max-age=300`).
5. **Enable the Easy Auth custom OIDC provider** with the exclusions above.
6. Existing users with old HS256 tokens get a `401` at the edge → the app signs
   them out → they re-sign-in → receive an RS256 token. Smooth.

### Lockout guardrails

- Do **not** enable Easy Auth enforcement (step 5) until step 3 confirms the
  JWKS/issuer/audience are correct — a mismatch rejects every request.
- Keep `SESSION_JWT_SECRET` set for ≥30 days so any in-flight HS256 session the
  *app* still accepts isn't broken before it expires.
- To rotate the RSA key later: move the current key to
  `SESSION_JWT_PRIVATE_KEY_PREVIOUS`, set a new `SESSION_JWT_PRIVATE_KEY`, and
  keep both until old tokens expire (JWKS publishes both).
