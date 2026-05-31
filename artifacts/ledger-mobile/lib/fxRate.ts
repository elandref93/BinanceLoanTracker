import AsyncStorage from "@react-native-async-storage/async-storage";

import { setUsdToZar } from "@/utils/format";

// Live USD→ZAR rate, fetched on launch and remembered between sessions so the
// app shows the most recent known rate even when offline. Falls back to the
// last cached value, and finally to the baked-in default in format.ts.
const CACHE_KEY = "ledger.fx.usdZar";
const SOURCE_URL = "https://open.er-api.com/v6/latest/USD";

type CachedRate = { rate: number; ts: number };

function isValidRate(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 && n < 1000;
}

async function loadCachedRate(): Promise<CachedRate | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedRate>;
    if (isValidRate(parsed.rate)) {
      return { rate: parsed.rate, ts: parsed.ts ?? 0 };
    }
  } catch {
    // corrupt cache — ignore and fall through
  }
  return null;
}

async function fetchLiveRate(): Promise<number | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(SOURCE_URL, { signal: controller.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      result?: string;
      rates?: Record<string, unknown>;
    };
    const zar = body.rates?.["ZAR"];
    return isValidRate(zar) ? zar : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Hydrate the USD→ZAR rate. Loads the cached value immediately (so the first
 * paint already uses the last known rate), then fetches a fresh rate in the
 * background and persists it. `onRate` is called for each value applied so the
 * UI can re-render with the latest number.
 */
export async function initFxRate(onRate: (rate: number) => void): Promise<void> {
  const cached = await loadCachedRate();
  if (cached) {
    setUsdToZar(cached.rate);
    onRate(cached.rate);
  }
  const live = await fetchLiveRate();
  if (live !== null) {
    setUsdToZar(live);
    onRate(live);
    try {
      await AsyncStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ rate: live, ts: Date.now() } satisfies CachedRate),
      );
    } catch {
      // best-effort cache; a failed write just means we re-fetch next launch
    }
  }
}
