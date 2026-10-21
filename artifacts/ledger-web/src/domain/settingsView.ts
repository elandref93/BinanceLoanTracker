/**
 * Settings and diagnostics values shared with the phone's settings blob.
 * Writes keep every field this page does not edit. The request omits
 * updatedAt so the server clock decides a conflict with the phone.
 */

import { parseDecimalInput } from "@/domain/decimalInput";
import { fmtDateTime, groupWithSpaces } from "@/domain/format";
import { snapshotFx } from "@/domain/portfolio";
import { DEFAULT_TARGET_LTV, WARNING_LTV } from "@/domain/risk";

export const MIN_TARGET_LTV = 30;
export const MAX_TARGET_LTV = WARNING_LTV - 1;

export const FX_NOT_RETURNED = "The server did not return a USD to ZAR rate.";
export const SETTINGS_EMPTY = "No settings are stored yet.";
export const SETTINGS_CONFLICT =
  "Settings were updated somewhere else (409). The saved copy was reloaded. This change was not saved.";
export const SETTINGS_SAVE_ERROR = "Settings could not be saved.";
export const SYNC_CONFLICT =
  "The account list was updated somewhere else (409). The saved copy was reloaded. This upload was not saved.";
export const SYNC_EMPTY = "Add at least one exchange link before syncing.";
export const SYNC_OK = "The account list was uploaded. The server assigned the time.";
export const SYNC_ERROR = "The account list could not be uploaded.";
export const KEY_HEALTH_ABSENT = "Key health was not returned.";
export const KEY_HEALTH_EMPTY = "No exchange links to check.";
export const KEY_HEALTH_NOTE = "Key status is metadata only. API keys and secrets are not shown.";
export const LAST_ERROR_ABSENT = "No last error was returned.";
export const PUSH_UNAVAILABLE = "Push notifications are not available on web.";
export const APP_LOCK_UNAVAILABLE = "Face ID is not available on web.";
export const CACHE_UNAVAILABLE = "This browser does not keep exchange keys or a loan cache.";
export const SESSION_CONTROL =
  "Sign out from the Ledger menu. That control uses the existing session. This page does not start a second sign-in.";
export const TARGET_RANGE = `Enter a whole number from ${MIN_TARGET_LTV} to ${MAX_TARGET_LTV}.`;
export const DEFAULT_TARGET_NOTE = `Until a target is saved, headroom uses ${DEFAULT_TARGET_LTV}%.`;
export const DIAGNOSTICS_OMISSION = "API keys, secrets, cookies, and tokens are omitted.";

export type SettingsSaveOutcome =
  | { ok: true }
  | { ok: false; conflict: true; message: string }
  | { ok: false; conflict: false; message: string };

export type SyncNowOutcome =
  | { ok: true; message: string }
  | { ok: false; empty: true; conflict: false; message: string }
  | { ok: false; empty: false; conflict: true; message: string }
  | { ok: false; empty: false; conflict: false; message: string };

export type ProfileTargetEdit = {
  id: string;
  target: number | null;
  clear: boolean;
};

export type KeyHealthRow = {
  linkId: string;
  profile: string;
  exchange: string;
  presence: "present" | "missing";
  lastError: string | null;
};

export type KeyHealthView = {
  rows: KeyHealthRow[];
  note: string;
};

const SECRET_KEYS = new Set([
  "apikey",
  "apisecret",
  "secret",
  "token",
  "accesstoken",
  "refreshtoken",
  "sessiontoken",
  "authorization",
  "cookie",
  "setcookie",
  "password",
  "csrf",
  "xcsrftoken",
  "credentials",
  "credential",
  "bearer",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function secretKey(name: string): boolean {
  return SECRET_KEYS.has(name.toLowerCase().replace(/[-_]/g, ""));
}

/** Strip secret-looking assignments from a string that might be shown. */
export function redactText(value: string): string {
  return value
    .replace(/bearer\s+\S+/gi, "bearer [redacted]")
    .replace(
      /\b(api[_-]?key|api[_-]?secret|token|cookie|authorization|password|session)\b\s*[:=]\s*\S+/gi,
      "$1=[redacted]",
    );
}

/** Drop secret keys and redact secret-looking text before anything is rendered. */
export function redactDiagnostics(value: unknown, seen = new Set<object>()): unknown {
  if (typeof value === "string") return redactText(value);
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  if (Array.isArray(value)) return value.map((item) => redactDiagnostics(item, seen));
  if (!isRecord(value)) return null;
  if (seen.has(value)) return null;
  seen.add(value);
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (secretKey(key)) continue;
    next[key] = redactDiagnostics(child, seen);
  }
  return next;
}

/**
 * 409 stays a conflict. Callers show `message` and reload the server copy.
 * A conflict is never reported as a successful save.
 */
export function classifySettingsWrite(status: number | null): SettingsSaveOutcome {
  if (status != null && status >= 200 && status < 300) return { ok: true };
  if (status === 409) return { ok: false, conflict: true, message: SETTINGS_CONFLICT };
  return { ok: false, conflict: false, message: SETTINGS_SAVE_ERROR };
}

/** No links means there is nothing to upload. A 409 is a visible conflict. */
export function classifyAccountSync(hasLinks: boolean, status: number | null): SyncNowOutcome {
  if (!hasLinks) return { ok: false, empty: true, conflict: false, message: SYNC_EMPTY };
  if (status != null && status >= 200 && status < 300) return { ok: true, message: SYNC_OK };
  if (status === 409) return { ok: false, empty: false, conflict: true, message: SYNC_CONFLICT };
  return { ok: false, empty: false, conflict: false, message: SYNC_ERROR };
}

/** Web settings write. `updatedAt` is intentionally absent so the server assigns it. */
export function settingsSyncBody(settings: Record<string, unknown>): { settings: Record<string, unknown> } {
  return { settings };
}

export function hasExchangeLink(containers: ReadonlyArray<{ links: readonly unknown[] }>): boolean {
  return containers.some((container) => container.links.length > 0);
}

export function parseTargetLtv(raw: string): number | null {
  const value = parseDecimalInput(raw);
  if (value == null) return null;
  const rounded = Math.round(value);
  if (rounded < MIN_TARGET_LTV || rounded > MAX_TARGET_LTV) return null;
  return rounded;
}

export function readStoredTarget(settings: unknown): number | null {
  if (!isRecord(settings)) return null;
  return parseStoredTarget(settings.targetLtv);
}

export function readStoredCurrency(settings: unknown): "USD" | "ZAR" | null {
  if (!isRecord(settings)) return null;
  return settings.currency === "USD" || settings.currency === "ZAR" ? settings.currency : null;
}

export function readProfileTarget(settings: unknown, containerId: string): number | null {
  if (!isRecord(settings) || !isRecord(settings.targetOverrides)) return null;
  return parseStoredTarget(settings.targetOverrides[containerId]);
}

function parseStoredTarget(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < MIN_TARGET_LTV || rounded > MAX_TARGET_LTV) return null;
  return rounded;
}

