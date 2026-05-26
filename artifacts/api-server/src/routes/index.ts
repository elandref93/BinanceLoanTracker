import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { verifySession } from "../lib/sessionJwt";
import { logger } from "../lib/logger";
import healthRouter from "./health";
import authRouter from "./auth";
import binanceRouter from "./binance";

// Augment Express's Request type so route handlers downstream of requireAuth
// can read req.userId without casts.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

const router: IRouter = Router();

// ─── Public routes ──────────────────────────────────────────────────────────
// /healthz — Azure App Service liveness probe + manual smoke checks.
// /auth/*  — sign-in endpoints; intentionally NOT gated by requireAuth
//            (you can't authenticate to get a session token if you need a
//            session token to call the sign-in endpoint).
router.use(healthRouter);
router.use("/auth", authRouter);

// ─── Authenticated routes ───────────────────────────────────────────────────

async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.header("authorization");
  const bearerMatch = authHeader?.match(/^Bearer\s+(.+)$/i);
  const token = bearerMatch?.[1];

  if (!token) {
    logger.warn(
      {
        route: req.path,
        reason: !authHeader ? "no_authorization_header" : "malformed_bearer_scheme",
      },
      "auth rejected — request denied with 401",
    );
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const result = await verifySession(token);
  if (!result.ok) {
    logger.warn(
      { route: req.path, reason: result.reason },
      "auth rejected — request denied with 401",
    );
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  req.userId = result.claims.sub;
  next();
}

router.use(requireAuth, binanceRouter);

export default router;
