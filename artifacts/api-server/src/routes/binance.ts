import { Router, type IRouter } from "express";
import {
  GetPricesQueryParams,
  ListInterestQueryParams,
  ListLoansQueryParams,
  ListAccountsResponse,
  GetPricesResponse,
  ListInterestResponse,
  ListLoansResponse,
} from "@workspace/api-zod";
import { createMockBinanceClient } from "../lib/binance";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const client = createMockBinanceClient();

router.get("/accounts", async (_req, res, next) => {
  try {
    const accounts = await client.listAccounts();
    res.json(ListAccountsResponse.parse({ accounts }));
  } catch (err) {
    next(err);
  }
});

router.get("/loans", async (req, res, next) => {
  try {
    const { accountId } = ListLoansQueryParams.parse(req.query);
    const loans = await client.listLoans(accountId);
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
    const result = await client.getPrices(symbols);
    res.json(GetPricesResponse.parse(result));
  } catch (err) {
    next(err);
  }
});

router.get("/interest", async (req, res, next) => {
  try {
    const { accountId, from, to } = ListInterestQueryParams.parse(req.query);
    const rows = await client.listInterest({ accountId, from, to });
    const totalUsd = rows.reduce((s, r) => s + r.amountUsd, 0);
    // Weighted APR (simple): assume each row's loan debt at row time is ~stable.
    // For mock we approximate from total interest vs total loan debt over period days.
    const days = Math.max(1, uniqueDays(rows));
    const annualized = (totalUsd / days) * 365;
    const totalDebt = await client
      .listLoans(accountId)
      .then((ls) => ls.reduce((s, l) => s + l.debtUsd, 0));
    const weightedApr =
      totalDebt > 0 ? round((annualized / totalDebt) * 100, 2) : 0;
    res.json(
      ListInterestResponse.parse({
        totalUsd: round(totalUsd, 2),
        weightedApr,
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

function uniqueDays(rows: { ts: string }[]): number {
  const set = new Set(rows.map((r) => r.ts.slice(0, 10)));
  return set.size;
}

router.use(
  (
    err: unknown,
    _req: import("express").Request,
    res: import("express").Response,
    _next: import("express").NextFunction,
  ) => {
    logger.error({ err }, "binance route error");
    const message = err instanceof Error ? err.message : "Internal error";
    res.status(400).json({ error: message });
  },
);

export default router;
