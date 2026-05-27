import { logger } from "./logger";

export interface LunoCredentials {
  keyId: string;
  keySecret: string;
}

export interface LunoAccountRef {
  id: string;
  name: string;
}

export interface LunoWallet {
  accountId: string;
  accountName: string;
  walletId: string;
  asset: string;
  balance: number;
  reserved: number;
  unconfirmed: number;
}

export interface LunoTransaction {
  accountId: string;
  accountName: string;
  walletId: string;
  asset: string;
  rowIndex: number;
  ts: string;
  amount: number;
  balance: number;
  description: string;
}

export interface LunoPendingWithdrawal {
  accountId: string;
  accountName: string;
  withdrawalId: string;
  status: string;
  asset: string;
  amount: number;
  createdAt: string;
}

export interface LunoTicker {
  pair: string;
  ask: number;
  bid: number;
  lastTrade: number;
  rolling24hVolume: number;
  asOf: string;
}

export interface LunoClient {
  listWallets(): Promise<LunoWallet[]>;
  listTransactions(opts?: {
    asset?: string;
    limit?: number;
  }): Promise<LunoTransaction[]>;
  listPendingWithdrawals(): Promise<LunoPendingWithdrawal[]>;
  getTicker(pair: string): Promise<LunoTicker>;
}

export class LunoApiError extends Error {
  constructor(
    public status: number,
    public code: string | null,
    msg: string,
  ) {
    super(msg);
    this.name = "LunoApiError";
  }
}

const LUNO_BASE = "https://api.luno.com";

function basicAuth(creds: LunoCredentials): string {
  return `Basic ${Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString("base64")}`;
}

