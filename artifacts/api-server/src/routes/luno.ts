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
import { logger } from "../lib/logger";

const MAX_ACCOUNTS_HEADER_BYTES = 16 * 1024;
const MAX_ACCOUNTS = 10;

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

// The device sends `X-Luno-Accounts` with the same shape as `X-Binance-Accounts`
// — base64 JSON `[{id, name, apiKey, apiSecret}]`. We keep `apiKey/apiSecret`
// naming for symmetry with the binance header; on Luno these map to
// `key_id`/`key_secret`.
function parseLunoAccountsHeader(req: Request): DeviceLunoAccount[] | null {
  const header = req.header("x-luno-accounts");
  if (!header) return null;
  if (header.length > MAX_ACCOUNTS_HEADER_BYTES) {
    logger.warn(
      { len: header.length },
      "X-Luno-Accounts header exceeds size cap",
    );
    return null;
  }
  try {
    const json = Buffer.from(header, "base64").toString("utf8");
    if (json.length > MAX_ACCOUNTS_HEADER_BYTES) return null;
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    if (parsed.length > MAX_ACCOUNTS) return null;
    const out: DeviceLunoAccount[] = [];
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
    logger.warn({ err }, "X-Luno-Accounts header parse failed");
    return null;
  }
}

function clientFor(req: Request): LunoClient {
  const accounts = parseLunoAccountsHeader(req);
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
    const wallets = await clientFor(req).listWallets();
    res.json(ListLunoWalletsResponse.parse({ wallets }));
  } catch (err) {
    next(err);
  }
});

router.get("/transactions", async (req, res, next) => {
  try {
    const { asset, limit } = ListLunoTransactionsQueryParams.parse(req.query);
    const transactions = await clientFor(req).listTransactions({
      asset,
      limit,
    });
    res.json(ListLunoTransactionsResponse.parse({ transactions }));
  } catch (err) {
    next(err);
  }
});

router.get("/pending", async (req, res, next) => {
  try {
    const withdrawals = await clientFor(req).listPendingWithdrawals();
    res.json(ListLunoPendingResponse.parse({ withdrawals }));
  } catch (err) {
    next(err);
  }
});

router.get("/ticker", async (req, res, next) => {
  try {
    const { pair } = GetLunoTickerQueryParams.parse(req.query);
    const ticker = await clientFor(req).getTicker(pair);
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
    const tickers = await clientFor(req).getTickers(list);
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
    const message = err instanceof Error ? err.message : "Internal error";
    res.status(400).json({ error: message });
  },
);

export default router;
