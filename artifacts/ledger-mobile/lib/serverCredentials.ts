/**
 * Server-side encrypted credentials + scheduled LTV snapshot.
 *
 * Why: by default exchange API keys live only in the iOS Keychain (via
 * expo-secure-store) and the plaintext account blob syncs across the user's
 * own devices through accountSync.ts. That means LTV can only be computed
 * while the app is open. Users who OPT IN here additionally upload their keys
 * to our api-server (which encrypts them at rest) so the server can compute
 * LTV on a schedule even when the app is closed, and the app can read that
 * server-computed snapshot back.
 *
 * Trust model: identical to accountSync.ts — the user has authenticated with
 * Apple, the endpoint is Bearer-gated, and the round-trip is HTTPS-only. The
 * server encrypts the secrets at rest. This module never logs plaintext keys.
 *
 * Everything here is behind the opt-in preference (default OFF). A user who
 * never enables it makes ZERO network calls to these endpoints.
 */

import * as SecureStore from "expo-secure-store";

import { getBinanceLinks, getLunoLinks } from "./accountStore";
import { reportError, reportMessage } from "@/lib/crashReporting";
import { notifyAuthFailure } from "@/lib/authEvents";

const baseUrl = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : "";

// ── opt-in preference ──
// Stored in SecureStore (same as the app-lock pref) so it survives across
// launches but is wiped on uninstall. Default OFF.
const PREF_KEY = "ledger.serverTracking.enabled.v1";

export async function isServerTrackingEnabled(): Promise<boolean> {
  try {
    const v = await SecureStore.getItemAsync(PREF_KEY);
    return v === "1";
  } catch (e) {
    reportError(e, { op: "credentials.pref.read" });
    return false;
  }
}

export async function setServerTrackingEnabled(enabled: boolean): Promise<void> {
  if (enabled) {
    await SecureStore.setItemAsync(PREF_KEY, "1");
  } else {
    await SecureStore.deleteItemAsync(PREF_KEY);
  }
}

export type ServerLtvSnapshot = {
  updatedAt: string;
  asOf: string;
  aggregateLtv: number;
  totalDebtUsd: number;
  totalCollateralUsd: number;
  history: { t: string; ltv: number }[];
};

type CredentialAccount = {
  id: string;
  name: string;
  apiKey: string;
  apiSecret: string;
};

type TokenGetter = () => Promise<string | null>;

let tokenGetter: TokenGetter | null = null;
export function setCredentialsTokenGetter(fn: TokenGetter | null): void {
  tokenGetter = fn;
}

async function authHeader(): Promise<Record<string, string> | null> {
  if (!tokenGetter || !baseUrl) return null;
  const token = await tokenGetter();
  if (!token) return null;
  return { authorization: `Bearer ${token}` };
}

/**
 * Upload the local exchange credentials to the server so it can compute LTV
 * on a schedule. Returns:
 *  - "ok"          — the server accepted the credentials
 *  - "unavailable" — the server has no encryption key configured yet (503)
 *  - "skipped"     — not signed in / offline / no accounts to upload
 *
 * If there are zero links total, this does NOT hit the endpoint.
 */
export async function uploadCredentials(): Promise<"ok" | "skipped" | "unavailable"> {
  const headers = await authHeader();
  if (!headers) {
    reportMessage("[sync] credentials upload skipped", {
      op: "credentials.upload",
      reason: "no-auth",
    });
    return "skipped";
  }
  const [binanceLinks, lunoLinks] = await Promise.all([
    getBinanceLinks(),
    getLunoLinks(),
  ]);
  if (binanceLinks.length === 0 && lunoLinks.length === 0) {
    reportMessage("[sync] credentials upload skipped", {
      op: "credentials.upload",
      reason: "no-accounts",
    });
    return "skipped";
  }
  const toAccount = (l: {
    id: string;
    name: string;
    apiKey: string;
    apiSecret: string;
  }): CredentialAccount => ({
    id: l.id,
    name: l.name,
    apiKey: l.apiKey,
    apiSecret: l.apiSecret,
  });
  const body: { binance?: CredentialAccount[]; luno?: CredentialAccount[] } = {};
  if (binanceLinks.length > 0) body.binance = binanceLinks.map(toAccount);
  if (lunoLinks.length > 0) body.luno = lunoLinks.map(toAccount);
  try {
    const res = await fetch(`${baseUrl}/api/credentials`, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 503) {
      reportMessage("[sync] credentials upload unavailable", {
        op: "credentials.upload",
        status: res.status,
      });
      return "unavailable";
    }
    if (res.status === 401) {
      notifyAuthFailure();
      return "skipped";
    }
    if (!res.ok) {
      reportMessage("[sync] credentials upload skipped", {
        op: "credentials.upload",
        reason: "non-ok",
        status: res.status,
      });
      return "skipped";
    }
    reportMessage("[sync] credentials upload ok", {
      op: "credentials.upload",
      status: res.status,
    });
    return "ok";
  } catch (e) {
    reportError(e, { op: "credentials.upload", reason: "network" });
    return "skipped";
  }
}

/**
 * Delete the server-stored credentials. Returns:
 *  - "ok"      — the server cleared them
 *  - "skipped" — not signed in / offline / non-ok response
 */
export async function deleteServerCredentials(): Promise<"ok" | "skipped"> {
  const headers = await authHeader();
  if (!headers) {
    reportMessage("[sync] credentials delete skipped", {
      op: "credentials.delete",
      reason: "no-auth",
    });
    return "skipped";
  }
  try {
    const res = await fetch(`${baseUrl}/api/credentials`, {
      method: "DELETE",
      headers,
    });
    if (res.status === 401) {
      notifyAuthFailure();
      return "skipped";
    }
    if (!res.ok) {
      reportMessage("[sync] credentials delete skipped", {
        op: "credentials.delete",
        reason: "non-ok",
        status: res.status,
      });
      return "skipped";
    }
    reportMessage("[sync] credentials delete ok", {
      op: "credentials.delete",
      status: res.status,
    });
    return "ok";
  } catch (e) {
    reportError(e, { op: "credentials.delete", reason: "network" });
    return "skipped";
  }
}

/**
 * Fetch the latest server-computed LTV snapshot. Returns null when:
 *  - the user isn't signed in (no token)
 *  - the server has no snapshot yet ({ available: false })
 *  - the network is unreachable (offline-tolerant)
 */
export async function fetchLtvSnapshot(): Promise<ServerLtvSnapshot | null> {
  const headers = await authHeader();
  if (!headers) return null;
  try {
    const res = await fetch(`${baseUrl}/api/ltv/snapshot`, { headers });
    if (res.status === 401) {
      notifyAuthFailure();
      return null;
    }
    if (!res.ok) {
      reportMessage("[sync] ltv snapshot non-ok", {
        op: "ltv.snapshot",
        status: res.status,
      });
      return null;
    }
    const body = (await res.json()) as {
      available?: boolean;
      snapshot?: ServerLtvSnapshot;
    };
    if (!body?.available || !body.snapshot) return null;
    const snap = body.snapshot;
    if (
      typeof snap.updatedAt !== "string" ||
      typeof snap.asOf !== "string" ||
      typeof snap.aggregateLtv !== "number" ||
      !Array.isArray(snap.history)
    ) {
      reportMessage("[sync] ltv snapshot bad-shape", {
        op: "ltv.snapshot",
        status: res.status,
      });
      return null;
    }
    return snap;
  } catch (e) {
    reportError(e, { op: "ltv.snapshot" });
    return null;
  }
}
