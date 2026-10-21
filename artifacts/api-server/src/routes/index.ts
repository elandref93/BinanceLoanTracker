import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { logger } from "../lib/logger";
import healthRouter from "./health";
import authRouter from "./auth";
import clerkAuthRouter from "./clerkAuth";
import binanceRouter from "./binance";
import lunoRouter from "./luno";
import accountsRouter from "./accounts";
import settingsRouter from "./settings";
import loanAnnotationsRouter from "./loanAnnotations";
import scenariosRouter from "./scenarios";
import credentialsRouter from "./credentials";
import ltvRouter from "./ltv";
import portfolioRouter from "./portfolio";

const router: IRouter = Router();

// ─── Public routes ──────────────────────────────────────────────────────────
// /healthz — Azure App Service liveness probe + manual smoke checks.
// /readyz  — encryption key and data directory. Not the
//            Azure probe: a 503 here must not recycle the app.
// /auth/clerk — exchanges an Apple Clerk session for the browser cookie.
// /auth/session and /auth/logout — cookie session. Not gated by requireAuth
//            because logout and the session probe must run for a signed-out browser.
router.use(healthRouter);
router.use("/auth/clerk", clerkAuthRouter);
router.use("/auth", authRouter);

// ─── Authenticated routes ───────────────────────────────────────────────────

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // attachBrowserAuth already verified a bearer or a web cookie. An invalid
  // bearer stays invalid so it cannot fall through onto a cookie session.
  if (req.authVia === "bearer_invalid" || !req.userId) {
    logger.warn(
      {
        route: req.path,
        reason: req.authVia === "bearer_invalid" ? "invalid_bearer" : "no_session",
      },
      "auth rejected — request denied with 401",
    );
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

router.use(requireAuth, binanceRouter);
router.use("/luno", requireAuth, lunoRouter);
router.use("/accounts", requireAuth, accountsRouter);
router.use("/settings", requireAuth, settingsRouter);
router.use("/loans/annotations", requireAuth, loanAnnotationsRouter);
router.use("/scenarios", requireAuth, scenariosRouter);
router.use("/credentials", requireAuth, credentialsRouter);
router.use("/ltv", requireAuth, ltvRouter);
router.use("/portfolio", requireAuth, portfolioRouter);

export default router;
