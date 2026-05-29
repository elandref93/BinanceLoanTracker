import { createHmac } from "node:crypto";

import { logger } from "./logger";

export interface BinanceCredentials {
  apiKey: string;
  apiSecret: string;
}

export interface BinanceAccount {
  id: string;
  name: string;
  kind: "Spot" | "Margin" | "Funding";
  readOnly: boolean;
  connectedAt: string;
}

export interface BinanceCollateral {
  asset: string;
  qty: number;
  valueUsd: number;
}

export interface BinanceLoan {
  id: string;
  accountId: string;
  asset: string;
  debt: number;
  debtUsd: number;
  collateral: BinanceCollateral;
  ltv: number;
  marginCallLtv: number;
  liqLtv: number;
  hourlyInterestRate: number;
  apr: number;
}

export interface BinanceRatePoint {
  ts: string;
  apr: number;
}

export interface BinanceInterestRow {
  ts: string;
  accountId: string;
  loanId: string;
  asset: string;
  amount: number;
  amountUsd: number;
}

export interface BinancePrice {
  asset: string;
  usd: number;
}

export interface BinanceClient {
  listAccounts(): Promise<BinanceAccount[]>;
  listLoans(accountId?: string): Promise<BinanceLoan[]>;
  getPrices(assets: string[]): Promise<{ asOf: string; prices: BinancePrice[] }>;
  listInterest(opts: {
    accountId?: string;
    from?: Date;
    to?: Date;
  }): Promise<BinanceInterestRow[]>;
  getRateHistory(loanId: string, days: number): Promise<BinanceRatePoint[]>;
  /**
   * Real lifetime interest paid for a loan, derived from borrow/repay history
   * (flexible) or summed interest deductions (fixed-term). Returns 0/0 when
   * unknown so the route layer can fall back gracefully.
   */
  getLifetimeInterestUsd(
    loanId: string,
  ): Promise<{ lifetimeInterestUsd: number; loanAgeDays: number }>;
}

