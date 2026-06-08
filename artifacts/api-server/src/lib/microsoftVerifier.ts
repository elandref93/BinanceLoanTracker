/**
 * Microsoft Entra ID (Azure AD) identity-token verifier.
 *
 * The web client signs in with Microsoft via MSAL and receives a v2.0
 * `id_token` — a JWT signed by Microsoft's private key. The browser cannot
 * verify it meaningfully on its own, so it forwards the token to this backend,
 * which verifies the signature against Microsoft's published JWKS and then
 * mints our own session JWT (mirroring the Apple Sign In flow). This keeps a
 * single app-layer auth model: every `/api` route is gated by `requireAuth`,
 * which only ever validates OUR session JWT — never the upstream provider token.
 *
 * What we check (all must pass before we trust the token):
 *   1. Signature is valid against the tenant's current JWKS at
 *      https://login.microsoftonline.com/<tenant>/discovery/v2.0/keys
 *      (handles key rotation automatically via remote JWKS caching).
 *   2. `iss` is exactly https://login.microsoftonline.com/<tenant>/v2.0 — i.e.
 *      the token was issued by OUR single tenant, not some other directory.
 *   3. `aud` matches our app registration's client id (MICROSOFT_CLIENT_ID).
 *   4. `exp` has not passed.
 *
 * What we extract:
 *   - `oid`: the user's immutable object id within the tenant. This is stable
 *     across applications (unlike `sub`, which is pairwise per app), so it's the
 *     canonical user id we persist. Falls back to `sub` if `oid` is ever absent.
 *   - `email` (optional): `email` claim, falling back to `preferred_username`
 *     (which is typically the UPN / sign-in name).
 *   - `name` (optional): the user's display name.
 *
 * Microsoft's docs:
 *   https://learn.microsoft.com/azure/active-directory/develop/id-tokens
 */

import {
  createRemoteJWKSet,
  jwtVerify,
  errors as joseErrors,
  type JWTVerifyGetKey,
} from "jose";

export interface MicrosoftIdentityClaims {
  /** Immutable per-tenant user id (`oid`, falling back to `sub`). */
  sub: string;
  email?: string;
  name?: string;
}

export class MicrosoftTokenVerificationError extends Error {
  readonly name = "MicrosoftTokenVerificationError";
  readonly reason:
    | "malformed"
    | "expired"
    | "invalid_signature"
    | "wrong_issuer_or_audience"
    | "missing_sub"
    | "jwks_unavailable";

  constructor(
    reason: MicrosoftTokenVerificationError["reason"],
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    Object.setPrototypeOf(this, new.target.prototype);
    this.reason = reason;
  }
}

// One cached remote JWKS per tenant. `createRemoteJWKSet` returns a function
// that fetches + caches Microsoft's public keys and refetches on a `kid` cache
// miss (key rotation). Caching is per-process, so the cold-start cost is a
// single HTTPS request; every subsequent verification is in-memory.
const jwksByTenant = new Map<string, JWTVerifyGetKey>();

function getTenantJwks(tenantId: string): JWTVerifyGetKey {
  let jwks = jwksByTenant.get(tenantId);
  if (!jwks) {
    jwks = createRemoteJWKSet(
      new URL(
        `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
      ),
      {
        cooldownDuration: 30_000,
        timeoutDuration: 10_000,
      },
    );
    jwksByTenant.set(tenantId, jwks);
  }
  return jwks;
}

export async function verifyMicrosoftIdentityToken(
  token: string,
  params: { tenantId: string; audience: string | string[] },
): Promise<MicrosoftIdentityClaims> {
  const { tenantId, audience } = params;
  const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;

  let payload: Record<string, unknown>;
  try {
    const verified = await jwtVerify(token, getTenantJwks(tenantId), {
      issuer,
      audience,
      algorithms: ["RS256"],
    });
    payload = verified.payload as Record<string, unknown>;
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      throw new MicrosoftTokenVerificationError(
        "expired",
        "Microsoft identity token has expired",
        { cause: err },
      );
    }
    if (err instanceof joseErrors.JWSSignatureVerificationFailed) {
      throw new MicrosoftTokenVerificationError(
        "invalid_signature",
        "Microsoft identity token signature did not verify against the tenant JWKS",
        { cause: err },
      );
    }
    if (err instanceof joseErrors.JWTClaimValidationFailed) {
      throw new MicrosoftTokenVerificationError(
        "wrong_issuer_or_audience",
        `Microsoft identity token has wrong issuer or audience (expected iss=${issuer}, aud=${
          Array.isArray(audience) ? audience.join(" | ") : audience
        })`,
        { cause: err },
      );
    }
    if (err instanceof joseErrors.JWKSNoMatchingKey) {
      throw new MicrosoftTokenVerificationError(
        "invalid_signature",
        "No tenant JWKS key matched the token's kid (key rotated or token forged)",
        { cause: err },
      );
    }
    if (
      err instanceof joseErrors.JWKSTimeout ||
      err instanceof joseErrors.JWKSInvalid
    ) {
      throw new MicrosoftTokenVerificationError(
        "jwks_unavailable",
        "Could not reach Microsoft's JWKS endpoint to verify the token",
        { cause: err },
      );
    }
    throw new MicrosoftTokenVerificationError(
      "malformed",
      "Microsoft identity token is malformed",
      { cause: err },
    );
  }

  // Prefer `oid` (immutable per-tenant id, stable across apps) over `sub`
  // (pairwise per app). Either is an opaque GUID-like string.
  const oid = typeof payload.oid === "string" ? payload.oid : undefined;
  const sub = typeof payload.sub === "string" ? payload.sub : undefined;
  const subject = oid ?? sub;
  if (!subject || subject.length === 0) {
    throw new MicrosoftTokenVerificationError(
      "missing_sub",
      "Microsoft identity token has no oid/sub claim",
    );
  }

  const email =
    typeof payload.email === "string"
      ? payload.email
      : typeof payload.preferred_username === "string"
        ? payload.preferred_username
        : undefined;

  return {
    sub: subject,
    email,
    name: typeof payload.name === "string" ? payload.name : undefined,
  };
}
