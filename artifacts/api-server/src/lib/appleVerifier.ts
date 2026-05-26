/**
 * Apple identity-token verifier.
 *
 * Sign in with Apple returns an `identityToken` to the device, which is a JWT
 * signed by Apple's private key. The native flow doesn't expose a verification
 * step on the device — instead, the device sends the token to its backend,
 * and the backend verifies the signature against Apple's published JWKS at
 * https://appleid.apple.com/auth/keys.
 *
 * What we check (all of these need to pass before we trust the token):
 *   1. Signature is valid against Apple's current JWKS (handles key rotation
 *      automatically via remote JWKS caching).
 *   2. `iss` is exactly "https://appleid.apple.com".
 *   3. `aud` matches our iOS bundle identifier (configured via APPLE_BUNDLE_ID).
 *      Apple sets `aud` to the bundle ID of the requesting app, so a token
 *      minted for a different app — even within our team — won't be accepted.
 *   4. `exp` has not passed.
 *
 * What we extract:
 *   - `sub`: Apple's stable user identifier for (this user, this app). Used
 *     as the canonical user id throughout the system.
 *   - `email` (optional): Apple may include a real or relay email; only
 *     present on first sign-in unless the user re-grants the scope.
 *   - `email_verified` (optional): Apple's flag; we surface it but don't gate
 *     on it (relay emails are always verified, and we don't currently use
 *     email for anything security-critical).
 *
 * Apple's docs:
 *   https://developer.apple.com/documentation/sign_in_with_apple/sign_in_with_apple_rest_api/verifying_a_user
 */

import { createRemoteJWKSet, jwtVerify, errors as joseErrors } from "jose";

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_JWKS_URL = new URL("https://appleid.apple.com/auth/keys");

// `createRemoteJWKSet` returns a function that fetches and caches Apple's
// public keys, refetching on `kid` cache miss (handles key rotation). Caching
// is per-process, so the cold-start cost is one HTTPS request to Apple — every
// subsequent verification is in-memory.
const remoteJwks = createRemoteJWKSet(APPLE_JWKS_URL, {
  cooldownDuration: 30_000, // don't hammer Apple if their JWKS misbehaves
  timeoutDuration: 10_000,
});

export interface AppleIdentityClaims {
  sub: string;
  email?: string;
  emailVerified?: boolean;
  isPrivateEmail?: boolean;
}

export class AppleTokenVerificationError extends Error {
  readonly name = "AppleTokenVerificationError";
  readonly reason:
    | "malformed"
    | "expired"
    | "invalid_signature"
    | "wrong_issuer_or_audience"
    | "missing_sub"
    | "jwks_unavailable";

  constructor(
    reason: AppleTokenVerificationError["reason"],
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    Object.setPrototypeOf(this, new.target.prototype);
    this.reason = reason;
  }
}

export async function verifyAppleIdentityToken(
  token: string,
  audience: string,
): Promise<AppleIdentityClaims> {
  let payload: Record<string, unknown>;
  try {
    const verified = await jwtVerify(token, remoteJwks, {
      issuer: APPLE_ISSUER,
      audience,
      algorithms: ["RS256", "ES256"],
    });
    payload = verified.payload as Record<string, unknown>;
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      throw new AppleTokenVerificationError(
        "expired",
        "Apple identity token has expired",
        { cause: err },
      );
    }
    if (err instanceof joseErrors.JWSSignatureVerificationFailed) {
      throw new AppleTokenVerificationError(
        "invalid_signature",
        "Apple identity token signature did not verify against Apple's JWKS",
        { cause: err },
      );
    }
    if (err instanceof joseErrors.JWTClaimValidationFailed) {
      throw new AppleTokenVerificationError(
        "wrong_issuer_or_audience",
        `Apple identity token has wrong issuer or audience (expected aud=${audience})`,
        { cause: err },
      );
    }
    if (err instanceof joseErrors.JWKSNoMatchingKey) {
      throw new AppleTokenVerificationError(
        "invalid_signature",
        "No Apple JWKS key matched the token's kid (key rotated or token forged)",
        { cause: err },
      );
    }
    if (
      err instanceof joseErrors.JWKSTimeout ||
      err instanceof joseErrors.JWKSInvalid
    ) {
      throw new AppleTokenVerificationError(
        "jwks_unavailable",
        "Could not reach Apple's JWKS endpoint to verify the token",
        { cause: err },
      );
    }
    throw new AppleTokenVerificationError(
      "malformed",
      "Apple identity token is malformed",
      { cause: err },
    );
  }

  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new AppleTokenVerificationError(
      "missing_sub",
      "Apple identity token has no sub claim",
    );
  }

  return {
    sub: payload.sub,
    email: typeof payload.email === "string" ? payload.email : undefined,
    emailVerified:
      // Apple returns email_verified as a string "true"/"false" in some flows
      // and a boolean in others; normalise to bool.
      typeof payload.email_verified === "boolean"
        ? payload.email_verified
        : typeof payload.email_verified === "string"
          ? payload.email_verified === "true"
          : undefined,
    isPrivateEmail:
      typeof payload.is_private_email === "boolean"
        ? payload.is_private_email
        : typeof payload.is_private_email === "string"
          ? payload.is_private_email === "true"
          : undefined,
  };
}
