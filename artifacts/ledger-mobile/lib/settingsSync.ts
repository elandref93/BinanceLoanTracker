/**
 * Cross-device sync for app settings (display currency, target LTV + per-account
 * overrides, and alert rules).
 *
 * Why: these live in AsyncStorage / iOS Keychain, which are device-local — a
 * second device signed into the same Apple ID would show app defaults instead
 * of the user's configured setup. We sync them through our own api-server,
 * keyed by the Apple Sign In subject, exactly like accountSync does for the
 * account list.
 *
 * Conflict resolution: last-write-wins by client `updatedAt`. The server
 * returns 409 + the current blob when the incoming push is older, so the
 * client re-pulls instead of clobbering.
 */

import { reportError, reportMessage } from "@/lib/crashReporting";

const baseUrl = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : "";

/** Opaque-to-the-network settings payload. All fields optional so the shape
 * can grow without breaking older clients. */
export type SettingsPayload = {
  currency?: "USD" | "ZAR";
  targetLtv?: number;
  targetOverrides?: Record<string, number>;
  alertRules?: unknown[];
};

export type RemoteSettingsBlob = {
  updatedAt: string;
  settings: SettingsPayload;
};

type TokenGetter = () => Promise<string | null>;

let tokenGetter: TokenGetter | null = null;
export function setSettingsTokenGetter(fn: TokenGetter | null): void {
  tokenGetter = fn;
}

async function authHeader(): Promise<Record<string, string> | null> {
  if (!tokenGetter || !baseUrl) return null;
  const token = await tokenGetter();
  if (!token) return null;
  return { authorization: `Bearer ${token}` };
}

/**
 * Fetch the server's copy. Returns null when not signed in, the server has no
 * copy yet (404), or the network is unreachable (offline-tolerant).
 */
export async function fetchRemoteSettings(): Promise<RemoteSettingsBlob | null> {
  const headers = await authHeader();
  if (!headers) return null;
  try {
    const res = await fetch(`${baseUrl}/api/settings/sync`, { headers });
    if (res.status === 404) return null;
    if (!res.ok) {
      reportMessage("[sync] settings fetch non-ok", {
        op: "settings.fetch",
        status: res.status,
      });
      return null;
    }
    const body = (await res.json()) as RemoteSettingsBlob;
    if (
      typeof body?.updatedAt !== "string" ||
      typeof body.settings !== "object" ||
      body.settings === null
    ) {
      reportMessage("[sync] settings fetch bad-shape", {
        op: "settings.fetch",
        status: res.status,
      });
      return null;
    }
    return body;
  } catch (e) {
    reportError(e, { op: "settings.fetch" });
    return null;
  }
}

/**
 * Push the local copy to the server.
 *  - "ok"       — accepted
 *  - "conflict" — the server has a newer copy (caller should re-pull)
 *  - "skipped"  — not signed in / offline (caller should retry later)
 */
export async function pushRemoteSettings(
  blob: RemoteSettingsBlob,
): Promise<"ok" | "conflict" | "skipped"> {
  const headers = await authHeader();
  if (!headers) {
    reportMessage("[sync] settings push skipped", {
      op: "settings.push",
      reason: "no-auth",
    });
    return "skipped";
  }
  try {
    const res = await fetch(`${baseUrl}/api/settings/sync`, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(blob),
    });
    if (res.status === 409) {
      reportMessage("[sync] settings push conflict", {
        op: "settings.push",
        status: res.status,
      });
      return "conflict";
    }
    if (!res.ok) {
      reportMessage("[sync] settings push skipped", {
        op: "settings.push",
        reason: "non-ok",
        status: res.status,
      });
      return "skipped";
    }
    reportMessage("[sync] settings push ok", {
      op: "settings.push",
      status: res.status,
    });
    return "ok";
  } catch (e) {
    reportError(e, { op: "settings.push", reason: "network" });
    return "skipped";
  }
}
