/**
 * Cross-device sync for the local accountStore.
 *
 * Why: API keys are stored in iOS Keychain via expo-secure-store, which is
 * device-local — installing the app on a second device (e.g. iPhone + iPad
 * under the same Apple ID) shows an empty list. expo-secure-store does not
 * expose iCloud Keychain syncing, so we sync through our own api-server
 * keyed by the Apple Sign In subject.
 *
 * Trust model: the user has already authenticated with Apple, so the server
 * stores the blob as plain JSON behind a Bearer-gated endpoint. The endpoint
 * round-trip is HTTPS-only.
 *
 * Conflict resolution: last-write-wins by client `updatedAt`. The server
 * returns 409 + the current blob if the incoming push is older than the
 * stored copy, so the client knows to re-pull instead of clobber.
 */

import type { AccountContainer } from "./accountStore";

const baseUrl = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : "";

export type RemoteBlob = {
  updatedAt: string;
  containers: AccountContainer[];
};

type TokenGetter = () => Promise<string | null>;

let tokenGetter: TokenGetter | null = null;
export function setSyncTokenGetter(fn: TokenGetter | null): void {
  tokenGetter = fn;
}

async function authHeader(): Promise<Record<string, string> | null> {
  if (!tokenGetter || !baseUrl) return null;
  const token = await tokenGetter();
  if (!token) return null;
  return { authorization: `Bearer ${token}` };
}

/**
 * Fetch the server's copy. Returns null when:
 *  - the user isn't signed in (no token)
 *  - the server has no copy yet (404)
 *  - the network is unreachable (offline-tolerant)
 */
export async function fetchRemoteBlob(): Promise<RemoteBlob | null> {
  const headers = await authHeader();
  if (!headers) return null;
  try {
    const res = await fetch(`${baseUrl}/api/accounts/sync`, { headers });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const body = (await res.json()) as RemoteBlob;
    if (typeof body?.updatedAt !== "string" || !Array.isArray(body.containers)) {
      return null;
    }
    return body;
  } catch {
    return null;
  }
}

/**
 * Push the local copy to the server. Returns:
 *  - "ok"        — the server accepted the write
 *  - "conflict"  — the server has a newer copy (caller should re-pull)
 *  - "skipped"   — not signed in / offline (caller should retry later)
 */
export async function pushRemoteBlob(
  blob: RemoteBlob,
): Promise<"ok" | "conflict" | "skipped"> {
  const headers = await authHeader();
  if (!headers) return "skipped";
  try {
    const res = await fetch(`${baseUrl}/api/accounts/sync`, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(blob),
    });
    if (res.status === 409) return "conflict";
    if (!res.ok) return "skipped";
    return "ok";
  } catch {
    return "skipped";
  }
}
