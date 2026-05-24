import { createHmac } from "node:crypto";

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
}

// ─────────────────────────────────────────────────────────────────────────────
// MOCK CLIENT — returns the same data shapes the iOS mockups already consume.
// Swap this for `createRealBinanceClient(creds)` once API keys are wired.
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
  },
];

function generateInterestRows(): BinanceInterestRow[] {
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

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export function createMockBinanceClient(): BinanceClient {
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
      let rows = generateInterestRows();
      if (accountId) rows = rows.filter((r) => r.accountId === accountId);
      if (from) rows = rows.filter((r) => new Date(r.ts) >= from);
      if (to) rows = rows.filter((r) => new Date(r.ts) <= to);
      return rows;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// REAL CLIENT (stub) — HMAC-SHA256 signed requests to api.binance.com.
// Not exported yet; kept here so the swap is a one-line change in routes.
// ─────────────────────────────────────────────────────────────────────────────

const BINANCE_BASE = "https://api.binance.com";

export function signQuery(secret: string, query: string): string {
  return createHmac("sha256", secret).update(query).digest("hex");
}

export async function binanceFetch(
  creds: BinanceCredentials,
  path: string,
  params: Record<string, string | number> = {},
): Promise<unknown> {
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
  if (!res.ok) {
    throw new Error(`Binance ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}
