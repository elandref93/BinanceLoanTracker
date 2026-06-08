import crypto from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Authenticated encryption for credentials at rest.
//
// AES-256-GCM (confidentiality + integrity). The 32-byte master key comes from
// the `CREDENTIAL_ENCRYPTION_KEY` env var (base64), never from code or disk.
// Each `seal()` uses a fresh random 12-byte IV. We store {iv, tag, ct} as
// base64. GCM's auth tag means any tampering with the ciphertext fails decryption
// loudly instead of returning garbage.
//
// Plaintext secrets exist only transiently in memory during seal/open — they are
// never logged here or by callers.
// ─────────────────────────────────────────────────────────────────────────────

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;

export interface Sealed {
  v: 1;
  iv: string;
  tag: string;
  ct: string;
}

let cachedKey: Buffer | null = null;

function masterKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "CREDENTIAL_ENCRYPTION_KEY is not set — cannot encrypt/decrypt stored credentials.",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `CREDENTIAL_ENCRYPTION_KEY must decode from base64 to ${KEY_BYTES} bytes (got ${key.length}).`,
    );
  }
  cachedKey = key;
  return key;
}

/** True when a valid master key is configured. Lets callers degrade gracefully. */
export function isCryptoConfigured(): boolean {
  try {
    masterKey();
    return true;
  } catch {
    return false;
  }
}

export function seal(plaintext: string): Sealed {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, masterKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ct: ct.toString("base64"),
  };
}

export function open(sealed: Sealed): string {
  const iv = Buffer.from(sealed.iv, "base64");
  const tag = Buffer.from(sealed.tag, "base64");
  const ct = Buffer.from(sealed.ct, "base64");
  const decipher = crypto.createDecipheriv(ALGO, masterKey(), iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}
