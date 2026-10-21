import { binancePublicGet } from "../binance";
import { logger } from "../logger";
import { lunoFetch, type LunoCredentials } from "../luno";
import { readShared, writeShared } from "./sealedStore";
import { addDays, DAY_MS, HOUR_MS, jhbDay } from "./time";
import { STABLECOINS } from "./types";

/**
 * Shared cache of public market data: daily closes per asset (USD), hourly
 * closes for the last 7 days, and a daily USD→ZAR rate. Nothing personal is
 * stored here. Binance daily candles close at 00:00 UTC (02:00 in
 * Johannesburg), which is the close used for that Johannesburg day.
 */
const CACHE_FILE = "market-prices.json";
const QUOTES = ["USDT", "USDC", "FDUSD"] as const;
const KLINE_LIMIT = 1000;
const EARLIEST_DAY = "2017-07-14";
const UNSUPPORTED_RETRY_MS = 7 * DAY_MS;

interface PriceCache {
  v: 1;
  daily: Record<string, Record<string, number>>;
  hourly: Record<string, Array<[number, number]>>;
  fx: Record<string, number>;
  fxSource: Record<string, "luno" | "binance" | "reference">;
  /** Assets with no USD market on Binance, and when that was last checked. */
  unsupported: Record<string, number>;
  hourlyUpdatedAt: Record<string, number>;
}

let cache: PriceCache | null = null;
let chain: Promise<unknown> = Promise.resolve();

function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

async function load(): Promise<PriceCache> {
  if (cache) return cache;
  const stored = await readShared<PriceCache>(CACHE_FILE);
  cache =
    stored && stored.v === 1
      ? { ...stored, hourlyUpdatedAt: stored.hourlyUpdatedAt ?? {}, unsupported: stored.unsupported ?? {} }
      : { v: 1, daily: {}, hourly: {}, fx: {}, fxSource: {}, unsupported: {}, hourlyUpdatedAt: {} };
  return cache;
}

async function persist(): Promise<void> {
  if (cache) await writeShared(CACHE_FILE, cache);
}

type Kline = [number, string, string, string, string, ...unknown[]];

async function klines(symbol: string, interval: "1d" | "1h", startTime: number): Promise<Array<[number, number]>> {
  const raw = await binancePublicGet<unknown>("/api/v3/klines", { symbol, interval, startTime, limit: KLINE_LIMIT });
  if (!Array.isArray(raw)) return [];
  return (raw as Kline[])
    .map((row) => [Number(row[0]), Number(row[4])] as [number, number])
    .filter(([t, close]) => Number.isFinite(t) && Number.isFinite(close) && close > 0);
}

async function pagedKlines(symbol: string, interval: "1d" | "1h", startTime: number): Promise<Array<[number, number]>> {
  const step = interval === "1d" ? DAY_MS : HOUR_MS;
  const out: Array<[number, number]> = [];
  let cursor = startTime;
  for (let page = 0; page < 20; page++) {
    const rows = await klines(symbol, interval, cursor);
    out.push(...rows);
    if (rows.length < KLINE_LIMIT) break;
    const last = rows[rows.length - 1];
    if (!last) break;
    cursor = last[0] + step;
  }
  return out;
}

/** Candle open time → the Johannesburg day whose close it represents. */
function dayOfDailyCandle(openTime: number): string {
  return new Date(openTime).toISOString().slice(0, 10);
}

async function fetchDailyUsd(asset: string, fromMs: number): Promise<Record<string, number> | null> {
  for (const quote of QUOTES) {
    try {
      const rows = await pagedKlines(`${asset}${quote}`, "1d", fromMs);
      if (rows.length === 0) continue;
      return Object.fromEntries(rows.map(([t, close]) => [dayOfDailyCandle(t), close]));
    } catch {
      // Invalid symbol for this quote; try the next one.
    }
  }
  try {
    const [inBtc, btc] = await Promise.all([pagedKlines(`${asset}BTC`, "1d", fromMs), ensureAssetDaily("BTC", fromMs)]);
    if (inBtc.length === 0) return null;
    const out: Record<string, number> = {};
    for (const [t, close] of inBtc) {
      const day = dayOfDailyCandle(t);
      const btcUsd = btc?.[day];
      if (btcUsd) out[day] = close * btcUsd;
    }
    return out;
  } catch {
    return null;
  }
}

