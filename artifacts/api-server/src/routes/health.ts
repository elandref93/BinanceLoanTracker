import { Router, type IRouter } from "express";
import { constants as fsConstants } from "node:fs";
import { promises as fs } from "node:fs";
import { HealthCheckResponse, ReadinessCheckResponse } from "@workspace/api-zod";
import { ensureDataDir } from "../lib/dataDir";
import { logger } from "../lib/logger";
import { aggregateReadiness, microsoftConfigCheck } from "../lib/readiness";
import { isCryptoConfigured } from "../lib/secretCrypto";

const router: IRouter = Router();

// Liveness — returns 200 only when the server has the env vars it needs to
// actually do work. Azure App Service uses this for its health probe; if it
// returns non-200 the instance is recycled. Keep it cheap (no upstream
// network calls): a JWT signing key is the bare minimum. Apple bundle id is
// not a liveness input; a missing mobile setting must not recycle the process.
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
  const version = process.env.GIT_COMMIT ?? "2026-09-10-apple-identity-link";
  res.json({ ...data, version });
});

// Readiness is separate from liveness on purpose. Azure App Service probes
// /api/healthz and recycles the instance when that probe is non-200. This
// route may return 503 when web-only configuration is missing, and it must
// not be set as the App Service health check path.
router.get("/readyz", async (_req, res) => {
  const checks = {
    encryptionKey: isCryptoConfigured() ? ("ok" as const) : ("missing" as const),
    dataDir: await dataDirCheck(),
    microsoft: microsoftConfigCheck(process.env),
  };
  const status = aggregateReadiness(checks);
  const body = ReadinessCheckResponse.parse({ status, checks });
  if (status !== "ready") {
    logger.warn(
      { op: "readyz", status, checks },
      "readyz not ready",
    );
  }
  res.status(status === "ready" ? 200 : 503).json(body);
});

async function dataDirCheck(): Promise<"ok" | "unavailable"> {
  try {
    const dir = await ensureDataDir();
    await fs.access(dir, fsConstants.W_OK);
    return "ok";
  } catch {
    logger.warn(
      { op: "readyz", check: "dataDir" },
      "readiness data directory unavailable",
    );
    return "unavailable";
  }
}

export default router;
