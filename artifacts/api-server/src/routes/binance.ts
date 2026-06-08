import { Router, type IRouter, type Request } from "express";
import {
  GetPricesQueryParams,
  GetRateHistoryQueryParams,
  GetRateHistoryResponse,
  ListHoldingsResponse,
  ListInterestQueryParams,
  ListLoanTransactionsQueryParams,
  ListLoanTransactionsResponse,
  ListLoansQueryParams,
  ListAccountsResponse,
  GetPricesResponse,
  ListInterestResponse,
  ListLoansResponse,
} from "@workspace/api-zod";
import { BinanceApiError, type BinanceClient } from "../lib/binance";
import { logger } from "../lib/logger";
import { buildBinanceClient, computeLoanSummary } from "../lib/loanCompute";

// Hard cap on the credentials header to prevent CPU/OOM DoS via a giant
// base64 blob — the legitimate payload for 5 accounts is ~1.5 KB.
const MAX_ACCOUNTS_HEADER_BYTES = 16 * 1024;
const MAX_ACCOUNTS = 10;

const router: IRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Empty client — returned when the device has no linked Binance accounts.
// The mobile app gates onboarding on local account count, so this branch is
// hit by unsigned smoke tests and previews where "no data" is the truthful
// answer. No more mock data anywhere in the pipeline.
// ─────────────────────────────────────────────────────────────────────────────
const emptyClient: BinanceClient = {
  async listAccounts() {
    return [];
  },
  async listLoans() {
    return [];
  },
  async getPrices(assets) {
    return {
      asOf: new Date().toISOString(),
      prices: assets.map((asset) => ({ asset, usd: 0 })),
    };
  },
  async listInterest() {
    return [];
  },
  async getRateHistory() {
    return [];
  },
  async getLifetimeInterestUsd() {
    return { lifetimeInterestUsd: 0, loanAgeDays: 0 };
  },
  async getLoanTransactions() {
    return [];
  },
  async getHoldings() {
    return [];
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Per-request client selection
//
// The device sends `X-Binance-Accounts` containing a base64-encoded JSON array
// of `{ id, name, apiKey, apiSecret }`. The server builds one real client per
// entry and a multiplex wrapper so the route handlers stay account-agnostic.
// Secrets live only for the lifetime of the request — never logged, never
// persisted.
//
// If the header is missing or unparseable, we return empty data — the device
// is expected to gate onboarding locally and only call these endpoints once
// it has at least one linked account.
// ─────────────────────────────────────────────────────────────────────────────

interface DeviceAccount {
  id: string;
  name: string;
  apiKey: string;
  apiSecret: string;
}

function parseAccountsHeader(req: Request): DeviceAccount[] | null {
  const header = req.header("x-binance-accounts");
  if (!header) return null;
  if (header.length > MAX_ACCOUNTS_HEADER_BYTES) {
    logger.warn(
      { len: header.length },
      "X-Binance-Accounts header exceeds size cap",
    );
    return null;
  }
  try {
    const json = Buffer.from(header, "base64").toString("utf8");
    if (json.length > MAX_ACCOUNTS_HEADER_BYTES) return null;
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    if (parsed.length > MAX_ACCOUNTS) return null;
    const out: DeviceAccount[] = [];
    for (const r of parsed) {
      if (!r || typeof r !== "object") continue;
      const id = typeof r.id === "string" ? r.id : null;
      const name = typeof r.name === "string" ? r.name : null;
      const apiKey = typeof r.apiKey === "string" ? r.apiKey : null;
      const apiSecret = typeof r.apiSecret === "string" ? r.apiSecret : null;
      if (id && name && apiKey && apiSecret) {
        out.push({ id, name, apiKey, apiSecret });
      }
    }
    return out.length > 0 ? out : null;
  } catch (err) {
    logger.warn({ err }, "X-Binance-Accounts header parse failed");
    return null;
  }
}

function clientFor(req: Request): BinanceClient {
  const accounts = parseAccountsHeader(req);
  if (!accounts) return emptyClient;
  return buildBinanceClient(accounts);
}

router.get("/accounts", async (req, res, next) => {
  try {
    const accounts = await clientFor(req).listAccounts();
    res.json(ListAccountsResponse.parse({ accounts }));
  } catch (err) {
    next(err);
  }
});

router.get("/loans", async (req, res, next) => {
  try {
    const { accountId } = ListLoansQueryParams.parse(req.query);
    const summary = await computeLoanSummary(clientFor(req), accountId);
    res.json(ListLoansResponse.parse(summary));
  } catch (err) {
    next(err);
  }
});

router.get("/loans/transactions", async (req, res, next) => {
  try {
    const { loanId } = ListLoanTransactionsQueryParams.parse(req.query);
    const transactions = await clientFor(req).getLoanTransactions(loanId);
    res.json(ListLoanTransactionsResponse.parse({ loanId, transactions }));
  } catch (err) {
    next(err);
  }
});

router.get("/prices", async (req, res, next) => {
  try {
    const { assets } = GetPricesQueryParams.parse(req.query);
    const symbols = assets
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const result = await clientFor(req).getPrices(symbols);
    res.json(GetPricesResponse.parse(result));
  } catch (err) {
    next(err);
  }
});

router.get("/interest", async (req, res, next) => {
  try {
    const { accountId, from, to } = ListInterestQueryParams.parse(req.query);
    const client = clientFor(req);
    const [rows, loans] = await Promise.all([
      client.listInterest({ accountId, from, to }),
      client.listLoans(accountId),
    ]);

    const totalDebt = loans.reduce((s, l) => s + l.debtUsd, 0);
    // Instantaneous debt-weighted APR (forward-looking, matches byAsset.weightedApr)
    const weightedApr =
      totalDebt > 0
        ? round(
            loans.reduce((s, l) => s + l.debtUsd * l.apr, 0) / totalDebt,
            2,
          )
        : 0;
    const projected30dUsd = round(
      loans.reduce((s, l) => s + l.debt * l.hourlyInterestRate * 24 * 30, 0),
      2,
    );

    const byLoan = await Promise.all(
      loans.map(async (loan) => {
        const loanRows = rows.filter((r) => r.loanId === loan.id);
        const dailyUsd = round(loan.debt * loan.hourlyInterestRate * 24, 4);
        const { lifetimeInterestUsd, loanAgeDays } =
          await client.getLifetimeInterestUsd(loan.id);
        // Accuracy ladder for "Last 30d":
        //   1. Realised income rows when present (fixed-term).
        //   2. Lifetime-derived avg × 30 when we know loan age (≥1d of history).
        //   3. Live daily rate × 30 estimate as last-resort fallback.
        let accrued30dUsd: number;
        if (loanRows.length > 0) {
          accrued30dUsd = round(
            loanRows.reduce((s, r) => s + r.amountUsd, 0),
            2,
          );
        } else if (loanAgeDays > 0 && lifetimeInterestUsd > 0) {
          // If loan younger than 30d, lifetime IS the last-30d figure.
          accrued30dUsd =
            loanAgeDays <= 30
              ? round(lifetimeInterestUsd, 2)
              : round((lifetimeInterestUsd / loanAgeDays) * 30, 2);
        } else {
          accrued30dUsd = round(dailyUsd * 30, 2);
        }
        const rateHistory = await client.getRateHistory(loan.id, 30);
        const aprs = rateHistory.map((p) => p.apr);
        const avg30dApr = aprs.length
          ? round(aprs.reduce((s, a) => s + a, 0) / aprs.length, 3)
          : loan.apr;
        return {
          loanId: loan.id,
          accountId: loan.accountId,
          asset: loan.asset,
          collateralAsset: loan.collateral.asset,
          currentApr: round(loan.apr, 3),
          avg30dApr,
          min30dApr: aprs.length ? round(Math.min(...aprs), 3) : loan.apr,
          max30dApr: aprs.length ? round(Math.max(...aprs), 3) : loan.apr,
          accrued30dUsd,
          projected30dUsd: round(dailyUsd * 30, 2),
          dailyUsd,
          lifetimeInterestUsd: round(lifetimeInterestUsd, 2),
          loanAgeDays,
          rateHistory,
        };
      }),
    );

    // Aggregate "Charged · 30d" from per-loan accrued30dUsd so flexible loans
    // (which post no income rows) contribute their ladder-derived numbers
    // instead of zero.
    const totalUsd = round(
      byLoan.reduce((s, b) => s + b.accrued30dUsd, 0),
      2,
    );

    const byAssetMap = new Map<
      string,
      {
        debtUsd: number;
        weightedAprNum: number;
        accrued30dUsd: number;
        projected30dUsd: number;
      }
    >();
    for (const loan of loans) {
      const existing =
        byAssetMap.get(loan.asset) ?? {
          debtUsd: 0,
          weightedAprNum: 0,
          accrued30dUsd: 0,
          projected30dUsd: 0,
        };
      const bl = byLoan.find((b) => b.loanId === loan.id);
      existing.debtUsd += loan.debtUsd;
      existing.weightedAprNum += loan.debtUsd * loan.apr;
      existing.accrued30dUsd += bl?.accrued30dUsd ?? 0;
      existing.projected30dUsd += bl?.projected30dUsd ?? 0;
      byAssetMap.set(loan.asset, existing);
    }
    const byAsset = Array.from(byAssetMap.entries()).map(([asset, v]) => ({
      asset,
      debtUsd: round(v.debtUsd, 2),
      weightedApr: v.debtUsd > 0 ? round(v.weightedAprNum / v.debtUsd, 3) : 0,
      accrued30dUsd: round(v.accrued30dUsd, 2),
      projected30dUsd: round(v.projected30dUsd, 2),
    }));

    res.json(
      ListInterestResponse.parse({
        totalUsd: round(totalUsd, 2),
        weightedApr,
        projected30dUsd,
        byLoan,
        byAsset,
        rows,
      }),
    );
  } catch (err) {
    next(err);
  }
});

router.get("/rate-history", async (req, res, next) => {
  try {
    // Query-string values arrive as strings; the generated schema expects a
    // numeric literal (30 | 90), so coerce `days` before validation. Anything
    // non-numeric stays a string and is rejected by the schema as a 400.
    const rawDays = req.query.days;
    const { loanId, days } = GetRateHistoryQueryParams.parse({
      ...req.query,
      days:
        typeof rawDays === "string" && rawDays.trim() !== ""
          ? Number(rawDays)
          : rawDays,
    });
    const window = days ?? 30;
    const points = await clientFor(req).getRateHistory(loanId, window);
    // `source` is authoritative, not just loanId-derived: the client falls
    // back to a FLAT line (at the current rate) for crypto loans AND for
    // margin loans too new to have accrual rows yet. We only advertise
    // "margin" (real charged rate) when the loan is a margin ref *and* the
    // returned series actually moves — a flat series carries no real
    // history regardless of product, so it's labeled "flat".
    const aprs = points.map((p) => p.apr);
    const hasVariance =
      aprs.length >= 2 && Math.min(...aprs) !== Math.max(...aprs);
    const source =
      /_cross_|_iso_/.test(loanId) && hasVariance ? "margin" : "flat";
    // Stats over the trailing 30 days of the series (chart shows the full
    // window, but "30-day average" is what the loan card advertises).
    const last30 = points.slice(-30).map((p) => p.apr);
    const avg30dApr = last30.length
      ? round(last30.reduce((s, a) => s + a, 0) / last30.length, 3)
      : 0;
    res.json(
      GetRateHistoryResponse.parse({
        loanId,
        days: window,
        source,
        points,
        avg30dApr,
        min30dApr: last30.length ? round(Math.min(...last30), 3) : 0,
        max30dApr: last30.length ? round(Math.max(...last30), 3) : 0,
      }),
    );
  } catch (err) {
    next(err);
  }
});

router.get("/holdings", async (req, res, next) => {
  try {
    const holdings = await clientFor(req).getHoldings();
    res.json(
      ListHoldingsResponse.parse({
        asOf: new Date().toISOString(),
        holdings,
      }),
    );
  } catch (err) {
    next(err);
  }
});

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

router.use(
  (
    err: unknown,
    _req: import("express").Request,
    res: import("express").Response,
    _next: import("express").NextFunction,
  ) => {
    logger.error({ err }, "binance route error");
    // For Binance upstream errors, surface only the safe parsed code/msg —
    // never the raw error message, which could include credential-derived
    // fragments from a echoed request URL.
    if (err instanceof BinanceApiError) {
      res.status(502).json({
        error: `Binance upstream error (${err.code ?? err.status})`,
      });
      return;
    }
    const message = err instanceof Error ? err.message : "Internal error";
    res.status(400).json({ error: message });
  },
);

export default router;
