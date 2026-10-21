import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  putCredentials,
  getCredentialMeta,
  deleteCredentials,
  upsertCredentialLink,
  deleteCredentialLink,
  type Exchange,
} from "../lib/credentialStore";
import { isCryptoConfigured } from "../lib/secretCrypto";
import { logger } from "../lib/logger";

// Server-side exchange credentials. Mounted at /api/credentials, behind
// requireAuth, so every handler has req.userId.
//
// SECURITY: GET never returns secrets — only metadata. PUT accepts plaintext
// keys (over TLS) and immediately encrypts them at rest. Plaintext is never
// logged.

const router: IRouter = Router();

const AccountInput = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(128),
  apiKey: z.string().min(1).max(512),
  apiSecret: z.string().min(1).max(512),
});

const PutBody = z
  .object({
    binance: z.array(AccountInput).max(10).optional(),
    luno: z.array(AccountInput).max(10).optional(),
  })
  .refine((b) => (b.binance?.length ?? 0) + (b.luno?.length ?? 0) > 0, {
    message: "Provide at least one binance or luno account.",
  });

const ExchangeParam = z.enum(["binance", "luno"]);
const LinkIdParam = z.string().min(1).max(128);
const LinkBody = z.object({
  name: z.string().min(1).max(128),
  apiKey: z.string().min(1).max(512),
  apiSecret: z.string().min(1).max(512),
});

function pathParam(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

function ensureConfigured(): void {
  if (!isCryptoConfigured()) {
    const e = new Error(
      "Server-side credentials are not available (encryption key not configured).",
    ) as Error & { status?: number };
    e.status = 503;
    throw e;
  }
}

router.put("/", async (req, res, next) => {
  try {
    ensureConfigured();
    const userId = req.userId!;
    const body = PutBody.parse(req.body);
    const stored = await putCredentials(userId, {
      binance: body.binance,
      luno: body.luno,
    });
    res.json(stored);
  } catch (err) {
    next(err);
  }
});

router.get("/", async (req, res, next) => {
  try {
    ensureConfigured();
    const meta = await getCredentialMeta(req.userId!);
    res.json(meta);
  } catch (err) {
    next(err);
  }
});

router.delete("/", async (req, res, next) => {
  try {
    ensureConfigured();
    await deleteCredentials(req.userId!);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.put("/:exchange/:id", async (req, res, next) => {
  try {
    ensureConfigured();
    const exchange: Exchange = ExchangeParam.parse(pathParam(req.params.exchange));
    const id = LinkIdParam.parse(pathParam(req.params.id));
    const body = LinkBody.parse(req.body);
    const stored = await upsertCredentialLink(req.userId!, exchange, {
      id,
      name: body.name,
      apiKey: body.apiKey,
      apiSecret: body.apiSecret,
    });
    res.json(stored);
  } catch (err) {
    next(err);
  }
});

router.delete("/:exchange/:id", async (req, res, next) => {
  try {
    ensureConfigured();
    const exchange: Exchange = ExchangeParam.parse(pathParam(req.params.exchange));
    const id = LinkIdParam.parse(pathParam(req.params.id));
    await deleteCredentialLink(req.userId!, exchange, id);
    res.json({ ok: true });
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
    const status =
      typeof (err as { status?: number })?.status === "number"
        ? (err as { status: number }).status
        : err instanceof z.ZodError
          ? 400
          : 400;
    logger.warn({ op: "credentials.error", status }, "credentials route error");
    const message =
      status === 503
        ? "Credentials are unavailable"
        : err instanceof z.ZodError
          ? "Invalid credentials payload"
          : "Invalid credentials payload";
    res.status(status).json({ error: message });
  },
);

export default router;
