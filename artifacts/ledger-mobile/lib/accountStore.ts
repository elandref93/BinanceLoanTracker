import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Profile model: a single "account" is a Personal or Trust profile that holds
// AT MOST one Binance link and AT MOST one Luno link. A user with both a
// personal Binance and a personal Luno key sees a single PERSONAL profile
// with two links inside it — never two PERSONAL profiles each holding a
// Binance.
//
// Storage layout (SecureStore, encrypted on iOS Keychain):
//   ledger.accounts.v3 → AccountContainer[] (current — has `type` field)
//   ledger.accounts.v2 → legacy container shape (no `type`) — migrated then deleted
//   ledger.binance.accounts.v1 → legacy flat binance list — migrated then deleted
// ─────────────────────────────────────────────────────────────────────────────

const V3_KEY = "ledger.accounts.v3";
const V2_KEY = "ledger.accounts.v2";
const V1_KEY = "ledger.binance.accounts.v1";

export type ExchangeKind = "binance" | "luno";
export type ProfileType = "personal" | "trust";

export type BinanceCredentials = {
  apiKey: string;
  apiSecret: string;
};

export type LunoCredentials = {
  // On Luno's API these are `key_id` and `key_secret`. We keep the
  // apiKey/apiSecret names internally for symmetry with binance — the wire
  // format (X-Luno-Accounts header) uses the same shape too.
  apiKey: string;
  apiSecret: string;
};

export type ExchangeLink =
  | {
      id: string;
      exchange: "binance";
      label?: string;
      createdAt: string;
      credentials: BinanceCredentials;
    }
  | {
      id: string;
      exchange: "luno";
      label?: string;
      createdAt: string;
      credentials: LunoCredentials;
    };

export type AccountContainer = {
  id: string;
  /** "personal" or "trust" — required since v3. */
  type: ProfileType;
  /**
   * Optional custom label that disambiguates multiple profiles of the same
   * type (e.g. two trusts: "Family Trust", "Property Trust"). When absent,
   * the type name alone is the display name.
   */
  label?: string;
  /**
   * Derived display name = type-titlecased + optional `· label`. Stored so
   * the UI doesn't need to recompute and so legacy code paths reading
   * `name` keep working. Always re-derived on write — never edit directly.
   */
  name: string;
  createdAt: string;
  links: ExchangeLink[];
};

// ── tiny sync subscriber list so add/remove notifies React immediately ──
const listeners = new Set<() => void>();
function notify(): void {
  for (const fn of listeners) fn();
}
function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// ── legacy shapes ──
type V1Account = {
  id: string;
  name: string;
  apiKey: string;
  apiSecret: string;
  createdAt: string;
};

type V2Container = {
  id: string;
  name: string;
  createdAt: string;
  links: ExchangeLink[];
};

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function titleCaseType(t: ProfileType): string {
  return t === "personal" ? "Personal" : "Trust";
}

function deriveName(type: ProfileType, label?: string): string {
  const trimmed = label?.trim();
  return trimmed ? `${titleCaseType(type)} · ${trimmed}` : titleCaseType(type);
}

/**
 * v2 → v3: every legacy container becomes type="personal" (the only type the
 * UI ever produced before this version). The user can change it later by
 * removing + re-adding the profile. We don't dedupe legacy duplicate links
 * of the same exchange — they remain visible so credentials aren't lost
 * silently; the UI just blocks NEW duplicates going forward.
 */
function upgradeV2Container(v2: V2Container): AccountContainer {
  const trimmedLegacyName = (v2.name ?? "").trim();
  // If the legacy name was exactly "Personal" or "Trust" (case-insensitive),
  // treat that as the type rather than a label so we don't end up with
  // "Personal · Personal".
  const lower = trimmedLegacyName.toLowerCase();
  let type: ProfileType = "personal";
  let label: string | undefined;
  if (lower === "trust") {
    type = "trust";
  } else if (lower === "personal" || lower === "") {
    type = "personal";
  } else {
    type = "personal";
    label = trimmedLegacyName;
  }
  return {
    id: v2.id,
    type,
    label,
    name: deriveName(type, label),
    createdAt: v2.createdAt,
    links: v2.links,
  };
}

async function migrateV1IfNeeded(): Promise<AccountContainer[] | null> {
  const legacyRaw = await SecureStore.getItemAsync(V1_KEY);
  if (!legacyRaw) return null;
  let legacy: V1Account[];
  try {
    legacy = JSON.parse(legacyRaw);
    if (!Array.isArray(legacy)) return null;
  } catch {
    return null;
  }
  const migrated: AccountContainer[] = legacy.map((a) => {
    const lower = (a.name ?? "").trim().toLowerCase();
    const type: ProfileType = lower === "trust" ? "trust" : "personal";
    const label =
      lower === "trust" || lower === "personal" || lower === ""
        ? undefined
        : a.name.trim();
    return {
      id: a.id,
      type,
      label,
      name: deriveName(type, label),
      createdAt: a.createdAt,
      links: [
        {
          id: genId("link"),
          exchange: "binance" as const,
          createdAt: a.createdAt,
          credentials: { apiKey: a.apiKey, apiSecret: a.apiSecret },
        },
      ],
    };
  });
  await SecureStore.setItemAsync(V3_KEY, JSON.stringify(migrated));
  await SecureStore.deleteItemAsync(V1_KEY);
  return migrated;
}

