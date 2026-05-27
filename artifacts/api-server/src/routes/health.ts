import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

// Liveness — returns 200 only when the server has the env vars it needs to
// actually do work. Azure App Service uses this for its health probe; if it
// returns non-200 the instance is recycled. Keep it cheap (no upstream
// network calls): JWT signing keys + Apple audience are the bare minimum.
router.get("/healthz", (_req, res) => {
  const missing: string[] = [];
  const secret = process.env.SESSION_JWT_SECRET;
  if (!secret || secret.length < 32) missing.push("SESSION_JWT_SECRET");
  if (!process.env.APPLE_BUNDLE_ID) missing.push("APPLE_BUNDLE_ID");

  if (missing.length > 0) {
    res.status(503).json({
      status: "degraded",
      missing,
    });
    return;
  }

  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

export default router;