async function ensureAssetDaily(asset: string, fromMs: number): Promise<Record<string, number> | null> {
  const store = await load();
  const existing = store.daily[asset] ?? {};
  const days = Object.keys(existing).sort();
  const today = new Date().toISOString().slice(0, 10);
  const firstWanted = new Date(Math.max(fromMs, Date.parse(`${EARLIEST_DAY}T00:00:00Z`))).toISOString().slice(0, 10);
  const needsHead = days.length === 0 || (days[0] as string) > firstWanted;
  const needsTail = days.length === 0 || (days[days.length - 1] as string) < addDays(today, -1);
  if (!needsHead && !needsTail) return existing;
  const start = needsHead ? Date.parse(`${firstWanted}T00:00:00Z`) : Date.parse(`${days[days.length - 1]}T00:00:00Z`);
  const fetched = await fetchDailyUsd(asset, start);
  if (!fetched) return days.length > 0 ? existing : null;
  store.daily[asset] = { ...existing, ...fetched };
  return store.daily[asset] ?? null;
}

/** Makes sure daily closes exist for these assets from `fromMs` to yesterday. */
export function ensureDailyPrices(assets: Iterable<string>, fromMs: number): Promise<void> {
  return serial(async () => {
    const store = await load();
    let changed = false;
    for (const asset of new Set(assets)) {
      if (STABLECOINS.has(asset) || asset === "ZAR" || asset === "USD") continue;
      const unsupportedAt = store.unsupported[asset];
      if (unsupportedAt && Date.now() - unsupportedAt < UNSUPPORTED_RETRY_MS) continue;
      const before = store.daily[asset];
      const result = await ensureAssetDaily(asset, fromMs).catch((err) => {
        logger.warn({ err, op: "prices.daily", asset }, "daily price fetch failed");
        return before ?? null;
      });
      if (!result) {
        store.unsupported[asset] = Date.now();
        changed = true;
      } else if (result !== before) {
        delete store.unsupported[asset];
        changed = true;
      }
    }
    if (changed) await persist();
  });
}

/** Hourly closes for the last 7 days, refreshed at most every 30 minutes. */
export function ensureHourlyPrices(assets: Iterable<string>): Promise<void> {
  return serial(async () => {
    const store = await load();
    let changed = false;
    const since = Date.now() - 7 * DAY_MS;
    for (const asset of new Set(assets)) {
      if (STABLECOINS.has(asset) || asset === "ZAR" || asset === "USD") continue;
      if (store.unsupported[asset]) continue;
      if (Date.now() - (store.hourlyUpdatedAt[asset] ?? 0) < 30 * 60 * 1000) continue;
      for (const quote of QUOTES) {
        try {
          const rows = await pagedKlines(`${asset}${quote}`, "1h", since);
          if (rows.length === 0) continue;
          store.hourly[asset] = rows;
          store.hourlyUpdatedAt[asset] = Date.now();
          changed = true;
          break;
        } catch {
          // Try the next quote.
        }
      }
    }
    if (changed) await persist();
  });
}

/**
 * Daily USD→ZAR. Tries Luno USDC/ZAR daily candles (needs a Luno key), then
 * Binance USDT/ZAR, then fills any gap with the current reference rate so
 * the series is continuous. Gaps filled that way are marked "reference".
 */
