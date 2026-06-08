---
name: Session JWT ↔ Azure Easy Auth merge (RS256 + JWKS)
description: How/why the api-server session JWT is dual-mode (RS256+HS256) and self-publishes OIDC so Azure Easy Auth validates the app's own token.
---

# Session JWT validated by both Azure Easy Auth and the app

The api-server's session JWT is the single token that must satisfy BOTH the
Azure App Service Easy Auth edge AND the app's own `requireAuth`. To make that
work, the backend acts as its own OIDC provider.

## Rules to keep consistent
- **Signing is dual-mode.** RS256 when `SESSION_JWT_PRIVATE_KEY` (PKCS8 PEM) is
  set, else legacy HS256 (`SESSION_JWT_SECRET`). This is what makes deploys
  non-breaking — code can ship before the key exists.
- **Verify selects the key family from the token's own `alg` header**, then
  restricts jose `algorithms` to that one alg and only supplies same-family keys
  (RS public for RS256, HMAC secret for HS256). Do NOT "try every key across
  families" — that both (a) reports a misleading failure reason and (b) is the
  classic alg-confusion footgun.
- **Two issuers are accepted on verify**: the OIDC URL issuer (RS256, default
  `https://binance-loan-tracker-backend.azurewebsites.net`, overridable via
  `SESSION_JWT_ISSUER`) and the legacy bare name `binance-loan-tracker-backend`
  (HS256). Audience is unchanged: `binance-loan-tracker-mobile`.
- **`/.well-known/openid-configuration` + `/.well-known/jwks.json` must stay
  mounted at the ROOT, before the `/api` auth gate and rate limiters** — Easy
  Auth fetches them unauthenticated. `kid` is the RFC 7638 JWK thumbprint and
  must match between signed tokens and JWKS.
- **Mobile never verifies the JWT** — it only stores+sends it. On any `401` it
  signs out (via `lib/authEvents.ts` → SessionContext) so a cutover-invalidated
  token recovers cleanly.

**Why:** Easy Auth blocks every path pre-app (empty 401) unless it can validate
the bearer token against a configured OIDC provider. Asymmetric RS256 + a public
JWKS lets the edge validate without sharing the signing secret; the dual-mode +
both-issuers design is purely to make the rollout backward-compatible.

## Gotcha: multi-line PEM secrets get mangled
A PKCS8 private key pasted into a secret store (Replit Secrets, Azure App
Settings) often loses its real newlines — flattened to one line, turned into
literal `\n` escapes, or space-separated. `createPrivateKey` then throws
`DECODER routines::unsupported`. The PEM loader in `sessionJwt.ts`
(`normalizePem`) repairs all three before parsing; keep that normalization if you
touch key loading. Same applies to any future PEM-valued secret.

**How to apply:** full rollout/runbook (env vars, Azure custom-OIDC provider,
`excludedPaths`, ordering, lockout guardrails) lives in
`artifacts/api-server/AZURE_AUTH_ROLLOUT.md`. Azure custom-OIDC provider names
must contain NO hyphens.
