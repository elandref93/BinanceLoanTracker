import type { PushRemoteResult } from "./accountSync";

export type AccountsHydrateStatus = "pending" | "ok" | "empty" | "error";

export type HydrateFromServerResult = {
  status: AccountsHydrateStatus;
  /** True when local SecureStore was replaced from the server copy. */
  changed: boolean;
  /** True when local accounts were uploaded because the server had no blob. */
  pushed?: boolean;
  errorMessage?: string;
};

export type SyncDiagnosticsSnapshot = {
  lastHydrate: HydrateFromServerResult | null;
  lastHydrateAt: string | null;
  lastPush: PushRemoteResult | null;
  lastPushAt: string | null;
};

let lastHydrate: HydrateFromServerResult | null = null;
let lastHydrateAt: string | null = null;
let lastPush: PushRemoteResult | null = null;
let lastPushAt: string | null = null;

const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

export function recordHydrateResult(result: HydrateFromServerResult): void {
  lastHydrate = result;
  lastHydrateAt = new Date().toISOString();
  notify();
}

export function recordPushResult(result: PushRemoteResult): void {
  lastPush = result;
  lastPushAt = new Date().toISOString();
  notify();
}

export function getSyncDiagnostics(): SyncDiagnosticsSnapshot {
  return {
    lastHydrate,
    lastHydrateAt,
    lastPush,
    lastPushAt,
  };
}

export function subscribeSyncDiagnostics(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
