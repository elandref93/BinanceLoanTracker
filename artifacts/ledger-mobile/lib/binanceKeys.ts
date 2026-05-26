import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";

const STORAGE_KEY = "ledger.binance.accounts.v1";

// ─────────────────────────────────────────────────────────────────────────────
// Tiny synchronous subscriber list so anything that mutates accounts (add /
// remove) can notify React components instantly. We avoid relying solely on
// navigator focus events because removing the last account from a deep screen
// would not necessarily re-focus the parent gate.
// ─────────────────────────────────────────────────────────────────────────────
const listeners = new Set<() => void>();
function notifyAccountsChanged(): void {
  for (const fn of listeners) fn();
}
function subscribeAccountsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export type BinanceAccount = {
  id: string;
  name: string;
  apiKey: string;
  apiSecret: string;
  createdAt: string;
};

export type StoredBinanceAccount = Omit<BinanceAccount, "apiSecret"> & {
  apiKeyMasked: string;
};

async function readAll(): Promise<BinanceAccount[]> {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BinanceAccount[]) : [];
  } catch {
    return [];
  }
}

async function writeAll(accounts: BinanceAccount[]): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(accounts));
}

function maskKey(key: string): string {
  if (key.length <= 8) return "•".repeat(key.length);
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

/** All accounts including secrets — only call from local-trust paths (auth headers, etc.). */
export async function listAccountsWithSecrets(): Promise<BinanceAccount[]> {
  return readAll();
}

export async function listAccounts(): Promise<StoredBinanceAccount[]> {
  const accounts = await readAll();
  return accounts.map(({ apiSecret: _s, apiKey, ...rest }) => ({
    ...rest,
    apiKey,
    apiKeyMasked: maskKey(apiKey),
  }));
}

export async function addAccount(input: {
  name: string;
  apiKey: string;
  apiSecret: string;
}): Promise<BinanceAccount> {
  const accounts = await readAll();
  const account: BinanceAccount = {
    id: `acct_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: input.name.trim(),
    apiKey: input.apiKey.trim(),
    apiSecret: input.apiSecret.trim(),
    createdAt: new Date().toISOString(),
  };
  accounts.push(account);
  await writeAll(accounts);
  notifyAccountsChanged();
  return account;
}

export async function removeAccount(id: string): Promise<void> {
  const accounts = await readAll();
  await writeAll(accounts.filter((a) => a.id !== id));
  notifyAccountsChanged();
}

/**
 * React hook that returns the current count of locally-stored Binance
 * accounts. Returns `null` until the first read completes. Updates reactively
 * whenever `addAccount` or `removeAccount` is called from anywhere in the app.
 */
export function useStoredAccountsCount(): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      readAll().then((a) => {
        if (!cancelled) setCount(a.length);
      });
    };
    refresh();
    const unsubscribe = subscribeAccountsChanged(refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
  return count;
}

export function validateBinanceKey(apiKey: string): string | null {
  const trimmed = apiKey.trim();
  if (!trimmed) return "API key is required";
  if (trimmed.length < 16) return "API key looks too short";
  if (!/^[A-Za-z0-9]+$/.test(trimmed))
    return "API key must be letters and numbers only";
  return null;
}

export function validateBinanceSecret(apiSecret: string): string | null {
  const trimmed = apiSecret.trim();
  if (!trimmed) return "API secret is required";
  if (trimmed.length < 16) return "API secret looks too short";
  if (!/^[A-Za-z0-9]+$/.test(trimmed))
    return "API secret must be letters and numbers only";
  return null;
}
