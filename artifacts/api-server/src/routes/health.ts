import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Liveness — returns 200 only when the server has the env vars it needs to
// actually do work. Azure App Service uses this for its health probe; if it
// returns non-200 the instance is recycled. Keep it cheap (no upstream
// network calls): JWT signing keys + Apple audience are the bare minimum.
router.get("/healthz", (_req, res) => {
  const missing: string[] = [];
  // A signing key is required — either the RS256 private key (preferred, used
  // for the Azure Easy Auth custom-OIDC merge) OR the legacy HS256 secret.
  const hasRsaKey = Boolean(process.env.SESSION_JWT_PRIVATE_KEY?.trim());
  const secret = process.env.SESSION_JWT_SECRET;
  const hasHsSecret = Boolean(secret && secret.length >= 32);
  if (!hasRsaKey && !hasHsSecret) {
    missing.push("SESSION_JWT_PRIVATE_KEY or SESSION_JWT_SECRET");
  }
  if (!process.env.APPLE_BUNDLE_ID) missing.push("APPLE_BUNDLE_ID");

  if (missing.length > 0) {
    logger.warn(
      { op: "health", status: 503, missing },
      "healthz degraded — required env vars missing",
    );
    res.status(503).json({
      status: "degraded",
      missing,
    });
    return;
  }

  const data = HealthCheckResponse.parse({ status: "ok" });
  // `version` is a deploy marker so we can confirm which build is actually
  // live on Azure (the health schema only validates `status`; the extra field
  // rides along in the JSON). Prefer the CI-injected commit, fall back to a
  // hand-bumped tag that changes whenever the backend is meaningfully updated.
  const version = process.env.GIT_COMMIT ?? "2026-06-02-holdings-price-resilient";
  res.json({ ...data, version });
});

export default router;
