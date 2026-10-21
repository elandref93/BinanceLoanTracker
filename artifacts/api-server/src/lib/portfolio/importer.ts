import type { PlainAccount } from "../credentialStore";
import { logger } from "../logger";
import { BINANCE_SOURCES, candidateSymbols, fetchTrades, isRateLimitError, newCursor, settleSourceError, sourceFloor, type WindowContext } from "./binanceImport";
import { readLedger, updateLedger, type LedgerFile, type SourceCursor } from "./ledgerStore";
import { importLunoLink } from "./lunoImport";
import { readPortfolio } from "./portfolioStore";
import { ensureDailyPrices, ensureFxHistory, ensureHourlyPrices } from "./prices";
import { DAY_MS } from "./time";
import type { LedgerEvent } from "./types";

const RUN_BUDGET_MS = 4 * 60 * 1000;
const FOLLOW_UP_DELAY_MS = 30 * 1000;
const INCREMENTAL_EVERY_MS = 15 * 60 * 1000;
const RATE_LIMIT_PAUSE_MS = 2 * 60 * 1000;

const running = new Map<string, Promise<void>>();
const pausedUntil = new Map<string, number>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Spacing between calls by Binance weight: SAPI UID weight is capped at
 * 180 000 a minute, so fiat orders (90 000 each) need 30s+ and convert or
 * Pay history (3 000 each) need just over a second.
 */
const PAUSE_MS = { light: 250, heavy: 600, uidLight: 1_100, uid: 31_000 } as const;

function pauser(): (weight?: keyof typeof PAUSE_MS) => Promise<void> {
  return (weight = "light") => sleep(PAUSE_MS[weight]);
}

function errorText(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/[A-Za-z0-9]{32,}/g, "…").slice(0, 160);
}

function cursorKey(exchange: string, linkId: string, source: string): string {
  return `${exchange}:${linkId}:${source}`;
}

/**
 * One window-source step: backfill walks from the oldest covered instant
 * back to the product's floor; once done, incremental sync walks forward
 * from the newest covered instant to now.
 */
async function stepWindowSource(
  hash: string,
  ctx: WindowContext,
  source: (typeof BINANCE_SOURCES)[number],
  cursor: SourceCursor,
  deadline: number,
  maxWindows = Number.POSITIVE_INFINITY,
): Promise<SourceCursor> {
  let current: SourceCursor = { ...cursor, state: "running" };
  let windows = 0;
  const floor = sourceFloor(source);
  while (Date.now() < deadline && windows < maxWindows) {
    const now = Date.now();
    let start: number;
    let end: number;
    if (!current.backfillDone) {
      end = current.coveredFrom ?? now;
      if (end <= floor) {
        current = { ...current, backfillDone: true };
        continue;
      }
      start = Math.max(floor, end - source.windowMs);
    } else {
      start = current.coveredTo ?? now - source.windowMs;
      if (now - start < INCREMENTAL_EVERY_MS) break;
      end = Math.min(now, start + source.windowMs);
    }
    await ctx.pause(source.weight);
    const events = await source.fetch(ctx, start, end);
    windows += 1;
    current = {
      ...current,
      rows: current.rows + events.length,
      coveredFrom: Math.min(current.coveredFrom ?? end, start),
      coveredTo: Math.max(current.coveredTo ?? start, end),
      updatedAt: Date.now(),
      error: null,
    };
    const snapshot = current;
    await updateLedger(hash, () => ({ events, cursors: [snapshot] }));
    if (current.backfillDone && end >= now) break;
  }
  return { ...current, state: current.backfillDone ? "complete" : "running" };
}

