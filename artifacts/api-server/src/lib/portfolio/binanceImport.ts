import { BinanceApiError, binancePublicGet, binanceSignedGet, type BinanceCredentials } from "../binance";
import type { SourceCursor } from "./ledgerStore";
import { DAY_MS } from "./time";
import { normaliseAsset, type LedgerEvent } from "./types";

type Row = Record<string, unknown>;

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

/** Binance sometimes sends "2024-03-01 12:00:00" (UTC) instead of epoch ms. */
function time(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    if (/^\d+$/.test(value)) return Number(value);
    const parsed = Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function rows(payload: unknown, ...keys: string[]): Row[] {
  if (Array.isArray(payload)) return payload as Row[];
  if (payload && typeof payload === "object") {
    for (const key of keys) {
      const value = (payload as Row)[key];
      if (Array.isArray(value)) return value as Row[];
    }
  }
  return [];
}

export interface WindowContext {
  creds: BinanceCredentials;
  linkId: string;
  pause: (weightClass?: "light" | "heavy" | "uid" | "uidLight") => Promise<void>;
}

/** A history source fetched in fixed time windows. */
export interface WindowSource {
  name: string;
  windowMs: number;
  /** Nothing exists before this instant for this product. */
  floor: number;
  /**
   * Binance only keeps this much history. Older windows are not requested.
   * Measured back from the time of the call, not from process start.
   */
  retentionMs?: number;
  weight: "light" | "heavy" | "uid" | "uidLight";
  fetch(ctx: WindowContext, start: number, end: number): Promise<LedgerEvent[]>;
}

/** Oldest instant this source can return at `now`. */
export function sourceFloor(source: Pick<WindowSource, "floor" | "retentionMs">, now = Date.now()): number {
  if (source.retentionMs == null) return source.floor;
  return Math.max(source.floor, now - source.retentionMs);
}

const BINANCE_LAUNCH = Date.parse("2017-07-14T00:00:00Z");

function ev(ctx: WindowContext, partial: Omit<LedgerEvent, "exchange" | "linkId">): LedgerEvent {
  return { exchange: "binance", linkId: ctx.linkId, ...partial, asset: normaliseAsset(partial.asset) };
}

async function paged(fetchPage: (page: number) => Promise<Row[]>, pageSize: number, maxPages = 50): Promise<Row[]> {
  const out: Row[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const batch = await fetchPage(page);
    out.push(...batch);
    if (batch.length < pageSize) break;
  }
  return out;
}

export const BINANCE_SOURCES: WindowSource[] = [
  {
    name: "deposits",
    windowMs: 89 * DAY_MS,
    floor: BINANCE_LAUNCH,
    weight: "light",
    async fetch(ctx, start, end) {
      const data = await binanceSignedGet(ctx.creds, "/sapi/v1/capital/deposit/hisrec", { startTime: start, endTime: end, limit: 1000 });
      return rows(data)
        .filter((row) => num(row.status) === 1 || num(row.status) === 6)
        .map((row) =>
          ev(ctx, {
            id: `bn:${ctx.linkId}:dep:${str(row.id) || str(row.txId)}:${str(row.coin)}`,
            t: time(row.insertTime),
            type: "deposit",
            asset: str(row.coin),
            qty: num(row.amount),
            external: true,
            note: "Deposit",
          }),
        );
    },
  },
  {
    name: "withdrawals",
    windowMs: 89 * DAY_MS,
    floor: BINANCE_LAUNCH,
    weight: "light",
    async fetch(ctx, start, end) {
      const data = await binanceSignedGet(ctx.creds, "/sapi/v1/capital/withdraw/history", { startTime: start, endTime: end, limit: 1000 });
      return rows(data)
        .filter((row) => num(row.status) === 6)
        .flatMap((row) => {
          const id = str(row.id);
          const t = time(row.completeTime) || time(row.applyTime);
          const out = [
            ev(ctx, { id: `bn:${ctx.linkId}:wd:${id}`, t, type: "withdrawal", asset: str(row.coin), qty: -num(row.amount), external: true, note: "Withdrawal" }),
          ];
          const fee = num(row.transactionFee);
          if (fee > 0) out.push(ev(ctx, { id: `bn:${ctx.linkId}:wdfee:${id}`, t, type: "fee", asset: str(row.coin), qty: -fee, note: "Withdrawal fee" }));
          return out;
        });
    },
  },
  {
    name: "fiat",
    windowMs: 89 * DAY_MS,
    floor: Date.parse("2019-06-01T00:00:00Z"),
    weight: "uid",
    async fetch(ctx, start, end) {
      const out: LedgerEvent[] = [];
      for (const transactionType of [0, 1]) {
        await ctx.pause("uid");
        const list = await paged(
          async (page) =>
            rows(await binanceSignedGet(ctx.creds, "/sapi/v1/fiat/orders", { transactionType, beginTime: start, endTime: end, page, rows: 500 }), "data"),
          500,
        );
        for (const row of list) {
          if (!/success/i.test(str(row.status))) continue;
          const id = str(row.orderNo);
          const t = time(row.createTime);
          const currency = str(row.fiatCurrency);
          const amount = num(row.amount);
          const fee = num(row.totalFee);
          if (transactionType === 0) {
            out.push(ev(ctx, { id: `bn:${ctx.linkId}:fiatin:${id}`, t, type: "deposit", asset: currency, qty: amount, external: true, note: "Bank deposit" }));
          } else {
            out.push(ev(ctx, { id: `bn:${ctx.linkId}:fiatout:${id}`, t, type: "withdrawal", asset: currency, qty: -amount, external: true, note: "Bank withdrawal" }));
            if (fee > 0) out.push(ev(ctx, { id: `bn:${ctx.linkId}:fiatfee:${id}`, t, type: "fee", asset: currency, qty: -fee, note: "Bank withdrawal fee" }));
          }
        }
      }
      return out;
    },
  },
  {
    name: "card-purchases",
    windowMs: 89 * DAY_MS,
    floor: Date.parse("2019-06-01T00:00:00Z"),
    weight: "light",
    async fetch(ctx, start, end) {
      const out: LedgerEvent[] = [];
      for (const transactionType of [0, 1]) {
        await ctx.pause();
        const list = await paged(
          async (page) =>
            rows(await binanceSignedGet(ctx.creds, "/sapi/v1/fiat/payments", { transactionType, beginTime: start, endTime: end, page, rows: 500 }), "data"),
          500,
        );
        for (const row of list) {
          if (!/complete|success/i.test(str(row.status))) continue;
          const id = str(row.orderNo);
          const t = time(row.createTime);
          const fiat = str(row.fiatCurrency);
          const crypto = str(row.cryptoCurrency);
          const group = `bn:${ctx.linkId}:pay:${id}`;
          if (transactionType === 0) {
            const spent = num(row.sourceAmount);
            out.push(
              ev(ctx, { id: `${group}:in`, t, type: "deposit", asset: fiat, qty: spent, external: true, group, note: "Card purchase" }),
              ev(ctx, { id: `${group}:spend`, t, type: "buy", asset: fiat, qty: -spent, group, note: "Card purchase" }),
              ev(ctx, { id: `${group}:get`, t, type: "buy", asset: crypto, qty: num(row.obtainAmount), group, note: "Card purchase" }),
            );
          } else {
            const received = num(row.obtainAmount);
            out.push(
              ev(ctx, { id: `${group}:sell`, t, type: "sell", asset: crypto, qty: -num(row.sourceAmount), group, note: "Sell to card" }),
              ev(ctx, { id: `${group}:get`, t, type: "sell", asset: fiat, qty: received, group, note: "Sell to card" }),
              ev(ctx, { id: `${group}:out`, t, type: "withdrawal", asset: fiat, qty: -received, external: true, group, note: "Sell to card" }),
            );
          }
        }
      }
      return out;
    },
  },
  {
    name: "convert",
    windowMs: 29 * DAY_MS,
    floor: Date.parse("2020-09-01T00:00:00Z"),
    weight: "uidLight",
    async fetch(ctx, start, end) {
      const data = await binanceSignedGet(ctx.creds, "/sapi/v1/convert/tradeFlow", { startTime: start, endTime: end, limit: 1000 });
      return rows(data, "list")
        .filter((row) => /success/i.test(str(row.orderStatus)))
        .flatMap((row) => {
          const group = `bn:${ctx.linkId}:cv:${str(row.orderId) || str(row.quoteId)}`;
          const t = time(row.createTime);
          return [
            ev(ctx, { id: `${group}:from`, t, type: "convert", asset: str(row.fromAsset), qty: -num(row.fromAmount), group, note: "Convert" }),
            ev(ctx, { id: `${group}:to`, t, type: "convert", asset: str(row.toAsset), qty: num(row.toAmount), group, note: "Convert" }),
          ];
        });
    },
  },
  {
    name: "earn-rewards",
    // Flexible rewards reject ranges over about 30 days with -6021
    // "Query time range too large". 29 days stays under that cap.
    windowMs: 29 * DAY_MS,
    floor: Date.parse("2023-01-01T00:00:00Z"),
    weight: "heavy",
    async fetch(ctx, start, end) {
      const out: LedgerEvent[] = [];
      for (const type of ["REALTIME", "BONUS", "REWARDS"]) {
        await ctx.pause("heavy");
        const list = await paged(
          async (current) =>
            rows(
              await binanceSignedGet(ctx.creds, "/sapi/v1/simple-earn/flexible/history/rewardsRecord", { type, startTime: start, endTime: end, current, size: 100 }),
              "rows",
            ),
          100,
        );
        for (const row of list) {
          const t = time(row.time);
          const asset = str(row.asset);
          out.push(ev(ctx, { id: `bn:${ctx.linkId}:earnf:${type}:${asset}:${t}:${str(row.projectId)}`, t, type: "income", asset, qty: num(row.rewards), note: "Simple Earn reward" }));
        }
      }
      await ctx.pause("heavy");
      const locked = await paged(
        async (current) =>
          rows(await binanceSignedGet(ctx.creds, "/sapi/v1/simple-earn/locked/history/rewardsRecord", { startTime: start, endTime: end, current, size: 100 }), "rows"),
        100,
      );
      for (const row of locked) {
        const t = time(row.time);
        const asset = str(row.asset);
        out.push(ev(ctx, { id: `bn:${ctx.linkId}:earnl:${str(row.positionId)}:${asset}:${t}`, t, type: "income", asset, qty: num(row.amount), note: "Locked Earn reward" }));
      }
      return out;
    },
  },
  {
    name: "distributions",
    windowMs: 179 * DAY_MS,
    floor: BINANCE_LAUNCH,
    weight: "light",
    async fetch(ctx, start, end) {
      const simpleEarnLaunch = Date.parse("2023-03-01T00:00:00Z");
      const data = await binanceSignedGet(ctx.creds, "/sapi/v1/asset/assetDividend", { startTime: start, endTime: end, limit: 500 });
      return rows(data, "rows")
        .filter((row) => {
          const info = str(row.enInfo).toLowerCase();
          const earnLike = /(simple earn|flexible|locked|savings)/.test(info);
          return !(earnLike && time(row.divTime) >= simpleEarnLaunch);
        })
        .map((row) =>
          ev(ctx, {
            id: `bn:${ctx.linkId}:div:${str(row.id) || str(row.tranId)}`,
            t: time(row.divTime),
            type: "income",
            asset: str(row.asset),
            qty: num(row.amount),
            note: str(row.enInfo).slice(0, 80) || "Distribution",
          }),
        );
    },
  },
  {
    name: "dust",
    windowMs: 89 * DAY_MS,
    floor: Date.parse("2019-01-01T00:00:00Z"),
    weight: "light",
    async fetch(ctx, start, end) {
      const data = await binanceSignedGet(ctx.creds, "/sapi/v1/asset/dribblet", { startTime: start, endTime: end });
      const out: LedgerEvent[] = [];
      for (const batch of rows(data, "userAssetDribblets")) {
        const group = `bn:${ctx.linkId}:dust:${str(batch.transId)}`;
        const t = time(batch.operateTime);
        out.push(ev(ctx, { id: `${group}:bnb`, t, type: "convert", asset: "BNB", qty: num(batch.totalTransferedAmount), group, note: "Dust to BNB" }));
        for (const detail of rows(batch.userAssetDribbletDetails)) {
          out.push(ev(ctx, { id: `${group}:${str(detail.fromAsset)}`, t, type: "convert", asset: str(detail.fromAsset), qty: -num(detail.amount), group, note: "Dust to BNB" }));
        }
      }
      return out;
    },
  },
  {
    name: "flexible-loans",
    windowMs: 89 * DAY_MS,
    floor: Date.parse("2022-06-01T00:00:00Z"),
    weight: "heavy",
    async fetch(ctx, start, end) {
      const out: LedgerEvent[] = [];
      const borrows = await paged(
        async (current) =>
          rows(await binanceSignedGet(ctx.creds, "/sapi/v2/loan/flexible/borrow/history", { startTime: start, endTime: end, current, limit: 100 }), "rows"),
        100,
      );
      for (const row of borrows) {
        if (/fail/i.test(str(row.status))) continue;
        const t = time(row.borrowTime);
        const asset = str(row.loanCoin);
        const amount = num(row.initialLoanAmount);
        const group = `bn:${ctx.linkId}:flb:${asset}:${str(row.collateralCoin)}:${t}`;
        out.push(
          ev(ctx, { id: `${group}:debt`, t, type: "borrow", asset, qty: amount, debt: true, group, note: "Flexible loan borrowed" }),
          ev(ctx, { id: `${group}:coins`, t, type: "borrow", asset, qty: amount, group, note: "Flexible loan borrowed" }),
        );
      }
      await ctx.pause("heavy");
      const repays = await paged(
        async (current) =>
          rows(await binanceSignedGet(ctx.creds, "/sapi/v2/loan/flexible/repay/history", { startTime: start, endTime: end, current, limit: 100 }), "rows"),
        100,
      );
      for (const row of repays) {
        if (/fail/i.test(str(row.repayStatus))) continue;
        const t = time(row.repayTime);
        const asset = str(row.loanCoin);
        const amount = num(row.repayAmount);
        const group = `bn:${ctx.linkId}:flr:${asset}:${str(row.collateralCoin)}:${t}`;
        out.push(
          ev(ctx, { id: `${group}:debt`, t, type: "repay", asset, qty: -amount, debt: true, group, note: "Flexible loan repaid" }),
          ev(ctx, { id: `${group}:coins`, t, type: "repay", asset, qty: -amount, group, note: "Flexible loan repaid" }),
        );
      }
      return out;
    },
  },
  {
    name: "margin-loans",
    windowMs: 29 * DAY_MS,
    floor: Date.parse("2019-07-01T00:00:00Z"),
    weight: "light",
    async fetch(ctx, start, end) {
      const out: LedgerEvent[] = [];
      for (const type of ["BORROW", "REPAY"] as const) {
        await ctx.pause();
        const list = await paged(
          async (current) =>
            rows(await binanceSignedGet(ctx.creds, "/sapi/v1/margin/borrow-repay", { type, startTime: start, endTime: end, current, size: 100 }), "rows"),
          100,
        );
        for (const row of list) {
          if (str(row.status) && !/confirmed/i.test(str(row.status))) continue;
          const t = time(row.timestamp);
          const asset = str(row.asset);
          const amount = type === "BORROW" ? num(row.principal) || num(row.amount) : num(row.amount) || num(row.principal) + num(row.interest);
          const sign = type === "BORROW" ? 1 : -1;
          const group = `bn:${ctx.linkId}:mg:${type}:${str(row.txId) || `${asset}:${t}`}`;
          out.push(
            ev(ctx, { id: `${group}:debt`, t, type: type === "BORROW" ? "borrow" : "repay", asset, qty: sign * amount, debt: true, group, note: `Margin ${type.toLowerCase()}` }),
            ev(ctx, { id: `${group}:coins`, t, type: type === "BORROW" ? "borrow" : "repay", asset, qty: sign * amount, group, note: `Margin ${type.toLowerCase()}` }),
          );
        }
      }
      await ctx.pause();
      const interest = await paged(
        async (current) =>
          rows(await binanceSignedGet(ctx.creds, "/sapi/v1/margin/interestHistory", { startTime: start, endTime: end, current, size: 100 }), "rows"),
        100,
      );
      for (const row of interest) {
        const t = time(row.interestAccuredTime);
        const asset = str(row.asset);
        out.push(ev(ctx, { id: `bn:${ctx.linkId}:mgi:${asset}:${t}:${str(row.isolatedSymbol)}`, t, type: "interest", asset, qty: num(row.interest), debt: true, note: "Margin interest" }));
      }
      return out;
    },
  },
  {
    name: "pay",
    windowMs: 89 * DAY_MS,
    floor: Date.parse("2021-01-01T00:00:00Z"),
    // Older than this returns 403004 "The request has an invalid parameter".
    retentionMs: 18 * 30 * DAY_MS,
    weight: "uidLight",
    async fetch(ctx, start, end) {
      const data = await binanceSignedGet(ctx.creds, "/sapi/v1/pay/transactions", { startTime: start, endTime: end, limit: 100 });
      return rows(data, "data").map((row) => {
        const amount = num(row.amount);
        return ev(ctx, {
          id: `bn:${ctx.linkId}:pay:${str(row.transactionId)}`,
          t: time(row.transactionTime),
          type: amount >= 0 ? "deposit" : "withdrawal",
          asset: str(row.currency),
          qty: amount,
          external: true,
          note: "Binance Pay",
        });
      });
    },
  },
];

/** Errors that mean "this key cannot use this product", not "try again later". */
export function isPermanentBinanceError(err: unknown): boolean {
  if (!(err instanceof BinanceApiError)) return false;
  if (err.status === 401 || err.status === 403) return true;
  // -3003 Margin account does not exist.
  return err.code === -2015 || err.code === -2014 || err.code === -1002 || err.code === -3045 || err.code === -1121 || err.code === -3003;
}

/**
 * Pay history older than Binance still serves. A recent window that fails
 * this way is a real parameter error; only treat it as the end of history
 * after at least one window has been saved.
 */
export function isBeyondRetentionError(err: unknown): boolean {
  return err instanceof BinanceApiError && err.code === 403004;
}

/** Applies a failed window without discarding history already covered. */
export function settleSourceError(latest: SourceCursor, err: unknown, error: string, now = Date.now()): SourceCursor {
  const permanent = isPermanentBinanceError(err);
  const beyond = isBeyondRetentionError(err) && latest.coveredFrom != null;
  return {
    ...latest,
    state: permanent ? "unavailable" : beyond ? "complete" : "error",
    error: beyond ? null : error,
    backfillDone: Boolean(permanent || beyond || latest.backfillDone),
    updatedAt: now,
  };
}

export function isRateLimitError(err: unknown): boolean {
  return err instanceof BinanceApiError && (err.status === 429 || err.status === 418);
}

let symbolCache: { at: number; symbols: Map<string, { base: string; quote: string }> } | null = null;

async function spotSymbols(): Promise<Map<string, { base: string; quote: string }>> {
  if (symbolCache && Date.now() - symbolCache.at < DAY_MS) return symbolCache.symbols;
  const info = await binancePublicGet<{ symbols?: Array<{ symbol: string; baseAsset: string; quoteAsset: string }> }>("/api/v3/exchangeInfo", {
    permissions: "SPOT",
  });
  const symbols = new Map<string, { base: string; quote: string }>();
  for (const item of info.symbols ?? []) symbols.set(item.symbol, { base: item.baseAsset, quote: item.quoteAsset });
  symbolCache = { at: Date.now(), symbols };
  return symbols;
}

const COMMON_QUOTES = new Set(["USDT", "USDC", "FDUSD", "BUSD", "TUSD", "BTC", "ETH", "BNB", "ZAR", "EUR", "GBP"]);
const MAX_SYMBOLS = 150;

/** Spot pairs worth asking about: both sides seen in this account, or one side a common quote. */
export async function candidateSymbols(assets: Set<string>): Promise<Array<{ symbol: string; base: string; quote: string }>> {
  const all = await spotSymbols();
  const out: Array<{ symbol: string; base: string; quote: string }> = [];
  for (const [symbol, pair] of all) {
    const baseSeen = assets.has(pair.base);
    const quoteSeen = assets.has(pair.quote);
    if ((baseSeen && (quoteSeen || COMMON_QUOTES.has(pair.quote))) || (quoteSeen && COMMON_QUOTES.has(pair.base) && assets.has(pair.base))) {
      out.push({ symbol, ...pair });
    }
  }
  out.sort((a, b) => Number(COMMON_QUOTES.has(b.quote)) - Number(COMMON_QUOTES.has(a.quote)));
  return out.slice(0, MAX_SYMBOLS);
}

/** All spot trades for one symbol after `fromId`, oldest first. */
export async function fetchTrades(
  ctx: WindowContext,
  pair: { symbol: string; base: string; quote: string },
  fromId: number,
  deadline: number,
): Promise<{ events: LedgerEvent[]; nextId: number; done: boolean }> {
  const events: LedgerEvent[] = [];
  let next = fromId;
  for (;;) {
    if (Date.now() > deadline) return { events, nextId: next, done: false };
    await ctx.pause("heavy");
    const batch = rows(await binanceSignedGet(ctx.creds, "/api/v3/myTrades", { symbol: pair.symbol, fromId: next, limit: 1000 }));
    for (const row of batch) {
      const id = num(row.id);
      const t = time(row.time);
      const buyer = row.isBuyer === true;
      const group = `bn:${ctx.linkId}:tr:${pair.symbol}:${id}`;
      const qty = num(row.qty);
      const quoteQty = num(row.quoteQty) || qty * num(row.price);
      const type = buyer ? "buy" : "sell";
      events.push(
        ev(ctx, { id: `${group}:b`, t, type, asset: pair.base, qty: buyer ? qty : -qty, group, note: `${type === "buy" ? "Bought" : "Sold"} on ${pair.symbol}` }),
        ev(ctx, { id: `${group}:q`, t, type, asset: pair.quote, qty: buyer ? -quoteQty : quoteQty, group, note: `${type === "buy" ? "Bought" : "Sold"} on ${pair.symbol}` }),
      );
      const commission = num(row.commission);
      if (commission > 0) {
        events.push(ev(ctx, { id: `${group}:f`, t, type: "fee", asset: str(row.commissionAsset), qty: -commission, group, note: "Trading fee" }));
      }
      next = Math.max(next, id + 1);
    }
    if (batch.length < 1000) return { events, nextId: next, done: true };
  }
}

/** Seeds the per-source cursor for a link. */
export function newCursor(key: string, linkId: string, linkName: string, source: string): SourceCursor {
  return {
    key,
    exchange: "binance",
    linkId,
    linkName,
    source,
    state: "pending",
    rows: 0,
    coveredFrom: null,
    coveredTo: null,
    backfillDone: false,
    error: null,
    updatedAt: Date.now(),
  };
}