export function ensureFxHistory(fromMs: number, lunoCreds: LunoCredentials | null, currentRate: number | null): Promise<void> {
  return serial(async () => {
    const store = await load();
    const today = jhbDay(Date.now());
    const firstWanted = jhbDay(Math.max(fromMs, Date.parse(`${EARLIEST_DAY}T00:00:00Z`)));
    const known = Object.keys(store.fx).filter((day) => store.fxSource[day] !== "reference").sort();
    const start = known.length > 0 && (known[0] as string) <= firstWanted ? (known[known.length - 1] as string) : firstWanted;
    let changed = false;
    if (start < today) {
      if (lunoCreds) {
        try {
          let since = Date.parse(`${start}T00:00:00Z`);
          for (let page = 0; page < 10 && since < Date.now(); page++) {
            const res = await lunoFetch<{ candles?: Array<{ timestamp: number; close: string }> }>(
              `/api/exchange/1/candles?pair=USDCZAR&since=${since}&duration=86400`,
              lunoCreds,
            );
            const candles = res.candles ?? [];
            for (const candle of candles) {
              const rate = Number(candle.close);
              if (!(rate > 0)) continue;
              const day = new Date(candle.timestamp).toISOString().slice(0, 10);
              store.fx[day] = rate;
              store.fxSource[day] = "luno";
              changed = true;
            }
            const last = candles[candles.length - 1];
            if (!last || candles.length < 900) break;
            since = last.timestamp + DAY_MS;
          }
        } catch (err) {
          logger.warn({ err, op: "prices.fx.luno" }, "Luno FX candles unavailable");
        }
      }
      try {
        const rows = await pagedKlines("USDTZAR", "1d", Date.parse(`${start}T00:00:00Z`));
        for (const [t, close] of rows) {
          const day = dayOfDailyCandle(t);
          if (store.fxSource[day] === "luno") continue;
          store.fx[day] = close;
          store.fxSource[day] = "binance";
          changed = true;
        }
      } catch {
        // No USDT/ZAR market; the Luno series or the reference rate covers it.
      }
    }
    if (currentRate && currentRate > 0) {
      for (let day = firstWanted; day <= today; day = addDays(day, 1)) {
        if (store.fx[day] == null) {
          store.fx[day] = currentRate;
          store.fxSource[day] = "reference";
          changed = true;
        }
      }
    }
    if (changed) await persist();
  });
}

function nearest(series: Record<string, number> | undefined, day: string): number | null {
  if (!series) return null;
  const exact = series[day];
  if (exact != null) return exact;
  for (let offset = 1; offset <= 10; offset++) {
    const before = series[addDays(day, -offset)];
    if (before != null) return before;
  }
  for (let offset = 1; offset <= 10; offset++) {
    const after = series[addDays(day, offset)];
    if (after != null) return after;
  }
  return null;
}

export interface PriceBook {
  /** USD close for an asset on a Johannesburg day; 0 when unknown. */
  close(asset: string, day: string): number;
  fx(day: string): number | null;
  fxIsReference(day: string): boolean;
  hourly(asset: string): Array<[number, number]>;
  daily(asset: string): Record<string, number>;
}

/** A read-only view of the cache, with today's live prices layered on top. */
export async function priceBook(live: { prices: Record<string, number>; fx: number | null }): Promise<PriceBook> {
  const store = await serial(load);
  const today = jhbDay(Date.now());
  return {
    close(asset, day) {
      if (STABLECOINS.has(asset) || asset === "USD") return 1;
      if (asset === "ZAR") {
        const rate = day >= today ? live.fx : nearest(store.fx, day) ?? live.fx;
        return rate && rate > 0 ? 1 / rate : 0;
      }
      if (day >= today && live.prices[asset]) return live.prices[asset] as number;
      return nearest(store.daily[asset], day) ?? live.prices[asset] ?? 0;
    },
    fx(day) {
      if (day >= today && live.fx) return live.fx;
      return nearest(store.fx, day) ?? live.fx;
    },
    fxIsReference(day) {
      return store.fxSource[day] === "reference";
    },
    hourly(asset) {
      return store.hourly[asset] ?? [];
    },
    daily(asset) {
      return store.daily[asset] ?? {};
    },
  };
}