async function migrateV2IfNeeded(): Promise<AccountContainer[] | null> {
  const v2raw = await SecureStore.getItemAsync(V2_KEY);
  if (!v2raw) return null;
  let v2: V2Container[];
  try {
    v2 = JSON.parse(v2raw);
    if (!Array.isArray(v2)) return null;
  } catch {
    return null;
  }
  const upgraded = v2.map(upgradeV2Container);
  await SecureStore.setItemAsync(V3_KEY, JSON.stringify(upgraded));
  await SecureStore.deleteItemAsync(V2_KEY);
  return upgraded;
}

async function readAll(): Promise<AccountContainer[]> {
  try {
    const raw = await SecureStore.getItemAsync(V3_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      // Defensive: if anything else writes the slot with a partial shape,
      // backfill `type`/`name` so the UI doesn't crash.
      return parsed.map((c: AccountContainer & Partial<V2Container>) => {
        if (c.type && c.name) return c as AccountContainer;
        return upgradeV2Container(c as V2Container);
      });
    }
    // Migration path — serialize via the write lock so two concurrent first
    // reads (e.g. settings + onboarding mounting at the same time) can't
    // both run the migration and step on each other's writes. The lock
    // callback re-reads V3 first in case the other caller already finished.
    return await withWriteLock(async () => {
      const rawAgain = await SecureStore.getItemAsync(V3_KEY);
      if (rawAgain) {
        const parsed = JSON.parse(rawAgain);
        return Array.isArray(parsed) ? (parsed as AccountContainer[]) : [];
      }
      const v2 = await migrateV2IfNeeded();
      if (v2) return v2;
      const v1 = await migrateV1IfNeeded();
      return v1 ?? [];
    });
  } catch {
    return [];
  }
}

async function writeAll(containers: AccountContainer[]): Promise<void> {
  await SecureStore.setItemAsync(V3_KEY, JSON.stringify(containers));
}

// ── write serialization ──
// SecureStore has no compare-and-swap, so two concurrent
// read-modify-write mutations (e.g. two rapid "Add link" taps, or a UI
// remove racing a background refresh) can clobber each other's writes.
// All mutators funnel through this queue so RMW cycles run strictly
// in series. Reads remain unsynchronized — they're idempotent.
let writeChain: Promise<unknown> = Promise.resolve();
function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  // Swallow rejections on the chain itself so one failure doesn't poison
  // subsequent writes; callers still see their own promise reject.
  writeChain = next.catch(() => undefined);
  return next;
}

// ── public API ──

export async function listContainersWithSecrets(): Promise<AccountContainer[]> {
  return readAll();
}

export type StoredContainer = {
  id: string;
  type: ProfileType;
  label?: string;
  /** Derived display name = type + optional `· label`. */
  name: string;
  createdAt: string;
  links: Array<{
    id: string;
    exchange: ExchangeKind;
    label?: string;
    createdAt: string;
    apiKeyMasked: string;
  }>;
};