async function importBinanceLink(hash: string, account: PlainAccount, ledger: LedgerFile, deadline: number): Promise<void> {
  const ctx: WindowContext = { creds: { apiKey: account.apiKey, apiSecret: account.apiSecret }, linkId: account.id, pause: pauser() };
  const local = new Map<string, SourceCursor>();
  const failedThisRun = new Set<string>();
  const cursorFor = (sourceName: string): SourceCursor => {
    const key = cursorKey("binance", account.id, sourceName);
    return local.get(key) ?? ledger.cursors[key] ?? newCursor(key, account.id, account.name, sourceName);
  };
  // One window per source per pass so a long backfill cannot block the others.
  while (Date.now() < deadline) {
    let moved = false;
    for (const source of BINANCE_SOURCES) {
      if (Date.now() > deadline) break;
      if (failedThisRun.has(source.name)) continue;
      const cursor = cursorFor(source.name);
      if (cursor.state === "unavailable") continue;
      if (cursor.backfillDone && Date.now() - (cursor.coveredTo ?? 0) < INCREMENTAL_EVERY_MS) continue;
      try {
        const next = await stepWindowSource(hash, ctx, source, cursor, deadline, 1);
        local.set(cursor.key, next);
        await updateLedger(hash, () => ({ cursors: [next] }));
        if (next.coveredFrom !== cursor.coveredFrom || next.coveredTo !== cursor.coveredTo || next.backfillDone !== cursor.backfillDone) moved = true;
      } catch (err) {
        const latest = (await readLedger(hash))?.cursors[cursor.key] ?? cursor;
        if (isRateLimitError(err)) {
          pausedUntil.set(hash, Date.now() + RATE_LIMIT_PAUSE_MS);
          await updateLedger(hash, () => ({ cursors: [{ ...latest, state: "partial", error: "Rate limited; will resume", updatedAt: Date.now() }] }));
          return;
        }
        failedThisRun.add(source.name);
        const next = settleSourceError(latest, err, errorText(err));
        local.set(cursor.key, next);
        await updateLedger(hash, () => ({ cursors: [next] }));
        logger.warn({ op: "ledger.binance", source: source.name, permanent: next.state === "unavailable", detail: errorText(err) }, "binance history source failed");
      }
    }
    if (!moved) break;
  }

  const tradesKey = cursorKey("binance", account.id, "spot-trades");
  const tradesCursor = ledger.cursors[tradesKey] ?? newCursor(tradesKey, account.id, account.name, "spot-trades");
  if (tradesCursor.state === "unavailable" || Date.now() > deadline) return;
  if (tradesCursor.backfillDone && Date.now() - (tradesCursor.coveredTo ?? 0) < INCREMENTAL_EVERY_MS) return;
  try {
    const latest = (await readLedger(hash)) ?? ledger;
    const portfolio = await readPortfolio(hash);
    const assets = new Set<string>();
    for (const event of latest.events) if (event.linkId === account.id) assets.add(event.asset);
    for (const position of portfolio?.latest?.positions ?? []) if (position.linkId === account.id) assets.add(position.asset);
    const pairs = await candidateSymbols(assets);
    const extra = { ...(tradesCursor.extra ?? {}) };
    let rows = tradesCursor.rows;
    let complete = true;
    let oldest = tradesCursor.coveredFrom;
    for (const pair of pairs) {
      if (Date.now() > deadline) {
        complete = false;
        break;
      }
      const result = await fetchTrades(ctx, pair, extra[pair.symbol] ?? 0, deadline);
      extra[pair.symbol] = result.nextId;
      rows += result.events.length;
      for (const event of result.events) if (oldest == null || event.t < oldest) oldest = event.t;
      if (!result.done) complete = false;
      if (result.events.length > 0) await updateLedger(hash, () => ({ events: result.events }));
    }
    const next: SourceCursor = {
      ...tradesCursor,
      extra,
      rows,
      coveredFrom: oldest,
      coveredTo: complete ? Date.now() : tradesCursor.coveredTo,
      backfillDone: tradesCursor.backfillDone || complete,
      state: complete ? "complete" : "running",
      error: null,
      updatedAt: Date.now(),
    };
    await updateLedger(hash, () => ({ cursors: [next] }));
  } catch (err) {
    if (isRateLimitError(err)) pausedUntil.set(hash, Date.now() + RATE_LIMIT_PAUSE_MS);
    await updateLedger(hash, () => ({ cursors: [{ ...tradesCursor, state: "error", error: errorText(err), updatedAt: Date.now() }] }));
  }
}