function hourlyToApr(hourly: number): number {
  return hourly * 24 * 365 * 100;
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

const HOURS_PER_YEAR = 24 * 365; // 8760

/**
 * Pull the loan interest rate from a Binance response row whose field names
 * vary by endpoint / API revision, and normalise to **hourly decimal** (e.g.
 * 0.0000057 ≈ 5% APR).
 *
 * Binance has shipped at least three different rate units under similar
 * field names — annual decimal (e.g. `flexibleInterestRate: "0.0502878"`
 * for 5.02878% APR), daily decimal, and hourly decimal. Picking the wrong
 * unit by 8760× produces the 44,052%-APR display bug we saw on TestFlight.
 *
 * Strategy: read each candidate, normalise to hourly using its **name**
 * semantics, then accept the first candidate whose implied APR is sane
 * (< 200%). Anything bigger is almost certainly the wrong unit.
 *
 * Set `context` for clearer warning logs when nothing parses.
 */
const MAX_PLAUSIBLE_APR_FRACTION = 2.0; // 200% APR cap (guards the high side)
// Lower/upper band used to INFER the unit of an ambiguously-named rate field.
// Real Binance loan APRs sit comfortably inside this; anything outside means
// we picked the wrong unit (e.g. read an already-hourly value as annual,
// collapsing the APR to ~0.00% — the bug this guards against).
const PLAUSIBLE_APR_LO = 0.005; // 0.5%
const PLAUSIBLE_APR_HI = 0.6; //  60%

function pickHourlyRate(
  row: Record<string, unknown>,
  context: string,
): number {
  // 1) Explicitly-unit-named fields: trust the NAME, normalise to hourly,
  //    accept the first whose implied APR is under the 200% cap. These names
  //    are unambiguous so we don't second-guess the unit.
  const named: Array<{ label: string; hourly: number }> = [
    { label: "flexibleHourlyInterestRate", hourly: num(row["flexibleHourlyInterestRate"]) },
    { label: "currentHourlyInterestRate", hourly: num(row["currentHourlyInterestRate"]) },
    { label: "hourlyInterestRate", hourly: num(row["hourlyInterestRate"]) },
    { label: "flexibleDailyInterestRate", hourly: num(row["flexibleDailyInterestRate"]) / 24 },
    { label: "dailyInterestRate", hourly: num(row["dailyInterestRate"]) / 24 },
    { label: "flexibleAnnualInterestRate", hourly: num(row["flexibleAnnualInterestRate"]) / HOURS_PER_YEAR },
    { label: "flexibleYearlyInterestRate", hourly: num(row["flexibleYearlyInterestRate"]) / HOURS_PER_YEAR },
    { label: "annualInterestRate", hourly: num(row["annualInterestRate"]) / HOURS_PER_YEAR },
    { label: "yearlyInterestRate", hourly: num(row["yearlyInterestRate"]) / HOURS_PER_YEAR },
  ];
  for (const c of named) {
    if (c.hourly <= 0) continue;
    const aprFraction = c.hourly * HOURS_PER_YEAR;
    if (aprFraction > MAX_PLAUSIBLE_APR_FRACTION) {
      logger.warn(
        { context, field: c.label, hourly: c.hourly, impliedApr: aprFraction },
        "binance rate candidate exceeds plausible APR cap — skipping",
      );
      continue;
    }
    return c.hourly;
  }

  // 2) Ambiguously-named fields (no unit word in the name). Binance has
  //    shipped these as annual, daily, AND hourly decimals across endpoints
  //    and revisions, so we can't trust the name. Infer the unit by trying
  //    each interpretation and accepting the one whose APR lands in the
  //    plausible band. This fixes both the 8760× high-side blow-up and the
  //    "divide an already-hourly value → 0.00%" low-side collapse.
  const ambiguous = [
    "flexibleInterestRate",
    "currentInterestRate",
    "interestRate",
    "rate",
  ];
  for (const field of ambiguous) {
    const v = num(row[field]);
    if (v <= 0) continue;
    const interpretations: Array<{ unit: string; hourly: number; apr: number }> = [
      { unit: "annual", hourly: v / HOURS_PER_YEAR, apr: v },
      { unit: "daily", hourly: v / 24, apr: v * 365 },
      { unit: "hourly", hourly: v, apr: v * HOURS_PER_YEAR },
    ];
    const match = interpretations.find(
      (i) => i.apr >= PLAUSIBLE_APR_LO && i.apr <= PLAUSIBLE_APR_HI,
    );
    if (match) return match.hourly;
    logger.warn(
      { context, field, value: v, interpretations: interpretations.map((i) => ({ unit: i.unit, apr: i.apr })) },
      "binance ambiguous rate field had no plausible interpretation — skipping",
    );
  }

  logger.warn(
    { context, keys: Object.keys(row) },
    "binance rate could not be resolved from row — APR will be 0",
  );
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// MOCK CLIENT — returns deterministic seed data so the app and previews work
// without Binance keys (used in dev, smoke tests, and any request the device
// makes without an `X-Binance-Accounts` header).
// ─────────────────────────────────────────────────────────────────────────────

const SEED_PRICES: Record<string, number> = {
  BTC: 77500,
  ETH: 2470,
  BNB: 540,
  USDT: 1,
  USDC: 1,
};

const SEED_ACCOUNTS: BinanceAccount[] = [
  {
    id: "acc_main",
    name: "Main",
    kind: "Margin",
    readOnly: true,
    connectedAt: "2025-09-12T08:14:00Z",
  },
  {
    id: "acc_alt",
    name: "Alt",
    kind: "Margin",
    readOnly: true,
    connectedAt: "2025-11-03T16:42:00Z",
  },
];

const SEED_LOANS: BinanceLoan[] = [
  {
    id: "loan_main_btc",
    accountId: "acc_main",
    asset: "USDT",
    debt: 38_500,
    debtUsd: 38_500,
    collateral: { asset: "BTC", qty: 0.86, valueUsd: 0.86 * SEED_PRICES.BTC },
    ltv: 57.8,
    marginCallLtv: 72,
    liqLtv: 78,
    hourlyInterestRate: 0.0000125,
    apr: hourlyToApr(0.0000125),
  },
  {
    id: "loan_alt_eth",
    accountId: "acc_alt",
    asset: "USDT",
    debt: 9_200,
    debtUsd: 9_200,
    collateral: { asset: "ETH", qty: 5.4, valueUsd: 5.4 * SEED_PRICES.ETH },
    ltv: 68.9,
    marginCallLtv: 72,
    liqLtv: 78,
    hourlyInterestRate: 0.0000142,
    apr: hourlyToApr(0.0000142),
  },
  {
    id: "loan_main_bnb",
    accountId: "acc_main",
    asset: "USDT",
    debt: 4_300,
    debtUsd: 4_300,
    collateral: { asset: "BNB", qty: 14, valueUsd: 14 * SEED_PRICES.BNB },
    ltv: 56.9,
    marginCallLtv: 72,
    liqLtv: 78,
    hourlyInterestRate: 0.0000133,
    apr: hourlyToApr(0.0000133),
  },
];

function generateMockRateHistory(
  loan: BinanceLoan,
  days: number,
): BinanceRatePoint[] {
  const out: BinanceRatePoint[] = [];
  const startOfToday = Math.floor(Date.now() / 86_400_000) * 86_400_000;
  const seed = loan.id
    .split("")
    .reduce((s, c) => s + c.charCodeAt(0), 0);
  for (let d = days - 1; d >= 0; d--) {
    const ts = new Date(startOfToday - d * 86_400_000);
    const phase = ((seed + d) * 0.7) % (Math.PI * 2);
    const noise = Math.sin(phase) * 0.12 + Math.sin(phase * 2.3) * 0.04;
    const apr = round(loan.apr * (1 + noise), 4);
    out.push({ ts: ts.toISOString(), apr });
  }
  return out;
}

function generateMockInterestRows(): BinanceInterestRow[] {
  const rows: BinanceInterestRow[] = [];
  const now = Date.now();
  for (let dayOffset = 30; dayOffset >= 0; dayOffset--) {
    const ts = new Date(now - dayOffset * 86_400_000);
    for (const loan of SEED_LOANS) {
      const daily = loan.debt * loan.hourlyInterestRate * 24;
      rows.push({
        ts: ts.toISOString(),
        accountId: loan.accountId,
        loanId: loan.id,
        asset: loan.asset,
        amount: round(daily, 4),
        amountUsd: round(daily, 4),
      });
    }
  }
  return rows;
}

export function createMockBinanceClient(): BinanceClient {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "createMockBinanceClient() is not allowed in production. " +
        "Use createRealBinanceClient() with valid credentials instead.",
    );
  }
  return {
    async listAccounts() {
      return SEED_ACCOUNTS;
    },
    async listLoans(accountId) {
      return accountId
        ? SEED_LOANS.filter((l) => l.accountId === accountId)
        : SEED_LOANS;
    },
    async getPrices(assets) {
      return {
        asOf: new Date().toISOString(),
        prices: assets.map((asset) => ({
          asset,
          usd: SEED_PRICES[asset] ?? 0,
        })),
      };
    },
    async listInterest({ accountId, from, to }) {
      let rows = generateMockInterestRows();
      if (accountId) rows = rows.filter((r) => r.accountId === accountId);
      if (from) rows = rows.filter((r) => new Date(r.ts) >= from);
      if (to) rows = rows.filter((r) => new Date(r.ts) <= to);
      return rows;
    },
    async getRateHistory(loanId, days) {
      const loan = SEED_LOANS.find((l) => l.id === loanId);
      if (!loan) return [];
      return generateMockRateHistory(loan, days);
    },
    async getLifetimeInterestUsd(loanId) {
      const loan = SEED_LOANS.find((l) => l.id === loanId);
      if (!loan) return { lifetimeInterestUsd: 0, loanAgeDays: 0 };
      // Synthetic: pretend loan has been open ~45 days at its current rate.
      const loanAgeDays = 45;
      const dailyUsd = loan.debt * loan.hourlyInterestRate * 24;
      return {
        lifetimeInterestUsd: round(dailyUsd * loanAgeDays, 2),
        loanAgeDays,
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// REAL CLIENT — HMAC-SHA256 signed requests to api.binance.com.
// One instance per stored Binance account on the user's device.
// Built per-request from credentials passed in via `X-Binance-Accounts`;
// secrets are NEVER persisted on the server.
// ─────────────────────────────────────────────────────────────────────────────

const BINANCE_BASE = "https://api.binance.com";

export function signQuery(secret: string, query: string): string {
  return createHmac("sha256", secret).update(query).digest("hex");
}

/**
 * Thrown on any non-2xx from Binance. Carries the parsed Binance error code
 * + message (which is safe — it never echoes the signed query) but does NOT
 * carry the request body, which could contain credential-derived material.
 */
export class BinanceApiError extends Error {
  readonly name = "BinanceApiError";
  readonly path: string;
  readonly status: number;
  readonly code: number | null;
  constructor(path: string, status: number, code: number | null, msg: string) {
    super(`Binance ${path} ${status}: ${msg}`);
    this.path = path;
    this.status = status;
    this.code = code;
  }
}

async function binanceSignedGet<T = unknown>(
  creds: BinanceCredentials,
  path: string,
  params: Record<string, string | number> = {},
): Promise<T> {
  const qs = new URLSearchParams({
    ...Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k, String(v)]),
    ),
    timestamp: String(Date.now()),
    recvWindow: "5000",
  });
  const signature = signQuery(creds.apiSecret, qs.toString());
  qs.append("signature", signature);
  const res = await fetch(`${BINANCE_BASE}${path}?${qs.toString()}`, {
    headers: { "X-MBX-APIKEY": creds.apiKey },
  });
  const body = await res.text();
  if (!res.ok) {
    // Parse Binance's documented error envelope `{code, msg}` only — do NOT
    // surface the raw body, which has been observed to echo back request
    // parameters (and thus credential-derived signature material) on
    // certain validation failures.
    let code: number | null = null;
    let msg = res.statusText || "request failed";
    try {
      const parsed = JSON.parse(body) as { code?: unknown; msg?: unknown };
      if (typeof parsed.code === "number") code = parsed.code;
      if (typeof parsed.msg === "string") msg = parsed.msg;
    } catch {
      // non-JSON; keep the statusText fallback
    }
    throw new BinanceApiError(path, res.status, code, msg);
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new BinanceApiError(path, res.status, null, "non-JSON response");
  }
}

async function binancePublicGet<T = unknown>(
  path: string,
  params: Record<string, string | number> = {},
): Promise<T> {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  );
  const url = qs.toString()
    ? `${BINANCE_BASE}${path}?${qs.toString()}`
    : `${BINANCE_BASE}${path}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Binance ${path} ${res.status}: ${(await res.text()).slice(0, 300)}`,
    );
  }
  return (await res.json()) as T;
}