function maskKey(key: string): string {
  if (key.length <= 8) return "•".repeat(key.length);
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

export async function listContainers(): Promise<StoredContainer[]> {
  const all = await readAll();
  return all.map((c) => ({
    id: c.id,
    type: c.type,
    label: c.label,
    name: c.name,
    createdAt: c.createdAt,
    links: c.links.map((l) => ({
      id: l.id,
      exchange: l.exchange,
      label: l.label,
      createdAt: l.createdAt,
      apiKeyMasked: maskKey(l.credentials.apiKey),
    })),
  }));
}

/**
 * Create an empty profile. The caller is expected to add at least one link
 * shortly after — empty profiles are filtered out of the onboarding count
 * so they don't bypass the gate.
 */
export function createProfile(
  type: ProfileType,
  label?: string,
): Promise<AccountContainer> {
  return withWriteLock(async () => {
    const all = await readAll();
    const container: AccountContainer = {
      id: genId("acct"),
      type,
      label: label?.trim() || undefined,
      name: deriveName(type, label),
      createdAt: new Date().toISOString(),
      links: [],
    };
    all.push(container);
    await writeAll(all);
    notify();
    return container;
  });
}

export function removeContainer(id: string): Promise<void> {
  return withWriteLock(async () => {
    const all = await readAll();
    await writeAll(all.filter((c) => c.id !== id));
    notify();
  });
}

/**
 * Update profile type and/or label. Re-derives `name` automatically. Pass
 * `label: null` to clear the label (undefined leaves it untouched).
 */
export function updateProfile(
  id: string,
  changes: { type?: ProfileType; label?: string | null },
): Promise<void> {
  return withWriteLock(async () => {
    const all = await readAll();
    const c = all.find((x) => x.id === id);
    if (!c) return;
    if (changes.type) c.type = changes.type;
    if (changes.label === null) c.label = undefined;
    else if (changes.label !== undefined) c.label = changes.label.trim() || undefined;
    c.name = deriveName(c.type, c.label);
    await writeAll(all);
    notify();
  });
}

export class ProfileAlreadyHasLinkError extends Error {
  exchange: ExchangeKind;
  constructor(exchange: ExchangeKind) {
    const which = exchange === "binance" ? "Binance" : "Luno";
    super(`This profile already has a ${which} link. Remove it first or pick a different profile.`);
    this.name = "ProfileAlreadyHasLinkError";
    this.exchange = exchange;
  }
}

/**
 * Add a link to a specific profile, OR create a new profile in one step
 * if `target.kind === "new"`. Returns the profile id so the caller can
 * navigate back to it. Throws ProfileAlreadyHasLinkError if the target
 * profile already has a link of the same exchange — Personal/Trust
 * profiles are limited to one Binance + one Luno each.
 */
export function addLink(
  target:
    | { kind: "existing"; containerId: string }
    | { kind: "new"; type: ProfileType; label?: string },
  link: {
    exchange: ExchangeKind;
    label?: string;
    credentials: { apiKey: string; apiSecret: string };
  },
): Promise<string> {
  return withWriteLock(async () => {
    const all = await readAll();
    let container: AccountContainer | undefined;
    if (target.kind === "existing") {
      container = all.find((c) => c.id === target.containerId);
      if (!container) throw new Error("Profile not found");
    } else {
      container = {
        id: genId("acct"),
        type: target.type,
        label: target.label?.trim() || undefined,
        name: deriveName(target.type, target.label),
        createdAt: new Date().toISOString(),
        links: [],
      };
      all.push(container);
    }
    // One-per-exchange invariant: a profile may have ≤1 Binance link and ≤1
    // Luno link. The UI prevents the user from reaching this state, but
    // re-checking here protects against race conditions (two screens open,
    // navigating back/forward, etc.) and against direct API misuse.
    if (container.links.some((l) => l.exchange === link.exchange)) {
      throw new ProfileAlreadyHasLinkError(link.exchange);
    }
    const newLink: ExchangeLink = {
      id: genId("link"),
      exchange: link.exchange,
      label: link.label?.trim() || undefined,
      createdAt: new Date().toISOString(),
      credentials: {
        apiKey: link.credentials.apiKey.trim(),
        apiSecret: link.credentials.apiSecret.trim(),
      },
    } as ExchangeLink;
    container.links.push(newLink);
    await writeAll(all);
    notify();
    return container.id;
  });
}

export function removeLink(
  containerId: string,
  linkId: string,
): Promise<void> {
  return withWriteLock(async () => {
    const all = await readAll();
    const c = all.find((x) => x.id === containerId);
    if (!c) return;
    c.links = c.links.filter((l) => l.id !== linkId);
    await writeAll(all);
    notify();
  });
}

// ── flatteners for header builders ──

export type LinkWithCreds = {
  /** link id (stable, per-link). */
  id: string;
  /** Display name: container.name (· link.label if present). */
  name: string;
  apiKey: string;
  apiSecret: string;
  containerId: string;
};

function flatten(
  containers: AccountContainer[],
  exchange: ExchangeKind,
): LinkWithCreds[] {
  const out: LinkWithCreds[] = [];
  for (const c of containers) {
    for (const l of c.links) {
      if (l.exchange !== exchange) continue;
      out.push({
        id: l.id,
        name: l.label ? `${c.name} · ${l.label}` : c.name,
        apiKey: l.credentials.apiKey,
        apiSecret: l.credentials.apiSecret,
        containerId: c.id,
      });
    }
  }
  return out;
}

export async function getBinanceLinks(): Promise<LinkWithCreds[]> {
  return flatten(await readAll(), "binance");
}

export async function getLunoLinks(): Promise<LinkWithCreds[]> {
  return flatten(await readAll(), "luno");
}

// ── hooks ──

/**
 * Count of containers that have AT LEAST ONE link. Used by the onboarding gate
 * — empty containers shouldn't bypass it. Returns null until the first read.
 */
export function useStoredAccountsCount(): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      readAll().then((all) => {
        if (cancelled) return;
        setCount(all.filter((c) => c.links.length > 0).length);
      });
    };
    refresh();
    return subscribe(refresh);
  }, []);
  return count;
}
