import {
  SignJWT,
  jwtVerify,
  decodeProtectedHeader,
  exportJWK,
  calculateJwkThumbprint,
  errors as joseErrors,
  type JWK,
} from "jose";
import { createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";

const AUDIENCE = "binance-loan-tracker-mobile";

// The original HS256 issuer (a bare name, not a URL). Tokens minted before the
// RS256 cutover carry this `iss`; we keep accepting it during verification so
// existing 30-day sessions keep working until they expire.
const LEGACY_ISSUER = "binance-loan-tracker-backend";

// OIDC requires the issuer to be the HTTPS base URL that serves the discovery
// document (issuer + "/.well-known/openid-configuration"). This is what Azure
// Easy Auth (custom OIDC provider) validates the token's `iss` against, so it
// must match the URL of THIS backend. Overridable for non-prod hosts.
const DEFAULT_OIDC_ISSUER =
  "https://binance-loan-tracker-backend.azurewebsites.net";

const RS_ALG = "RS256";
const HS_ALG = "HS256";
const TOKEN_LIFETIME_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface SessionClaims {
  sub: string;
  email?: string;
  name?: string;
}

export function getOidcIssuer(): string {
  return (process.env.SESSION_JWT_ISSUER ?? DEFAULT_OIDC_ISSUER).replace(
    /\/+$/,
    "",
  );
}

export function getAudience(): string {
  return AUDIENCE;
}

function acceptedIssuers(): string[] {
  // De-dupe in case SESSION_JWT_ISSUER is set to the legacy value.
  return Array.from(new Set([getOidcIssuer(), LEGACY_ISSUER]));
}

// ── RSA keys (RS256) ────────────────────────────────────────────────────────
// The private key signs new tokens; the public key is published via JWKS so
// Azure Easy Auth and (re-)the app can verify them. A previous key may be kept
// during rotation so tokens it signed keep verifying until they expire.

interface RsaKey {
  /** Private key — used to sign. */
  signer: KeyObject;
  /** Public key — used to verify. */
  verifier: KeyObject;
  /** Public key as a JWK (with kid/alg/use) for the JWKS endpoint. */
  publicJwk: JWK;
  /** RFC 7638 thumbprint, set as the JWT header `kid`. */
  kid: string;
}

// Secret managers frequently mangle multi-line PEMs: the newlines get turned
// into literal `\n` escape sequences, or collapsed into spaces. Repair both so
// a key pasted via the UI parses regardless of how the newlines survived.
function normalizePem(raw: string): string {
  let pem = raw.trim();
  // Strip surrounding quotes if the value was pasted with them.
  if (
    (pem.startsWith('"') && pem.endsWith('"')) ||
    (pem.startsWith("'") && pem.endsWith("'"))
  ) {
    pem = pem.slice(1, -1);
  }
  // Convert literal backslash-n / backslash-r-n escapes into real newlines.
  pem = pem.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\r/g, "\n");
  // If newlines were lost entirely (body separated by spaces), rebuild the PEM
  // by re-wrapping the base64 body at 64 chars between the BEGIN/END markers.
  const match = pem.match(
    /-----BEGIN ([A-Z0-9 ]+?)-----([\s\S]*?)-----END \1-----/,
  );
  if (match && !match[2].includes("\n")) {
    const label = match[1];
    const body = match[2].replace(/\s+/g, "");
    const wrapped = body.replace(/(.{64})/g, "$1\n").trim();
    pem = `-----BEGIN ${label}-----\n${wrapped}\n-----END ${label}-----\n`;
  }
  return pem;
}

async function loadRsaKey(envName: string): Promise<RsaKey | null> {
  const raw = process.env[envName];
  if (!raw || raw.trim() === "") return null;
  const pem = normalizePem(raw);
  let signer: KeyObject;
  try {
    signer = createPrivateKey(pem);
  } catch (e) {
    throw new Error(
      `${envName} is not a valid PEM private key (expected PKCS8): ${
        (e as Error).message
      }`,
    );
  }
  const verifier = createPublicKey(signer);
  const publicJwk = await exportJWK(verifier);
  const kid = await calculateJwkThumbprint(publicJwk);
  publicJwk.kid = kid;
  publicJwk.alg = RS_ALG;
  publicJwk.use = "sig";
  return { signer, verifier, publicJwk, kid };
}

// Cache the load promise so the key is parsed once per process.
let rsaCurrentPromise: Promise<RsaKey | null> | null = null;
let rsaPreviousPromise: Promise<RsaKey | null> | null = null;

function getRsaCurrent(): Promise<RsaKey | null> {
  return (rsaCurrentPromise ??= loadRsaKey("SESSION_JWT_PRIVATE_KEY"));
}

function getRsaPrevious(): Promise<RsaKey | null> {
  return (rsaPreviousPromise ??= loadRsaKey("SESSION_JWT_PRIVATE_KEY_PREVIOUS"));
}

// ── HS256 secrets (legacy) ───────────────────────────────────────────────────

