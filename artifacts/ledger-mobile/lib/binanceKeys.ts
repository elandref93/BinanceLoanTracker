import * as SecureStore from "expo-secure-store";

const STORAGE_KEY = "ledger.binance.accounts.v1";

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
  return account;
}

export async function removeAccount(id: string): Promise<void> {
  const accounts = await readAll();
  await writeAll(accounts.filter((a) => a.id !== id));
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
