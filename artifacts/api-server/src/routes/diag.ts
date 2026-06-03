import { Router, type IRouter, type Request, type Response } from "express";

import { logger } from "../lib/logger";

/**
 * Client diagnostics intake.
 *
 * The mobile app POSTs captured crashes/errors here (see
 * `lib/crashReporting.ts`). We keep a small in-memory ring buffer for quick
 * inspection via `GET /api/diag/crash`, and — crucially — log every report at
 * `error` level so it shows up in the Azure log stream alongside server errors.
 * This is a private 3-user app, so cross-user visibility on GET is acceptable
 * and useful for debugging.
 *
 * In-memory storage is intentional: Azure App Service storage is ephemeral and
 * this is a live-debugging aid, not durable telemetry.
 */
interface StoredCrash {
  receivedAt: string;
  userId?: string;
  time?: string;
  message?: string;
  stack?: string;
  fatal?: boolean;
  context?: unknown;
}

const MAX = 200;
const crashes: StoredCrash[] = [];

/**
 * Bound the size of arbitrary client `context` so a large/hostile payload can't
 * amplify memory or log volume. (Body parsing already caps total request size;
 * this caps what we retain and log.)
 */
function clampContext(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  try {
    const s = JSON.stringify(value);
    if (s.length > 4000) return { truncated: true, preview: s.slice(0, 4000) };
    return value;
  } catch {
    return undefined;
  }
}

const router: IRouter = Router();

router.post("/crash", (req: Request, res: Response) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const entry: StoredCrash = {
    receivedAt: new Date().toISOString(),
    userId: req.userId,
    time: typeof b.time === "string" ? b.time : undefined,
    message:
      typeof b.message === "string" ? b.message.slice(0, 2000) : undefined,
    stack: typeof b.stack === "string" ? b.stack.slice(0, 8000) : undefined,
    fatal: typeof b.fatal === "boolean" ? b.fatal : undefined,
    context: clampContext(b.context),
  };

  crashes.push(entry);
  if (crashes.length > MAX) crashes.splice(0, crashes.length - MAX);

  logger.info(
    { op: "diag.crash", userId: entry.userId, fatal: Boolean(entry.fatal) },
    "client crash received",
  );
  logger.error({ clientCrash: entry }, "client crash reported");
  res.status(204).end();
});

router.get("/crash", (_req: Request, res: Response) => {
  res.json({ crashes: [...crashes].reverse() });
});

export default router;
