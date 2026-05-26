/**
 * Session JWT — backend-issued bearer token used to authenticate subsequent
 * requests after a successful sign-in.
 *
 * We sign with HS256 using a single shared secret (SESSION_JWT_SECRET) rather
 * than RS256 with a keypair because:
 *   - There's only one party verifying these tokens (this backend).
 *   - There's no need for downstream services to verify them independently.
 *   - HS256 is materially simpler to operate (no JWKS endpoint, no key rotation
 *     ceremony, no PEM handling) and 256-bit HMAC is well past the bar for
 *     session-token authentication.
 *
 * The token's `sub` claim carries the upstream identity provider's stable
 * user identifier (currently Apple's `sub`, which is stable per (user, app)).
 * This keeps auth stateless — the backend doesn't need a users table to
 * recognise repeat callers.
 *
 * Token lifetime: 30 days. Refresh is implicit (the device just re-runs the
 * Apple Sign In flow when the session JWT expires — Apple's native dialog
 * is silent for already-authorised apps).
 */

import { SignJWT, jwtVerify, errors as joseErrors } from "jose";

const ISSUER = "binance-loan-tracker-backend";
const AUDIENCE = "binance-loan-tracker-mobile";
const ALGORITHM = "HS256";
const TOKEN_LIFETIME_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface SessionClaims {
  sub: string;
  email?: string;
  name?: string;
}

let cachedSecret: Uint8Array | null = null;

function getSecret(): Uint8Array {
  if (cachedSecret) return cachedSecret;
  const raw = process.env.SESSION_JWT_SECRET;
  if (!raw) {
    throw new Error(
      "SESSION_JWT_SECRET environment variable is required. " +
        "Generate one with: openssl rand -hex 32",
    );
  }
  if (raw.length < 32) {
    throw new Error(
      "SESSION_JWT_SECRET must be at least 32 characters (256 bits of entropy).",
    );
  }
  cachedSecret = new TextEncoder().encode(raw);
  return cachedSecret;
}

export async function signSession(claims: SessionClaims): Promise<string> {
  const builder = new SignJWT({
    ...(claims.email !== undefined ? { email: claims.email } : {}),
    ...(claims.name !== undefined ? { name: claims.name } : {}),
  })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(
      Math.floor(Date.now() / 1000) + TOKEN_LIFETIME_SECONDS,
    );
  return builder.sign(getSecret());
}

export type SessionVerifyFailure =
  | { ok: false; reason: "expired" }
  | { ok: false; reason: "invalid_signature" }
  | { ok: false; reason: "malformed" }
  | { ok: false; reason: "wrong_audience_or_issuer" };

export type SessionVerifyResult =
  | { ok: true; claims: SessionClaims }
  | SessionVerifyFailure;

export async function verifySession(token: string): Promise<SessionVerifyResult> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: [ALGORITHM],
    });
    if (typeof payload.sub !== "string") {
      return { ok: false, reason: "malformed" };
    }
    return {
      ok: true,
      claims: {
        sub: payload.sub,
        email: typeof payload.email === "string" ? payload.email : undefined,
        name: typeof payload.name === "string" ? payload.name : undefined,
      },
    };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      return { ok: false, reason: "expired" };
    }
    if (err instanceof joseErrors.JWSSignatureVerificationFailed) {
      return { ok: false, reason: "invalid_signature" };
    }
    if (err instanceof joseErrors.JWTClaimValidationFailed) {
      return { ok: false, reason: "wrong_audience_or_issuer" };
    }
    return { ok: false, reason: "malformed" };
  }
}
