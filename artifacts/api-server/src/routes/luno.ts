import { Router, type IRouter, type Request } from "express";
import {
  ListLunoTransactionsQueryParams,
  GetLunoTickerQueryParams,
  GetLunoTickersQueryParams,
  ListLunoWalletsResponse,
  ListLunoTransactionsResponse,
  ListLunoPendingResponse,
  GetLunoTickerResponse,
  GetLunoTickersResponse,
} from "@workspace/api-zod";
import {
  LunoApiError,
  type LunoClient,
  createMultiplexLunoClient,
  createRealLunoClient,
} from "../lib/luno";
import { loadDecryptedExchange } from "../lib/credentialStore";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const emptyClient: LunoClient = {
  async listWallets() {
    return [];
  },
  async listTransactions() {
    return [];
  },
  async listPendingWithdrawals() {
    return [];
  },
  async getTicker(pair) {
    return {
      pair,
      ask: 0,
      bid: 0,
      lastTrade: 0,
      rolling24hVolume: 0,
      asOf: new Date().toISOString(),
    };
  },
  async getTickers() {
    return [];
  },
};

// Max pairs in one /tickers request — guards against a malformed/huge
// `pairs=` query exploding into N upstream HTTP calls.
const MAX_TICKER_PAIRS = 20;

interface DeviceLunoAccount {
  id: string;
  name: string;
  apiKey: string;
  apiSecret: string;
}

async function accountsForRequest(req: Request): Promise<DeviceLunoAccount[] | null> {
  if (!req.userId) return null;
  return loadDecryptedExchange(req.userId, "luno");
}

async function clientFor(req: Request): Promise<LunoClient> {
  const accounts = await accountsForRequest(req);
  if (!accounts) return emptyClient;
  return createMultiplexLunoClient(
    accounts.map((a) => ({
      account: { id: a.id, name: a.name },
      client: createRealLunoClient(
        { id: a.id, name: a.name },
        { keyId: a.apiKey, keySecret: a.apiSecret },
      ),
    })),
  );
}

router.get("/wallets", async (req, res, next) => {
  try {
    const wallets = await (await clientFor(req)).listWallets();
    res.json(ListLunoWalletsResponse.parse({ wallets }));
  } catch (err) {
    next(err);
  }
});

router.get("/transactions", async (req, res, next) => {
  try {
    const { asset, accountId, limit } =
      ListLunoTransactionsQueryParams.parse(req.query);
    const transactions = await (await clientFor(req)).listTransactions({
      asset,
      accountId,
      limit,
    });
    res.json(ListLunoTransactionsResponse.parse({ transactions }));
  } catch (err) {
    next(err);
  }
});

router.get("/pending", async (req, res, next) => {
  try {
    const withdrawals = await (await clientFor(req)).listPendingWithdrawals();
    res.json(ListLunoPendingResponse.parse({ withdrawals }));
  } catch (err) {
    next(err);
  }
});

router.get("/ticker", async (req, res, next) => {
  try {
    const { pair } = GetLunoTickerQueryParams.parse(req.query);
    const ticker = await (await clientFor(req)).getTicker(pair);
    res.json(GetLunoTickerResponse.parse(ticker));
  } catch (err) {
    next(err);
  }
});

router.get("/tickers", async (req, res, next) => {
  try {
    const { pairs } = GetLunoTickersQueryParams.parse(req.query);
    // Normalize: uppercase, dedupe, drop empties, cap.
    const list = Array.from(
      new Set(
        pairs
          .split(",")
          .map((p) => p.trim().toUpperCase())
          .filter(Boolean),
      ),
    ).slice(0, MAX_TICKER_PAIRS);
    const tickers = await (await clientFor(req)).getTickers(list);
    res.json(GetLunoTickersResponse.parse({ tickers }));
  } catch (err) {
    next(err);
  }
});

router.use(
  (
    err: unknown,
    _req: import("express").Request,
    res: import("express").Response,
    _next: import("express").NextFunction,
  ) => {
    logger.error({ err }, "luno route error");
    if (err instanceof LunoApiError) {
      res.status(502).json({
        error: `Luno upstream error (${err.code ?? err.status})`,
      });
      return;
    }
    const declared = (err as { status?: unknown }).status;
    const status =
      typeof declared === "number" && declared >= 400 && declared <= 599
        ? declared
        : 400;
    const message =
      status === 503
        ? "Stored credentials could not be loaded"
        : err instanceof Error
          ? err.message
          : "Internal error";
    res.status(status).json({ error: message });
  },
);

export default router;