let cachedSecret: Uint8Array | null | undefined; // undefined = not read yet
let cachedPrevSecret: Uint8Array | null | undefined;

function encodeSecret(raw: string, varName: string): Uint8Array {
  if (raw.length < 32) {
    throw new Error(
      `${varName} must be at least 32 characters (256 bits of entropy).`,
    );
  }
  return new TextEncoder().encode(raw);
}

function getSecret(): Uint8Array | null {
  if (cachedSecret !== undefined) return cachedSecret;
  const raw = process.env.SESSION_JWT_SECRET;
  cachedSecret = raw ? encodeSecret(raw, "SESSION_JWT_SECRET") : null;
  return cachedSecret;
}

function getPreviousSecret(): Uint8Array | null {
  if (cachedPrevSecret !== undefined) return cachedPrevSecret;
  const raw = process.env.SESSION_JWT_SECRET_PREVIOUS;
  cachedPrevSecret = raw
    ? encodeSecret(raw, "SESSION_JWT_SECRET_PREVIOUS")
    : null;
  return cachedPrevSecret;
}

/** JWKS document for `/.well-known/jwks.json`. Empty when no RSA key is set. */
export async function getPublicJwks(): Promise<{ keys: JWK[] }> {
  const keys: JWK[] = [];
  const current = await getRsaCurrent();
  if (current) keys.push(current.publicJwk);
  const previous = await getRsaPrevious();
  if (previous) keys.push(previous.publicJwk);
  return { keys };
}

export async function signSession(claims: SessionClaims): Promise<string> {
  const builder = new SignJWT({
    ...(claims.email !== undefined ? { email: claims.email } : {}),
    ...(claims.name !== undefined ? { name: claims.name } : {}),
  })
    .setAudience(AUDIENCE)
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + TOKEN_LIFETIME_SECONDS);

  // Prefer RS256 (asymmetric) when a private key is configured — this is what
  // Azure Easy Auth validates against our published JWKS. Falls back to the
  // legacy HS256 secret so deploying this code changes nothing until the RSA
  // key is provisioned.
  const rsa = await getRsaCurrent();
  if (rsa) {
    return builder
      .setProtectedHeader({ alg: RS_ALG, kid: rsa.kid, typ: "JWT" })
      .setIssuer(getOidcIssuer())
      .sign(rsa.signer);
  }

  const secret = getSecret();
  if (!secret) {
    throw new Error(
      "No signing key configured. Set SESSION_JWT_PRIVATE_KEY (RS256, " +
        "recommended) or SESSION_JWT_SECRET (legacy HS256).",
    );
  }
  return builder
    .setProtectedHeader({ alg: HS_ALG })
    .setIssuer(LEGACY_ISSUER)
    .sign(secret);
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
  key: KeyObject | Uint8Array,
  alg: string,
): Promise<SessionVerifyResult> {
  try {
    const { payload } = await jwtVerify(token, key, {
      issuer: acceptedIssuers(),
      audience: AUDIENCE,
      algorithms: [alg],
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
    // JOSEAlgNotAllowed (token signed with a different family than this
    // candidate key) and anything else → treat as malformed so the caller
    // moves on to the next candidate key.
    return { ok: false, reason: "malformed" };
  }
}

/**
 * Verify a session token. The signing family is chosen from the token's own
 * `alg` header, then matched against the keys we hold for that family —
 * RS256 (current → previous public key) or legacy HS256 (current → previous
 * secret). Selecting by header (rather than trying every key) keeps the failure
 * reason meaningful and rules out cross-family key confusion. A definitive
 * `expired` result short-circuits — a stale token shouldn't be resurrected by
 * trying another key.
 */
export async function verifySession(
  token: string,
): Promise<SessionVerifyResult> {
  let alg: string | undefined;
  try {
    alg = decodeProtectedHeader(token).alg;
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const candidates: Array<KeyObject | Uint8Array> = [];
  if (alg === RS_ALG) {
    const current = await getRsaCurrent();
    if (current) candidates.push(current.verifier);
    const previous = await getRsaPrevious();
    if (previous) candidates.push(previous.verifier);
  } else if (alg === HS_ALG) {
    const secret = getSecret();
    if (secret) candidates.push(secret);
    const prevSecret = getPreviousSecret();
    if (prevSecret) candidates.push(prevSecret);
  } else {
    // Unknown / unsupported algorithm (incl. "none").
    return { ok: false, reason: "malformed" };
  }

  if (candidates.length === 0) {
    // The token uses a supported alg but we hold no key for it (e.g. an RS256
    // token before the private key is provisioned). Reject as a signature
    // failure rather than throwing — the request is simply unauthenticated.
    return { ok: false, reason: "invalid_signature" };
  }

  let lastFailure: SessionVerifyFailure = {
    ok: false,
    reason: "invalid_signature",
  };
  for (const key of candidates) {
    const result = await verifyWith(token, key, alg);
    if (result.ok) return result;
    if (result.reason === "expired") return result;
    lastFailure = result;
  }
  return lastFailure;
}
