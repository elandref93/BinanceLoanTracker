import AsyncStorage from "@react-native-async-storage/async-storage";

import type { Account, Loan } from "@workspace/api-client-react";

const LOANS_KEY = "ledger.cache.loans.v1";
const ACCOUNTS_KEY = "ledger.cache.accounts.v1";

export interface CachedLoans {
  loans: Loan[];
  cachedAt: string;
}

export interface CachedAccounts {
  accounts: Account[];
  cachedAt: string;
}

export async function writeLoanCache(loans: Loan[]): Promise<void> {
  try {
    const body: CachedLoans = { loans, cachedAt: new Date().toISOString() };
    await AsyncStorage.setItem(LOANS_KEY, JSON.stringify(body));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[loanCache] failed to write loans cache", err);
  }
}

export async function readLoanCache(): Promise<CachedLoans | null> {
  try {
    const raw = await AsyncStorage.getItem(LOANS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray((parsed as CachedLoans).loans) ||
      typeof (parsed as CachedLoans).cachedAt !== "string"
    ) {
      return null;
    }
    return parsed as CachedLoans;
  } catch {
    return null;
  }
}

export async function writeAccountsCache(accounts: Account[]): Promise<void> {
  try {
    const body: CachedAccounts = {
      accounts,
      cachedAt: new Date().toISOString(),
    };
    await AsyncStorage.setItem(ACCOUNTS_KEY, JSON.stringify(body));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[loanCache] failed to write accounts cache", err);
  }
}

export async function readAccountsCache(): Promise<CachedAccounts | null> {
  try {
    const raw = await AsyncStorage.getItem(ACCOUNTS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray((parsed as CachedAccounts).accounts) ||
      typeof (parsed as CachedAccounts).cachedAt !== "string"
    ) {
      return null;
    }
    return parsed as CachedAccounts;
  } catch {
    return null;
  }
}

/** Compact "cached 2m ago" / "cached 3h ago" label for stale banners. */
export function cacheAgeLabel(cachedAt: string): string {
  const ms = Date.now() - new Date(cachedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "cached just now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return "cached just now";
  if (s < 3600) return `cached ${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `cached ${Math.floor(s / 3600)}h ago`;
  return `cached ${Math.floor(s / 86400)}d ago`;
}
