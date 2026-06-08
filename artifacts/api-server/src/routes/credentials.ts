import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  putCredentials,
  getCredentialMeta,
  deleteCredentials,
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
    const accounts = await putCredentials(userId, {
      binance: body.binance,
      luno: body.luno,
    });
    res.json({ updatedAt: new Date().toISOString(), accounts });
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
      err instanceof z.ZodError
        ? "Invalid credentials payload"
        : err instanceof Error
          ? err.message
          : "Internal error";
    res.status(status).json({ error: message });
  },
);

export default router;