function num(v: unknown, fallback = 0): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function stableSuffix(s: string, len = 6): string {
  // Trailing 6 chars are enough for an account id discriminator and don't
  // expose the bulk of the API key.
  return s.slice(-len);
}

function rowsArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const rows = (payload as Record<string, unknown>)["rows"];
    if (Array.isArray(rows)) return rows;
  }
  return [];
}

interface StableSymbolRate {
  symbol: string;
  price: number;
}

async function fetchUsdPrices(
  assets: string[],
): Promise<{ asOf: string; prices: BinancePrice[] }> {
  const unique = Array.from(new Set(assets.map((a) => a.toUpperCase())));
  const stables = new Set(["USDT", "USDC", "BUSD", "FDUSD", "DAI", "TUSD"]);
  const needPrice = unique.filter((a) => !stables.has(a));

  let tickerRows: StableSymbolRate[] = [];
  if (needPrice.length > 0) {
    const symbols = needPrice.map((a) => `${a}USDT`);
    const raw = await binancePublicGet<unknown>("/api/v3/ticker/price", {
      symbols: JSON.stringify(symbols),
    });
    tickerRows = (Array.isArray(raw) ? raw : []).map((r) => ({
      symbol: str((r as Record<string, unknown>)["symbol"]),
      price: num((r as Record<string, unknown>)["price"]),
    }));
  }
  const map = new Map(tickerRows.map((r) => [r.symbol, r.price]));
  return {
    asOf: new Date().toISOString(),
    prices: unique.map((asset) => ({
      asset,
      usd: stables.has(asset) ? 1 : map.get(`${asset}USDT`) ?? 0,
    })),
  };
}

