import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

import {
  fetchRemoteSettings,
  pushRemoteSettings,
  type SettingsPayload,
} from "./settingsSync";

// ─────────────────────────────────────────────────────────────────────────────
// Cross-device sync for app settings. This module owns the orchestration
// (gather → push, fetch → apply) and a tiny change emitter that the settings
// contexts subscribe to so the UI updates after a remote hydrate.
//
// It reads/writes the SAME storage keys the contexts use locally, so there's
// no migration: existing on-device settings keep working and simply start
// syncing. It deliberately imports nothing from the contexts (or alertRules)
// to avoid import cycles — it touches the raw keys directly.
// ─────────────────────────────────────────────────────────────────────────────

// Display currency + risk targets live in AsyncStorage.
const CURRENCY_KEY = "ledger.currency";
const TARGET_KEY = "ledger.targetLtv";
const OVERRIDES_KEY = "ledger.targetLtv.byContainer.v1";
// Alert rules live in SecureStore (Keychain) alongside the seeded marker.
const ALERTS_KEY = "ledger.alertRules.v1";
const ALERTS_SEEDED_KEY = "ledger.alertRules.seeded.v1";
// Our own monotonic high-water mark for the settings blob.
const UPDATED_AT_KEY = "ledger.settings.updatedAt";

// ── change emitter ──
// Fired after a remote hydrate replaces local settings, so contexts reload.
const listeners = new Set<() => void>();
function notify(): void {
  for (const fn of listeners) fn();
}
export function subscribeSettings(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// Process-lifetime monotonic timestamp — same rationale as accountStore:
// wall-clock can step backwards or collide within a ms, which would trip the
// server's `>=` conflict check and reject a legitimate newer write.
let lastIssuedMs = 0;
function nextMonotonicTimestamp(): string {
  const now = Date.now();
  const next = Math.max(now, lastIssuedMs + 1);
  lastIssuedMs = next;
  return new Date(next).toISOString();
}

function parseCurrency(v: string | null): "USD" | "ZAR" | undefined {
  return v === "USD" || v === "ZAR" ? v : undefined;
}

async function readJson<T>(raw: string | null): Promise<T | undefined> {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/** Snapshot the current on-device settings into a sync payload. */
async function gatherLocal(): Promise<SettingsPayload> {
  const [currencyRaw, targetRaw, overridesRaw, alertsRaw] = await Promise.all([
    AsyncStorage.getItem(CURRENCY_KEY),
    AsyncStorage.getItem(TARGET_KEY),
    AsyncStorage.getItem(OVERRIDES_KEY),
    SecureStore.getItemAsync(ALERTS_KEY),
  ]);

  const payload: SettingsPayload = {};
  const currency = parseCurrency(currencyRaw);
  if (currency) payload.currency = currency;

  const target = targetRaw != null ? Number(targetRaw) : NaN;
  if (Number.isFinite(target)) payload.targetLtv = target;

  const overrides = await readJson<Record<string, number>>(overridesRaw);
  if (overrides && typeof overrides === "object") payload.targetOverrides = overrides;

  const alertRules = await readJson<unknown[]>(alertsRaw);
  if (Array.isArray(alertRules)) payload.alertRules = alertRules;

  return payload;
}

/** Write a remote payload into local storage. Returns true if anything changed. */
async function applyRemote(settings: SettingsPayload): Promise<boolean> {
  let changed = false;
  const writes: Promise<unknown>[] = [];

  if (settings.currency === "USD" || settings.currency === "ZAR") {
    writes.push(AsyncStorage.setItem(CURRENCY_KEY, settings.currency));
    changed = true;
  }
  if (typeof settings.targetLtv === "number" && Number.isFinite(settings.targetLtv)) {
    writes.push(AsyncStorage.setItem(TARGET_KEY, String(settings.targetLtv)));
    changed = true;
  }
  if (settings.targetOverrides && typeof settings.targetOverrides === "object") {
    writes.push(
      AsyncStorage.setItem(OVERRIDES_KEY, JSON.stringify(settings.targetOverrides)),
    );
    changed = true;
  }
  if (Array.isArray(settings.alertRules)) {
    writes.push(SecureStore.setItemAsync(ALERTS_KEY, JSON.stringify(settings.alertRules)));
    // Mark as seeded so listAlertRules() doesn't overwrite synced rules with
    // the built-in defaults on first read on this device.
    writes.push(SecureStore.setItemAsync(ALERTS_SEEDED_KEY, "1"));
    changed = true;
  }

  await Promise.all(writes);
  return changed;
}

/**
 * Snapshot current local settings and push them to the server with a fresh
 * monotonic timestamp. Fire-and-forget: network failures don't block the
 * local change — the next push or hydrate reconciles. On a 409 we re-pull.
 *
 * Call this AFTER the caller has written its own setting to local storage.
 */
export async function pushSettings(): Promise<void> {
  const updatedAt = nextMonotonicTimestamp();
  await AsyncStorage.setItem(UPDATED_AT_KEY, updatedAt);
  const settings = await gatherLocal();
  void pushRemoteSettings({ updatedAt, settings }).then((result) => {
    if (result === "conflict") {
      void hydrateSettings();
    }
  });
}

/**
 * Pull the server's settings and apply them when the server is newer (or local
 * has nothing yet). Emits a change so contexts reload. When local is newer,
 * pushes local up instead. Safe to call when signed out (no-op).
 *
 * Called once after sign-in completes, and after a 409 push response.
 */
export async function hydrateSettings(): Promise<boolean> {
  const remote = await fetchRemoteSettings();
  if (!remote) return false;

  // Pull the high-water mark forward so any local write we issue next outranks
  // the server copy (server compares with `>=`).
  const remoteMs = Date.parse(remote.updatedAt);
  if (Number.isFinite(remoteMs) && remoteMs > lastIssuedMs) {
    lastIssuedMs = remoteMs;
  }

  const localUpdatedAt = await AsyncStorage.getItem(UPDATED_AT_KEY);
  // Local wins on newer OR tie — matches accountStore's `>=` so equal
  // timestamps never silently overwrite local state. Only push when strictly
  // newer (a tie means the server already has an equivalent copy).
  if (localUpdatedAt && localUpdatedAt >= remote.updatedAt) {
    if (localUpdatedAt > remote.updatedAt) {
      const settings = await gatherLocal();
      void pushRemoteSettings({ updatedAt: localUpdatedAt, settings });
    }
    return false;
  }

  const changed = await applyRemote(remote.settings);
  // Adopt the server timestamp so we don't immediately push the same state back.
  await AsyncStorage.setItem(UPDATED_AT_KEY, remote.updatedAt);
  if (changed) notify();
  return changed;
}
