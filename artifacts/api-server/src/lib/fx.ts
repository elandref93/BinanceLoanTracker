import { logger } from "./logger";

// Server-side USD→ZAR rate, fetched once per snapshot run and embedded in the
// consolidated bundle so the mobile app no longer has to call the external
// open.er-api.com endpoint itself (one fewer third-party dependency on the
// device, and a single cached value shared by all readers).
//
// A short in-process cache avoids hammering the upstream when several users are
// recomputed back-to-back within one scheduler tick.

const FX_URL = "https://open.er-api.com/v6/latest/USD";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let cached: { rate: number; at: number } | null = null;

interface ErApiResponse {
  result?: string;
  rates?: Record<string, number>;
}

/**
 * Best-effort USD→ZAR rate. Returns the last cached value on failure, or null
 * when we've never successfully fetched one. Never throws.
 */
export async function fetchUsdToZar(): Promise<number | null> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.rate;
  }
  try {
    const res = await fetch(FX_URL);
    if (!res.ok) throw new Error(`fx HTTP ${res.status}`);
    const body = (await res.json()) as ErApiResponse;
    const rate = body?.rates?.ZAR;
    if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) {
      cached = { rate, at: Date.now() };
      return rate;
    }
    throw new Error("fx response missing ZAR rate");
  } catch (err) {
    logger.warn({ err, op: "fx.fetch" }, "USD→ZAR fetch failed");
    return cached?.rate ?? null;
  }
}