async function lunoFetch<T>(
  path: string,
  creds: LunoCredentials | null,
): Promise<T> {
  const url = `${LUNO_BASE}${path}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (creds) headers.Authorization = basicAuth(creds);
  const res = await fetch(url, { headers });
  if (!res.ok) {
    let code: string | null = null;
    let msg = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as {
        error?: string;
        error_code?: string;
      };
      if (body.error_code) code = body.error_code;
      if (body.error) msg = body.error;
    } catch {
      // body wasn't JSON — keep generic msg
    }
    throw new LunoApiError(res.status, code, msg);
  }
  return (await res.json()) as T;
}

interface RawWallet {
  account_id: string;
  asset: string;
  balance: string;
  reserved: string;
  unconfirmed: string;
}

interface RawWalletsResponse {
  balance?: RawWallet[];
}

interface RawTransaction {
  row_index: number;
  timestamp: number;
  balance: number;
  available: number;
  balance_delta: number;
  available_delta: number;
  currency: string;
  description: string;
}

interface RawTransactionsResponse {
  id: string;
  transactions?: RawTransaction[];
}

interface RawWithdrawal {
  id: string;
  status: string;
  currency: string;
  amount: string;
  created_at: number;
  type?: string;
}

interface RawWithdrawalsResponse {
  withdrawals?: RawWithdrawal[];
}

interface RawTicker {
  pair: string;
  timestamp: number;
  ask: string;
  bid: string;
  last_trade: string;
  rolling_24_hour_volume: string;
}

function num(s: string | number | undefined | null): number {
  if (s == null) return 0;
  const n = typeof s === "number" ? s : Number(s);
  return Number.isFinite(n) ? n : 0;
}

export function createRealLunoClient(
  account: LunoAccountRef,
  creds: LunoCredentials,
): LunoClient {
  return {
    async listWallets() {
      const res = await lunoFetch<RawWalletsResponse>("/api/1/balance", creds);
      return (res.balance ?? []).map((w) => ({
        accountId: account.id,
        accountName: account.name,
        walletId: w.account_id,
        asset: w.asset,
        balance: num(w.balance),
        reserved: num(w.reserved),
        unconfirmed: num(w.unconfirmed),
      }));
    },
    async listTransactions(opts) {
      const wallets = await this.listWallets();
      const filtered = opts?.asset
        ? wallets.filter(
            (w) => w.asset.toUpperCase() === opts.asset?.toUpperCase(),
          )
        : wallets;
      const perWallet = Math.max(1, Math.floor((opts?.limit ?? 25) / Math.max(1, filtered.length)));
      const out: LunoTransaction[] = [];
      for (const w of filtered) {
        try {
          // min_row=1 forces "latest N descending" semantics on Luno's endpoint.
          const path = `/api/1/accounts/${encodeURIComponent(w.walletId)}/transactions?min_row=-${perWallet}&max_row=-1`;
          const res = await lunoFetch<RawTransactionsResponse>(path, creds);
          for (const t of res.transactions ?? []) {
            out.push({
              accountId: account.id,
              accountName: account.name,
              walletId: w.walletId,
              asset: w.asset,
              rowIndex: t.row_index,
              ts: new Date(t.timestamp).toISOString(),
              amount: num(t.balance_delta ?? t.available_delta),
              balance: num(t.balance ?? t.available),
              description: t.description ?? "",
            });
          }
        } catch (err) {
          logger.warn({ err, walletId: w.walletId }, "luno tx fetch failed");
        }
      }
      out.sort((a, b) => (a.ts < b.ts ? 1 : -1));
      return opts?.limit ? out.slice(0, opts.limit) : out;
    },
    async listPendingWithdrawals() {
      const res = await lunoFetch<RawWithdrawalsResponse>(
        "/api/1/withdrawals",
        creds,
      );
      return (res.withdrawals ?? [])
        .filter((w) => w.status === "PENDING" || w.status === "PROCESSING")
        .map((w) => ({
          accountId: account.id,
          accountName: account.name,
          withdrawalId: w.id,
          status: w.status,
          asset: w.currency || w.type || "",
          amount: num(w.amount),
          createdAt: new Date(w.created_at).toISOString(),
        }));
    },
    async getTicker(pair) {
      const res = await lunoFetch<RawTicker>(
        `/api/1/ticker?pair=${encodeURIComponent(pair)}`,
        null,
      );
      return {
        pair: res.pair,
        ask: num(res.ask),
        bid: num(res.bid),
        lastTrade: num(res.last_trade),
        rolling24hVolume: num(res.rolling_24_hour_volume),
        asOf: new Date(res.timestamp || Date.now()).toISOString(),
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Multiplex: fan out across multiple Luno-linked accounts. Same shape as the
// Binance multiplex — per-account failures are swallowed and logged so a single
// broken key doesn't 502 the whole dashboard.
// ─────────────────────────────────────────────────────────────────────────────

interface MultiplexMember {
  account: LunoAccountRef;
  client: LunoClient;
}

async function fanOut<T>(
  members: MultiplexMember[],
  label: string,
  fn: (m: MultiplexMember) => Promise<T[]>,
): Promise<T[]> {
  const settled = await Promise.allSettled(members.map((m) => fn(m)));
  const out: T[] = [];
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status === "fulfilled") {
      out.push(...r.value);
    } else {
      logger.warn(
        { err: r.reason, account: members[i].account.id, op: label },
        "luno multiplex member failed",
      );
    }
  }
  return out;
}

export function createMultiplexLunoClient(
  members: MultiplexMember[],
): LunoClient {
  return {
    listWallets() {
      return fanOut(members, "listWallets", (m) => m.client.listWallets());
    },
    async listTransactions(opts) {
      // Per-account budget: divide the caller's limit across members so the
      // global limit is respected even when N accounts each return their own
      // page. Add a small headroom so we don't drop the most-recent rows
      // when one account is denser than another.
      const globalLimit = opts?.limit ?? 25;
      const perAccount = Math.max(
        5,
        Math.ceil(globalLimit / Math.max(1, members.length)) + 5,
      );
      const merged = await fanOut(members, "listTransactions", (m) =>
        m.client.listTransactions({ asset: opts?.asset, limit: perAccount }),
      );
      // Re-sort globally so "newest first" holds across all accounts, not
      // just within each one, then trim to the caller's requested limit.
      merged.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
      return merged.slice(0, globalLimit);
    },
    listPendingWithdrawals() {
      return fanOut(members, "listPendingWithdrawals", (m) =>
        m.client.listPendingWithdrawals(),
      );
    },
    async getTicker(pair) {
      // Public endpoint — any member works; use the first, fall back if missing.
      if (members.length === 0) {
        throw new Error("No Luno accounts configured");
      }
      return members[0].client.getTicker(pair);
    },
  };
}
