import { Router, type IRouter, type Request } from "express";
import {
  GetPricesQueryParams,
  ListInterestQueryParams,
  ListLoansQueryParams,
  ListAccountsResponse,
  GetPricesResponse,
  ListInterestResponse,
  ListLoansResponse,
} from "@workspace/api-zod";
import {
  BinanceApiError,
  type BinanceClient,
  createMockBinanceClient,
  createMultiplexBinanceClient,
  createRealBinanceClient,
} from "../lib/binance";
import { logger } from "../lib/logger";

// Hard cap on the credentials header to prevent CPU/OOM DoS via a giant
// base64 blob — the legitimate payload for 5 accounts is ~1.5 KB.
const MAX_ACCOUNTS_HEADER_BYTES = 16 * 1024;
const MAX_ACCOUNTS = 10;

const router: IRouter = Router();
const mockClient = createMockBinanceClient();

// ─────────────────────────────────────────────────────────────────────────────
// Per-request client selection
//
// The device sends `X-Binance-Accounts` containing a base64-encoded JSON array
// of `{ id, name, apiKey, apiSecret }`. The server builds one real client per
// entry and a multiplex wrapper so the route handlers stay account-agnostic.
// Secrets live only for the lifetime of the request — never logged, never
// persisted.
//
// If the header is missing or unparseable, we fall back to the mock client so
// development, previews, and unsigned smoke tests keep working.
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
  if (!accounts) return mockClient;
  return createMultiplexBinanceClient(
    accounts.map((a) => ({
      account: { id: a.id, name: a.name },
      client: createRealBinanceClient(
        { id: a.id, name: a.name },
        { apiKey: a.apiKey, apiSecret: a.apiSecret },
      ),
    })),
  );
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
    const loans = await clientFor(req).listLoans(accountId);
    const totalDebtUsd = loans.reduce((s, l) => s + l.debtUsd, 0);
    const totalCollateralUsd = loans.reduce(
      (s, l) => s + l.collateral.valueUsd,
      0,
    );
    const aggregateLtv =
      totalCollateralUsd > 0 ? (totalDebtUsd / totalCollateralUsd) * 100 : 0;
    res.json(
      ListLoansResponse.parse({
        asOf: new Date().toISOString(),
        aggregateLtv: round(aggregateLtv, 2),
        totalDebtUsd: round(totalDebtUsd, 2),
        totalCollateralUsd: round(totalCollateralUsd, 2),
        loans,
      }),
    );
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

    const totalUsd = rows.reduce((s, r) => s + r.amountUsd, 0);
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
        const accrued30dUsd = round(
          loanRows.reduce((s, r) => s + r.amountUsd, 0),
          2,
        );
        const dailyUsd = round(loan.debt * loan.hourlyInterestRate * 24, 4);
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
          rateHistory,
        };
      }),
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