/**
 * Real Binance client backed by a single API key/secret pair (one "account"
 * in the device's keychain). Pulls both Flexible Loans (v2) and the legacy
 * fixed-term Crypto Loans endpoint, since users on TestFlight may have either.
 *
 * Untested portions are marked in comments — the response shapes follow
 * Binance docs but field names sometimes drift. The parser is defensive:
 * unknown fields default to 0/empty rather than throwing, so a stale shape
 * degrades the UI (a 0 APR, missing loan) instead of crashing it.
 */
export function createRealBinanceClient(
  account: { id: string; name: string },
  creds: BinanceCredentials,
): BinanceClient {
  const accountId = account.id;
  // Per-instance (= per-request) memo so repeated `listLoans()` calls — e.g.
  // by `getRateHistory` looking up a loan's current APR — don't fan out to
  // Binance again and again. Cleared automatically when the request ends
  // because the client is built fresh per request.
  let loansPromise: Promise<BinanceLoan[]> | null = null;

  async function fetchFlexibleLoans(): Promise<BinanceLoan[]> {
    let ongoing: unknown;
    try {
      ongoing = await binanceSignedGet(
        creds,
        "/sapi/v2/loan/flexible/ongoing/orders",
      );
    } catch (err) {
      logger.warn({ err, accountId }, "flexible loan fetch failed");
      return [];
    }

    // Pull rate sheet once so we can attach an APR per loan coin.
    let rateMap = new Map<string, number>();
    try {
      const rates = await binanceSignedGet<unknown>(
        creds,
        "/sapi/v2/loan/flexible/loanable/data",
      );
      rateMap = new Map(
        rowsArray(rates).map((r) => {
          const row = r as Record<string, unknown>;
          const coin = str(row["loanCoin"]).toUpperCase();
          return [coin, pickHourlyRate(row, `flexible-loanable:${coin}`)];
        }),
      );
    } catch (err) {
      logger.warn({ err, accountId }, "flexible loanable rate fetch failed");
    }

    const loans: BinanceLoan[] = [];
    const priceCache = new Map<string, number>();
    async function priceOf(asset: string): Promise<number> {
      const u = asset.toUpperCase();
      if (priceCache.has(u)) return priceCache.get(u)!;
      const { prices } = await fetchUsdPrices([u]);
      const p = prices[0]?.usd ?? 0;
      priceCache.set(u, p);
      return p;
    }

    for (const r of rowsArray(ongoing)) {
      const row = r as Record<string, unknown>;
      const loanCoin = str(row["loanCoin"]).toUpperCase();
      const collateralCoin = str(row["collateralCoin"]).toUpperCase();
      const debt = num(row["totalDebt"]);
      const collateralAmount = num(row["collateralAmount"]);
      const ltv = num(row["currentLTV"]) * 100;
      const marginCallLtv = num(row["marginCallLTV"]) * 100;
      const liqLtv = num(row["liquidationLTV"]) * 100;
      // Prefer the rate on the order row itself if Binance returns it —
      // it's the actual rate the loan is being charged. Fall back to the
      // public rate sheet keyed by loan coin. `pickHourlyRate` enforces
      // unit semantics and rejects anything implying APR > 200%.
      const orderHourly = pickHourlyRate(
        row,
        `flexible-order:${loanCoin}/${collateralCoin}`,
      );
      const hourly = orderHourly || rateMap.get(loanCoin) || 0;
      const loanCoinUsd = await priceOf(loanCoin);
      const collateralUsd = await priceOf(collateralCoin);
      loans.push({
        id: `${accountId}_flex_${loanCoin}_${collateralCoin}`,
        accountId,
        asset: loanCoin,
        debt,
        debtUsd: round(debt * loanCoinUsd, 2),
        collateral: {
          asset: collateralCoin,
          qty: collateralAmount,
          valueUsd: round(collateralAmount * collateralUsd, 2),
        },
        ltv: round(ltv, 2),
        marginCallLtv: round(marginCallLtv, 2),
        liqLtv: round(liqLtv, 2),
        hourlyInterestRate: hourly,
        apr: round(hourlyToApr(hourly), 3),
      });
    }
    return loans;
  }

  async function fetchFixedLoans(): Promise<BinanceLoan[]> {
    let ongoing: unknown;
    try {
      ongoing = await binanceSignedGet(creds, "/sapi/v2/loan/ongoing/orders");
    } catch (err) {
      logger.warn({ err, accountId }, "fixed-term loan fetch failed");
      return [];
    }
    const loans: BinanceLoan[] = [];
    const priceCache = new Map<string, number>();
    async function priceOf(asset: string): Promise<number> {
      const u = asset.toUpperCase();
      if (priceCache.has(u)) return priceCache.get(u)!;
      const { prices } = await fetchUsdPrices([u]);
      const p = prices[0]?.usd ?? 0;
      priceCache.set(u, p);
      return p;
    }
    for (const r of rowsArray(ongoing)) {
      const row = r as Record<string, unknown>;
      const orderId = str(row["orderId"]);
      const loanCoin = str(row["loanCoin"]).toUpperCase();
      const collateralCoin = str(row["collateralCoin"]).toUpperCase();
      const debt = num(row["totalDebt"]);
      const collateralAmount = num(row["collateralAmount"]);
      const ltv = num(row["currentLTV"]) * 100;
      // Fixed-term rate is returned on the order itself. Use the
      // semantics-aware picker so an annual-rate field labelled
      // ambiguously doesn't get treated as hourly.
      const hourly = pickHourlyRate(
        row,
        `fixed-order:${orderId || `${loanCoin}/${collateralCoin}`}`,
      );
      const loanCoinUsd = await priceOf(loanCoin);
      const collateralUsd = await priceOf(collateralCoin);
      loans.push({
        id: `${accountId}_fixed_${orderId || `${loanCoin}_${collateralCoin}`}`,
        accountId,
        asset: loanCoin,
        debt,
        debtUsd: round(debt * loanCoinUsd, 2),
        collateral: {
          asset: collateralCoin,
          qty: collateralAmount,
          valueUsd: round(collateralAmount * collateralUsd, 2),
        },
        ltv: round(ltv, 2),
        marginCallLtv: 72,
        liqLtv: 83,
        hourlyInterestRate: hourly,
        apr: round(hourlyToApr(hourly), 3),
      });
    }
    return loans;
  }

  // Margin loans: one entry per borrowed asset. Cross margin uses a SHARED
  // collateral pool across all borrowed assets, so we attribute the same
  // pool value to each loan entry and tag the loan id with `cross` so the
  // UI can dedupe collateral in a future iteration. Isolated margin is
  // properly per-pair so each entry has its own collateral. Margin LTV is
  // derived from Binance's `marginLevel` (totalAsset/totalLiability):
  //   LTV%   = 100 / marginLevel
  //   Liq    = at marginLevel ≈ 1.1 → LTV ≈ 91%
  //   Call   = at marginLevel ≈ 1.5 → LTV ≈ 67%
  // These differ from the Crypto Loans constants (72/78). Per-loan LTVs
  // are returned alongside global constants so the UI can colour bands
  // correctly per product.
  const MARGIN_CALL_LTV = round(100 / 1.5, 2); // ≈ 66.67
  const MARGIN_LIQ_LTV = round(100 / 1.1, 2); // ≈ 90.91

  async function fetchNextHourlyRates(
    assets: string[],
    isIsolated: boolean,
  ): Promise<Map<string, number>> {
    if (assets.length === 0) return new Map();
    try {
      const raw = await binanceSignedGet<unknown>(
        creds,
        "/sapi/v1/margin/next-hourly-interest-rate",
        {
          assets: assets.join(","),
          isIsolated: isIsolated ? "TRUE" : "FALSE",
        },
      );
      const out = new Map<string, number>();
      for (const r of Array.isArray(raw) ? raw : []) {
        const row = r as Record<string, unknown>;
        out.set(
          str(row["asset"]).toUpperCase(),
          num(row["nextHourlyInterestRate"]),
        );
      }
      return out;
    } catch (err) {
      logger.warn(
        { err, accountId, isIsolated },
        "next-hourly margin rate fetch failed",
      );
      return new Map();
    }
  }

  async function fetchCrossMarginLoans(): Promise<BinanceLoan[]> {
    let acct: unknown;
    try {
      acct = await binanceSignedGet(creds, "/sapi/v1/margin/account");
    } catch (err) {
      logger.warn({ err, accountId }, "cross margin fetch failed");
      return [];
    }
    const a = (acct ?? {}) as Record<string, unknown>;
    const totalAssetBtc = num(a["totalAssetOfBtc"]);
    const totalLiabBtc = num(a["totalLiabilityOfBtc"]);
    if (totalLiabBtc <= 0) return [];

    const marginLevel = num(a["marginLevel"]);
    const ltv = marginLevel > 0 ? round(100 / marginLevel, 2) : 0;

    const userAssets = Array.isArray(a["userAssets"])
      ? (a["userAssets"] as Array<Record<string, unknown>>)
      : [];
    const borrowed = userAssets
      .map((u) => ({
        asset: str(u["asset"]).toUpperCase(),
        borrowed: num(u["borrowed"]),
        interest: num(u["interest"]),
      }))
      .filter((u) => u.borrowed + u.interest > 0);
    if (borrowed.length === 0) return [];

    const btcUsd = (await fetchUsdPrices(["BTC"])).prices[0]?.usd ?? 0;
    const collateralUsd = round(totalAssetBtc * btcUsd, 2);
    const rateMap = await fetchNextHourlyRates(
      borrowed.map((b) => b.asset),
      false,
    );
    const priceMap = new Map(
      (await fetchUsdPrices(borrowed.map((b) => b.asset))).prices.map((p) => [
        p.asset,
        p.usd,
      ]),
    );

    return borrowed.map((b) => {
      const debt = b.borrowed + b.interest;
      const debtUsd = round(debt * (priceMap.get(b.asset) ?? 0), 2);
      const hourly = rateMap.get(b.asset) ?? 0;
      return {
        id: `${accountId}_cross_${b.asset}`,
        accountId,
        asset: b.asset,
        debt,
        debtUsd,
        collateral: {
          asset: "POOL",
          qty: round(totalAssetBtc, 8),
          valueUsd: collateralUsd,
        },
        ltv,
        marginCallLtv: MARGIN_CALL_LTV,
        liqLtv: MARGIN_LIQ_LTV,
        hourlyInterestRate: hourly,
        apr: round(hourlyToApr(hourly), 3),
      };
    });
  }

  async function fetchIsolatedMarginLoans(): Promise<BinanceLoan[]> {
    let acct: unknown;
    try {
      acct = await binanceSignedGet(creds, "/sapi/v1/margin/isolated/account");
    } catch (err) {
      logger.warn({ err, accountId }, "isolated margin fetch failed");
      return [];
    }
    const a = (acct ?? {}) as Record<string, unknown>;
    const assets = Array.isArray(a["assets"])
      ? (a["assets"] as Array<Record<string, unknown>>)
      : [];

    type IsoEntry = {
      symbol: string;
      borrowAsset: string;
      collateralAsset: string;
      debt: number;
      collateralQty: number;
      marginLevel: number;
    };
    const entries: IsoEntry[] = [];
    for (const pair of assets) {
      const symbol = str(pair["symbol"]);
      const marginLevel = num(pair["marginLevel"]);
      const base = (pair["baseAsset"] ?? {}) as Record<string, unknown>;
      const quote = (pair["quoteAsset"] ?? {}) as Record<string, unknown>;
      const baseAsset = str(base["asset"]).toUpperCase();
      const quoteAsset = str(quote["asset"]).toUpperCase();
      const baseDebt = num(base["borrowed"]) + num(base["interest"]);
      const quoteDebt = num(quote["borrowed"]) + num(quote["interest"]);
      // Net (free + locked) on the OTHER side is the collateral for the side
      // you borrowed. Isolated pairs typically borrow one side at a time.
      if (baseDebt > 0) {
        entries.push({
          symbol,
          borrowAsset: baseAsset,
          collateralAsset: quoteAsset,
          debt: baseDebt,
          collateralQty:
            num(quote["free"]) + num(quote["locked"]) + num(quote["netAsset"]) * 0,
          marginLevel,
        });
      }
      if (quoteDebt > 0) {
        entries.push({
          symbol,
          borrowAsset: quoteAsset,
          collateralAsset: baseAsset,
          debt: quoteDebt,
          collateralQty: num(base["free"]) + num(base["locked"]),
          marginLevel,
        });
      }
    }
    if (entries.length === 0) return [];

    const allAssets = Array.from(
      new Set(entries.flatMap((e) => [e.borrowAsset, e.collateralAsset])),
    );
    const priceMap = new Map(
      (await fetchUsdPrices(allAssets)).prices.map((p) => [p.asset, p.usd]),
    );
    const rateMap = await fetchNextHourlyRates(
      entries.map((e) => e.borrowAsset),
      true,
    );

    return entries.map((e) => {
      const debtUsd = round(e.debt * (priceMap.get(e.borrowAsset) ?? 0), 2);
      const collateralUsd = round(
        e.collateralQty * (priceMap.get(e.collateralAsset) ?? 0),
        2,
      );
      const ltv = e.marginLevel > 0 ? round(100 / e.marginLevel, 2) : 0;
      const hourly = rateMap.get(e.borrowAsset) ?? 0;
      return {
        id: `${accountId}_iso_${e.symbol}_${e.borrowAsset}`,
        accountId,
        asset: e.borrowAsset,
        debt: e.debt,
        debtUsd,
        collateral: {
          asset: e.collateralAsset,
          qty: e.collateralQty,
          valueUsd: collateralUsd,
        },
        ltv,
        marginCallLtv: MARGIN_CALL_LTV,
        liqLtv: MARGIN_LIQ_LTV,
        hourlyInterestRate: hourly,
        apr: round(hourlyToApr(hourly), 3),
      };
    });
  }

  return {
    async listAccounts() {
      // Each credential = one logical account from the device. We don't
      // call Binance for this — the device already knows what it sent us.
      return [
        {
          id: accountId,
          name: account.name,
          kind: "Margin",
          readOnly: true,
          // We can't recover the real connection date from a key alone.
          connectedAt: new Date().toISOString(),
        },
      ];
    },
    async listLoans(filterAccountId) {
      if (filterAccountId && filterAccountId !== accountId) return [];
      if (!loansPromise) {
        loansPromise = Promise.all([
          fetchFlexibleLoans(),
          fetchFixedLoans(),
          fetchCrossMarginLoans(),
          fetchIsolatedMarginLoans(),
        ]).then(([flex, fixed, cross, iso]) => [
          ...flex,
          ...fixed,
          ...cross,
          ...iso,
        ]);
      }
      return loansPromise;
    },
    async getPrices(assets) {
      return fetchUsdPrices(assets);
    },
    async listInterest({ accountId: filterAccountId, from, to }) {
      if (filterAccountId && filterAccountId !== accountId) return [];
      // Fixed-term daily interest deductions. Flexible loans don't expose a
      // clean per-day interest endpoint — interest is folded into collateral
      // deltas — so we'd need our own snapshot store for those. Returning
      // just fixed-term rows here keeps the data honest.
      const params: Record<string, string | number> = {
        type: "BORROW_DAILY_INTEREST",
        size: 100,
      };
      if (from) params["startTime"] = from.getTime();
      if (to) params["endTime"] = to.getTime();
      let raw: unknown;
      try {
        raw = await binanceSignedGet(creds, "/sapi/v1/loan/income", params);
      } catch (err) {
        logger.warn({ err, accountId }, "interest income fetch failed");
        return [];
      }
      const rows: BinanceInterestRow[] = [];
      for (const r of Array.isArray(raw) ? raw : []) {
        const row = r as Record<string, unknown>;
        const asset = str(row["coin"]).toUpperCase();
        const amount = num(row["amount"]);
        const ts = num(row["timestamp"]);
        // Convert to USD using current spot. Historical FX would be more
        // accurate but matches what the dashboard shows elsewhere.
        const { prices } = await fetchUsdPrices([asset]);
        const usd = prices[0]?.usd ?? 0;
        rows.push({
          ts: new Date(ts).toISOString(),
          accountId,
          loanId: `${accountId}_fixed_${str(row["orderId"])}`,
          asset,
          amount: round(amount, 6),
          amountUsd: round(amount * usd, 4),
        });
      }
      return rows;
    },
    async getLifetimeInterestUsd(loanId) {
      const loans = await this.listLoans();
      const loan = loans.find((l) => l.id === loanId);
      if (!loan) return { lifetimeInterestUsd: 0, loanAgeDays: 0 };

      // ── Flexible: derive realised interest from borrow/repay history ────
      if (loanId.includes("_flex_")) {
        const [borrowsRaw, repaysRaw] = await Promise.all([
          binanceSignedGet(creds, "/sapi/v2/loan/flexible/borrow/history", {
            loanCoin: loan.asset,
            size: 100,
          }).catch((err) => {
            logger.warn({ err, loanId }, "flexible borrow history failed");
            return null;
          }),
          binanceSignedGet(creds, "/sapi/v2/loan/flexible/repay/history", {
            loanCoin: loan.asset,
            size: 100,
          }).catch((err) => {
            logger.warn({ err, loanId }, "flexible repay history failed");
            return null;
          }),
        ]);
        const matches = (r: Record<string, unknown>) =>
          str(r["loanCoin"]).toUpperCase() === loan.asset &&
          str(r["collateralCoin"]).toUpperCase() === loan.collateral.asset;
        const borrows = rowsArray(borrowsRaw).filter((r) =>
          matches(r as Record<string, unknown>),
        );
        const repays = rowsArray(repaysRaw).filter((r) =>
          matches(r as Record<string, unknown>),
        );
        if (borrows.length === 0) {
          return { lifetimeInterestUsd: 0, loanAgeDays: 0 };
        }
        const sumBorrow = borrows.reduce<number>(
          (s, r) =>
            s + num((r as Record<string, unknown>)["initialLoanAmount"]),
          0,
        );
        const sumRepay = repays.reduce<number>(
          (s, r) => s + num((r as Record<string, unknown>)["repayAmount"]),
          0,
        );
        // currentDebt = remainingPrincipal + accruedInterestNotYetPaid
        // interestLifetime = currentDebt + totalRepaid - totalBorrowed
        // (any repaid amount above borrowed principal must be interest)
        const lifetimeLoanCoin = Math.max(
          0,
          loan.debt + sumRepay - sumBorrow,
        );
        const { prices } = await fetchUsdPrices([loan.asset]);
        const usd = prices[0]?.usd ?? 0;
        const earliestBorrowTs = borrows.reduce<number>((min, r) => {
          const t = num((r as Record<string, unknown>)["borrowTime"]);
          return t > 0 && t < min ? t : min;
        }, Date.now());
        const loanAgeDays = Math.max(
          1,
          Math.floor((Date.now() - earliestBorrowTs) / 86_400_000),
        );
        return {
          lifetimeInterestUsd: round(lifetimeLoanCoin * usd, 2),
          loanAgeDays,
        };
      }

      // ── Fixed-term: sum all BORROW_DAILY_INTEREST rows for this loan ────
      if (loanId.includes("_fixed_")) {
        const allRows = await this.listInterest({ accountId: loan.accountId });
        const matched = allRows.filter((r) => r.loanId === loanId);
        if (matched.length === 0) {
          return { lifetimeInterestUsd: 0, loanAgeDays: 0 };
        }
        const earliest = Math.min(
          ...matched.map((r) => new Date(r.ts).getTime()),
        );
        return {
          lifetimeInterestUsd: round(
            matched.reduce((s, r) => s + r.amountUsd, 0),
            2,
          ),
          loanAgeDays: Math.max(
            1,
            Math.floor((Date.now() - earliest) / 86_400_000),
          ),
        };
      }

      // Margin loans: not derivable from public history endpoints.
      return { lifetimeInterestUsd: 0, loanAgeDays: 0 };
    },
    async getRateHistory(_loanId, days) {
      // Binance doesn't expose a per-loan historical APR series. We return
      // a flat line at the current rate so the UI sparkline still renders.
      const loans = await this.listLoans();
      const loan = loans.find((l) => l.id === _loanId);
      if (!loan) return [];
      const startOfToday = Math.floor(Date.now() / 86_400_000) * 86_400_000;
      return Array.from({ length: days }, (_, i) => ({
        ts: new Date(startOfToday - (days - 1 - i) * 86_400_000).toISOString(),
        apr: round(loan.apr, 4),
      }));
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MULTIPLEX — fan one BinanceClient call out across N stored accounts in
// parallel, then concatenate. Lets the route layer stay account-agnostic.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run `fn` against every member in parallel. One member's failure is logged
 * and skipped — the rest still contribute their data. This is the right
 * trade-off for a multi-account dashboard: a single expired/broken API key
 * shouldn't blank out the user's healthy accounts.
 */
async function fanOut<T>(
  members: Array<{ account: { id: string; name: string } }>,
  label: string,
  fn: (m: { account: { id: string; name: string } }) => Promise<T[]>,
): Promise<T[]> {
  const settled = await Promise.allSettled(members.map((m) => fn(m)));
  const out: T[] = [];
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status === "fulfilled") {
      out.push(...r.value);
    } else {
      logger.warn(
        { err: r.reason, accountId: members[i].account.id, label },
        "binance multiplex member failed",
      );
    }
  }
  return out;
}

export function createMultiplexBinanceClient(
  members: Array<{
    account: { id: string; name: string };
    client: BinanceClient;
  }>,
): BinanceClient {
  return {
    async listAccounts() {
      return fanOut(members, "listAccounts", (m) => {
        const owner = members.find((mm) => mm.account.id === m.account.id)!;
        return owner.client.listAccounts();
      });
    },
    async listLoans(accountId) {
      const targets = accountId
        ? members.filter((m) => m.account.id === accountId)
        : members;
      return fanOut(targets, "listLoans", (m) => {
        const owner = members.find((mm) => mm.account.id === m.account.id)!;
        return owner.client.listLoans(accountId);
      });
    },
    async getPrices(assets) {
      // Prices are a PUBLIC endpoint — no credentials needed. Calling it
      // directly means an expired first-member API key doesn't break the
      // entire dashboard.
      return fetchUsdPrices(assets);
    },
    async listInterest(opts) {
      const targets = opts.accountId
        ? members.filter((m) => m.account.id === opts.accountId)
        : members;
      return fanOut(targets, "listInterest", (m) => {
        const owner = members.find((mm) => mm.account.id === m.account.id)!;
        return owner.client.listInterest(opts);
      });
    },
    async getRateHistory(loanId, days) {
      const owner = members.find((m) => loanId.startsWith(`${m.account.id}_`));
      if (!owner) return [];
      try {
        return await owner.client.getRateHistory(loanId, days);
      } catch (err) {
        logger.warn(
          { err, loanId, accountId: owner.account.id },
          "rate history failed",
        );
        return [];
      }
    },
    async getLifetimeInterestUsd(loanId) {
      const owner = members.find((m) => loanId.startsWith(`${m.account.id}_`));
      if (!owner) return { lifetimeInterestUsd: 0, loanAgeDays: 0 };
      try {
        return await owner.client.getLifetimeInterestUsd(loanId);
      } catch (err) {
        logger.warn(
          { err, loanId, accountId: owner.account.id },
          "lifetime interest failed",
        );
        return { lifetimeInterestUsd: 0, loanAgeDays: 0 };
      }
    },
  };
}
