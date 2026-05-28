import AsyncStorage from "@react-native-async-storage/async-storage";

import { clearLoanCache } from "@/lib/loanCache";
import { clearLoanSnapshots } from "@/lib/loanSnapshots";
import { clearLtvHistory } from "@/lib/ltvHistory";
import { clearLunoHistory } from "@/lib/lunoHistory";

/**
 * Wipe all non-sensitive local caches and historical samples:
 *   - cached /loans + /accounts blobs (loanCache)
 *   - per-loan APR/LTV snapshot ring (loanSnapshots)
 *   - dashboard LTV ring (ltvHistory)
 *   - crypto-tab portfolio ring (lunoHistory)
 *
 * Intentionally DOES NOT touch:
 *   - exchange API keys (SecureStore, removed via Settings → Remove
 *     profile / Remove link)
 *   - sign-in session (Settings → Sign out)
 *   - alert rules + alerts-enabled flag
 *   - user preferences (currency, target LTV, Face ID)
 *
 * The app will silently re-fetch fresh data and rebuild history on
 * next refresh — no further action needed by the caller.
 */
export async function clearLocalCache(): Promise<void> {
  // Each clear is independent; run them in parallel and don't let one
  // module's failure block the others.
  await Promise.allSettled([
    clearLoanCache(),
    clearLoanSnapshots(),
    clearLtvHistory(),
    clearLunoHistory(),
  ]);
}

/**
 * Best-effort estimate (in bytes) of how much AsyncStorage we're
 * currently using. Walks every key — fine for our small footprint
 * (a handful of small JSON blobs) but don't call this on a hot path.
 * Returns 0 on any failure rather than throwing — this only feeds a
 * decorative subtitle in Settings.
 */
export async function estimateCacheBytes(): Promise<number> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    if (keys.length === 0) return 0;
    const entries = await AsyncStorage.multiGet(keys);
    let total = 0;
    for (const [k, v] of entries) {
      total += (k?.length ?? 0) + (v?.length ?? 0);
    }
    return total;
  } catch {
    return 0;
  }
}

/** Human-friendly byte size: 0 B / 12 KB / 1.3 MB. */
export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
