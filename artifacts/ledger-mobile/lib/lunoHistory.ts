import AsyncStorage from "@react-native-async-storage/async-storage";

// Ring buffer of total Luno portfolio value, sampled whenever the Crypto
// tab successfully reads wallets + tickers. Same shape and cadence rules
// as `ltvHistory.ts` so the two cards on the dashboard feel consistent.
const KEY = "ledger.lunoHistory.v1";
const MAX_SAMPLES = 7 * 24 * 4; // ~7d at 15-min cadence
const MIN_INTERVAL_MS = 60_000; // dedupe samples within 60s

export type LunoSample = {
  /** Epoch ms. */
  t: number;
  /** Total BTC held across all linked Luno accounts. */
  btc: number;
  /**
   * Total portfolio value (all assets) converted to the user's display
   * currency at sample time, via Luno's public tickers. Quoted currency
   * is recorded alongside so we don't mix ZAR and USD samples.
   */
  fiat: number;
  /** Display currency the `fiat` figure is quoted in. */
  currency: string;
};

let cache: LunoSample[] | null = null;

// ── pub/sub so the React hook can re-read after a write lands ──
type Listener = () => void;
const listeners = new Set<Listener>();
export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify(): void {
  for (const fn of listeners) fn();
}

// ── write serialization ──
// AsyncStorage has no compare-and-swap, so two concurrent
// read-modify-write mutations (e.g. two rapid refreshes landing
// simultaneously) can clobber each other and silently drop a sample.
// All mutators funnel through this chain so RMW cycles run in series.
// Reads remain unsynchronized — they're idempotent.
let writeChain: Promise<unknown> = Promise.resolve();
function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  writeChain = next.catch(() => undefined);
  return next;
}

async function read(): Promise<LunoSample[]> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as LunoSample[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

async function write(samples: LunoSample[]): Promise<void> {
  cache = samples;
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(samples));
  } catch {
    // ignore — chart is a non-critical view
  }
}

/**
 * Record the current Luno snapshot. Caller passes the totals already
 * computed; this module owns persistence + sampling cadence only.
 * Skips if a sample landed <60s ago to keep the buffer useful and small.
 */
export function recordLunoSample(s: Omit<LunoSample, "t">): Promise<void> {
  return withWriteLock(async () => {
    if (!Number.isFinite(s.btc) || !Number.isFinite(s.fiat)) return;
    if (s.btc < 0 || s.fiat < 0) return;
    const now = Date.now();
    const samples = await read();
    const last = samples[samples.length - 1];
    if (last && now - last.t < MIN_INTERVAL_MS) return;
    const next = [...samples, { t: now, ...s }].slice(-MAX_SAMPLES);
    await write(next);
    notify();
  });
}

/**
 * Returns samples within the last `hours` window, oldest → newest,
 * filtered to samples whose `currency` matches the caller's current
 * display currency. Switching currency hides historic samples until
 * new ones land in the new currency — preferred over silently quoting
 * a stale FX rate against persisted figures.
 */
export async function getLunoHistory(
  hours: number,
  currency: string,
): Promise<LunoSample[]> {
  const cutoff = Date.now() - hours * 3600 * 1000;
  const samples = await read();
  return samples.filter((s) => s.t >= cutoff && s.currency === currency);
}

export function clearLunoHistory(): Promise<void> {
  return withWriteLock(async () => {
    cache = [];
    try {
      await AsyncStorage.removeItem(KEY);
    } catch {
      // ignore
    }
    notify();
  });
}
