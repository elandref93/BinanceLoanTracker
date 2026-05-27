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
let cachedPrevSecret: Uint8Array | null | undefined; // undefined = not yet read

function encode(raw: string, varName: string): Uint8Array {
  if (raw.length < 32) {
    throw new Error(
      `${varName} must be at least 32 characters (256 bits of entropy).`,
    );
  }
  return new TextEncoder().encode(raw);
}

function getSecret(): Uint8Array {
  if (cachedSecret) return cachedSecret;
  const raw = process.env.SESSION_JWT_SECRET;
  if (!raw) {
    throw new Error(
      "SESSION_JWT_SECRET environment variable is required. " +
        "Generate one with: openssl rand -hex 32",
    );
  }
  cachedSecret = encode(raw, "SESSION_JWT_SECRET");
  return cachedSecret;
}

/**
 * Optional secondary key for rotation. When you rotate `SESSION_JWT_SECRET`,
 * move the old value to `SESSION_JWT_SECRET_PREVIOUS` so tokens signed by it
 * keep verifying until they expire naturally. Remove the previous after one
 * token-lifetime (30 days).
 */
function getPreviousSecret(): Uint8Array | null {
  if (cachedPrevSecret !== undefined) return cachedPrevSecret;
  const raw = process.env.SESSION_JWT_SECRET_PREVIOUS;
  cachedPrevSecret = raw ? encode(raw, "SESSION_JWT_SECRET_PREVIOUS") : null;
  return cachedPrevSecret;
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

async function verifyWith(
  token: string,
  secret: Uint8Array,
): Promise<SessionVerifyResult> {
  try {
    const { payload } = await jwtVerify(token, secret, {
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

export async function verifySession(token: string): Promise<SessionVerifyResult> {
  const primary = await verifyWith(token, getSecret());
  if (primary.ok) return primary;
  // Only retry against the previous key when the failure could plausibly be a
  // signature mismatch from key rotation. Expired tokens shouldn't be
  // resurrected by trying another key.
  if (primary.reason !== "invalid_signature") return primary;
  const prev = getPreviousSecret();
  if (!prev) return primary;
  return verifyWith(token, prev);
}
