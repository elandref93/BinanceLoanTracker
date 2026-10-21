/**
 * Removes exchange secrets from an account-sync payload before it is stored.
 *
 * The installed phone app still puts `apiKey` / `apiSecret` on each link.
 * Stripping them on every account-sync PUT stops those plaintext values from
 * being written back. Other profile fields (id, type, label, name, exchange,
 * timestamps) stay so the phone can keep syncing metadata with its Bearer token.
 */

const SECRET_FIELDS = new Set(["apiKey", "apiSecret"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function stripValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripValue);
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    if (SECRET_FIELDS.has(key)) continue;
    out[key] = stripValue(value[key]);
  }
  return out;
}

export function stripAccountSyncSecrets<T>(payload: T): T {
  return stripValue(payload) as T;
}