/**
 * Replace currency and LTV targets only. Alert rules and any other phone
 * fields stay on the object. Override keys this edit does not mention stay too.
 */
export function applySettingsEdits(
  settings: unknown,
  edit: {
    currency: "USD" | "ZAR" | null;
    globalTarget: number | null;
    clearGlobal: boolean;
    profiles: readonly ProfileTargetEdit[];
  },
): Record<string, unknown> {
  const next = isRecord(settings) ? { ...settings } : {};
  if (edit.currency) next.currency = edit.currency;
  if (edit.globalTarget != null) next.targetLtv = edit.globalTarget;
  else if (edit.clearGlobal) delete next.targetLtv;
  const overrides = isRecord(next.targetOverrides) ? { ...next.targetOverrides } : {};
  for (const profile of edit.profiles) {
    if (profile.target != null) overrides[profile.id] = profile.target;
    else if (profile.clear) delete overrides[profile.id];
  }
  next.targetOverrides = overrides;
  return next;
}

/** Rate text from a snapshot field. Missing, zero, and non-numeric rates stay absent. */
export function serverRateText(snapshot: unknown): string {
  if (!isRecord(snapshot)) return FX_NOT_RETURNED;
  const rate = snapshotFx(snapshot.fxUsdToZar);
  if (rate == null) return FX_NOT_RETURNED;
  return `R${groupWithSpaces(rate, 2)} per USD`;
}

export function timestampLabel(value: unknown): string | null {
  if (value instanceof Date) {
    const label = fmtDateTime(value);
    return label === "—" ? null : label;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const label = fmtDateTime(value);
    return label === "—" ? null : label;
  }
  return null;
}

type HealthLink = { id: string; exchange: string };
type HealthContainer = { name: string; links: readonly HealthLink[] };

/**
 * Present when credential metadata lists the link. Missing when the profile
 * has a link and the metadata list does not. Last error is shown only when
 * that field was returned, after redaction. Secret fields are dropped.
 */
export function keyHealthRows(input: { containers: readonly HealthContainer[]; credentials: unknown }): KeyHealthView {
  const clean = redactDiagnostics(input.credentials);
  if (!isRecord(clean) || !Array.isArray(clean.accounts)) {
    return { rows: [], note: KEY_HEALTH_ABSENT };
  }
  const stored = new Map<string, string | null>();
  for (const item of clean.accounts) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.exchange !== "string") continue;
    const lastError = typeof item.lastError === "string" && item.lastError.trim().length > 0 ? item.lastError : null;
    stored.set(`${item.exchange}:${item.id}`, lastError);
  }
  const rows: KeyHealthRow[] = [];
  for (const container of input.containers) {
    for (const link of container.links) {
      const key = `${link.exchange}:${link.id}`;
      const known = stored.has(key);
      rows.push({
        linkId: link.id,
        profile: container.name,
        exchange: link.exchange,
        presence: known ? "present" : "missing",
        lastError: known ? (stored.get(key) ?? null) : null,
      });
    }
  }
  return {
    rows,
    note: rows.length === 0 ? KEY_HEALTH_EMPTY : KEY_HEALTH_NOTE,
  };
}

export function diagnosticsReport(lines: readonly string[]): string {
  return ["Ledger diagnostics", ...lines.map((line) => redactText(line)), DIAGNOSTICS_OMISSION].join("\n");
}
