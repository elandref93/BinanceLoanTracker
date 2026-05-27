import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Container model: a single "account" holds multiple per-exchange links
// (Binance + Luno). Existing v1 flat-binance storage is migrated lossless on
// first read — every old binance row becomes a container whose name matches
// the old account name, holding one binance link.
//
// Storage layout (SecureStore, encrypted on iOS Keychain):
//   ledger.accounts.v2 → AccountContainer[]
//   ledger.binance.accounts.v1 → legacy, read once for migration then deleted
// ─────────────────────────────────────────────────────────────────────────────

const V2_KEY = "ledger.accounts.v2";
const V1_KEY = "ledger.binance.accounts.v1";

export type ExchangeKind = "binance" | "luno";

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

// ── legacy v1 shape (binance-only flat list) ──
type V1Account = {
  id: string;
  name: string;
  apiKey: string;
  apiSecret: string;
  createdAt: string;
};

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
  const migrated: AccountContainer[] = legacy.map((a) => ({
    id: a.id,
    name: a.name,
    createdAt: a.createdAt,
    links: [
      {
        id: genId("link"),
        exchange: "binance" as const,
        createdAt: a.createdAt,
        credentials: { apiKey: a.apiKey, apiSecret: a.apiSecret },
      },
    ],
  }));
  await SecureStore.setItemAsync(V2_KEY, JSON.stringify(migrated));
  await SecureStore.deleteItemAsync(V1_KEY);
  return migrated;
}

async function readAll(): Promise<AccountContainer[]> {
  try {
    const raw = await SecureStore.getItemAsync(V2_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as AccountContainer[]) : [];
    }
    const migrated = await migrateV1IfNeeded();
    return migrated ?? [];
  } catch {
    return [];
  }
}

async function writeAll(containers: AccountContainer[]): Promise<void> {
  await SecureStore.setItemAsync(V2_KEY, JSON.stringify(containers));
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

export function createContainer(name: string): Promise<AccountContainer> {
  return withWriteLock(async () => {
    const all = await readAll();
    const container: AccountContainer = {
      id: genId("acct"),
      name: name.trim(),
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

export function renameContainer(id: string, name: string): Promise<void> {
  return withWriteLock(async () => {
    const all = await readAll();
    const c = all.find((x) => x.id === id);
    if (!c) return;
    c.name = name.trim();
    await writeAll(all);
    notify();
  });
}

/**
 * Add a link to a specific container, OR create a new container in one step
 * if `target.kind === "new"`. Returns the container id so the caller can
 * navigate back to it.
 */
export function addLink(
  target: { kind: "existing"; containerId: string } | { kind: "new"; name: string },
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
      if (!container) throw new Error("Account not found");
    } else {
      container = {
        id: genId("acct"),
        name: target.name.trim(),
        createdAt: new Date().toISOString(),
        links: [],
      };
      all.push(container);
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