async function importLuno(hash: string, account: PlainAccount, ledger: LedgerFile, deadline: number): Promise<void> {
  const key = cursorKey("luno", account.id, "wallet-history");
  const cursor: SourceCursor = ledger.cursors[key] ?? { ...newCursor(key, account.id, account.name, "wallet-history"), exchange: "luno" };
  if (cursor.backfillDone && Date.now() - (cursor.coveredTo ?? 0) < INCREMENTAL_EVERY_MS) return;
  try {
    const result = await importLunoLink(account, cursor, deadline, () => sleep(220));
    await updateLedger(hash, () => ({ events: result.events, cursors: [result.cursor] }));
  } catch (err) {
    await updateLedger(hash, () => ({ cursors: [{ ...cursor, state: "error", error: errorText(err), updatedAt: Date.now() }] }));
    logger.warn({ op: "ledger.luno", msg: errorText(err) }, "luno history import failed");
  }
}

function earliestEvent(events: LedgerEvent[]): number {
  return events.reduce((min, event) => (event.t < min ? event.t : min), Date.now());
}

async function runImport(hash: string, creds: { binance: PlainAccount[]; luno: PlainAccount[] }): Promise<boolean> {
  const deadline = Date.now() + RUN_BUDGET_MS;
  const initial = (await readLedger(hash)) ?? null;
  await updateLedger(hash, (file) => ({ patch: { startedAt: file.startedAt ?? Date.now() } }));
  const ledger = (await readLedger(hash)) ?? initial;
  if (!ledger) return false;
  // Drop cursors for links that were removed so status stays honest.
  const linkIds = new Set([...creds.binance, ...creds.luno].map((account) => account.id));
  const stale = Object.keys(ledger.cursors).filter((key) => !linkIds.has(ledger.cursors[key]?.linkId ?? ""));
  if (stale.length > 0) {
    await updateLedger(hash, (file) => {
      for (const key of stale) delete file.cursors[key];
      file.events = file.events.filter((event) => linkIds.has(event.linkId));
      return {};
    });
  }
  for (const account of creds.luno) await importLuno(hash, account, ledger, deadline);
  for (const account of creds.binance) {
    if ((pausedUntil.get(hash) ?? 0) > Date.now()) break;
    await importBinanceLink(hash, account, ledger, deadline);
  }
  const after = await readLedger(hash);
  if (!after) return false;
  const assets = new Set(after.events.map((event) => event.asset));
  const portfolio = await readPortfolio(hash);
  for (const position of portfolio?.latest?.positions ?? []) assets.add(position.asset);
  for (const debt of portfolio?.latest?.debts ?? []) assets.add(debt.asset);
  const from = Math.min(earliestEvent(after.events), Date.now() - 400 * DAY_MS);
  const lunoKey = creds.luno[0];
  await ensureDailyPrices(assets, from).catch((err) => logger.warn({ err, op: "ledger.prices" }, "daily prices update failed"));
  await ensureHourlyPrices(assets).catch(() => undefined);
  await ensureFxHistory(from, lunoKey ? { keyId: lunoKey.apiKey, keySecret: lunoKey.apiSecret } : null, portfolio?.latest?.fx ?? null).catch(() => undefined);
  const unfinished = Object.values(after.cursors).some((cursor) => cursor.state !== "unavailable" && !cursor.backfillDone);
  await updateLedger(hash, () => ({ patch: { finishedAt: unfinished ? null : Date.now() } }));
  return unfinished;
}

/**
 * Starts (or joins) the history import for a user. Backfill keeps going in
 * four-minute runs every 30 seconds until every source reaches its floor;
 * after that each scheduler tick only fetches what is new.
 */
export function ensureImportRunning(hash: string, creds: { binance: PlainAccount[]; luno: PlainAccount[] }): Promise<void> {
  const existing = running.get(hash);
  if (existing) return existing;
  if ((pausedUntil.get(hash) ?? 0) > Date.now()) return Promise.resolve();
  if (creds.binance.length === 0 && creds.luno.length === 0) return Promise.resolve();
  const run = runImport(hash, creds)
    .then((unfinished) => {
      if (unfinished && process.env.NODE_ENV !== "test") {
        const timer = setTimeout(() => {
          void ensureImportRunning(hash, creds);
        }, FOLLOW_UP_DELAY_MS);
        timer.unref?.();
      }
    })
    .catch((err) => {
      logger.warn({ op: "ledger.import", msg: errorText(err) }, "history import run failed");
    })
    .finally(() => {
      running.delete(hash);
    });
  running.set(hash, run);
  return run;
}

export function isImportRunning(hash: string): boolean {
  return running.has(hash);
}
