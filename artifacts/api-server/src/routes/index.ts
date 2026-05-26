import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { getAuth } from "@clerk/express";
import healthRouter from "./health";
import binanceRouter from "./binance";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.use(healthRouter);

// Decode a JWT payload (header.payload.signature) WITHOUT verifying its
// signature. Used purely for diagnostic logging on auth failure so we can
// distinguish "no token" from "wrong Clerk instance" from "expired token".
//
// Returns `null` for any malformed input. Never throws.
function unsafeDecodeJwt(
  token: string,
): { iss?: string; azp?: string; exp?: number; kid?: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const decode = (seg: string): Record<string, unknown> => {
      // base64url → base64, pad to multiple of 4
      const b64 = seg.replace(/-/g, "+").replace(/_/g, "/");
      const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
      const json = Buffer.from(padded, "base64").toString("utf8");
      return JSON.parse(json) as Record<string, unknown>;
    };
    const header = decode(parts[0]);
    const payload = decode(parts[1]);
    return {
      iss: typeof payload.iss === "string" ? payload.iss : undefined,
      azp: typeof payload.azp === "string" ? payload.azp : undefined,
      exp: typeof payload.exp === "number" ? payload.exp : undefined,
      kid: typeof header.kid === "string" ? header.kid : undefined,
    };
  } catch {
    return null;
  }
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = getAuth(req);
  if (auth?.userId) {
    next();
    return;
  }

  // Diagnostic logging — captures *why* auth failed without ever logging
  // the raw token. The Authorization header itself is already redacted by
  // the pino logger config, so we only emit our parsed claims here.
  const authHeader = req.header("authorization");
  const hasAuthHeader = Boolean(authHeader);
  const bearerMatch = authHeader?.match(/^Bearer\s+(.+)$/i);
  const token = bearerMatch?.[1];

  const claims = token ? unsafeDecodeJwt(token) : null;
  const now = Math.floor(Date.now() / 1000);
  const isExpired =
    typeof claims?.exp === "number" ? claims.exp < now : undefined;

  // Reason heuristic — first match wins. "instance_mismatch" is inferred
  // when a syntactically-valid JWT is rejected by Clerk; in practice that
  // almost always means the device signed with a different Clerk instance
  // (test vs live, or different application) than the backend is verifying
  // against, so the JWKS lookup for that `kid` returns no key.
  const reason: string = !hasAuthHeader
    ? "no_authorization_header"
    : !bearerMatch
      ? "malformed_bearer_scheme"
      : !claims
        ? "malformed_jwt"
        : isExpired
          ? "expired_token"
          : "instance_or_signature_mismatch";

  logger.warn(
    {
      route: req.path,
      reason,
      hasAuthHeader,
      // Claim shape: helps spot test-vs-live and proxy issues.
      // - iss "https://clerk.<your-prod-domain>" vs ".clerk.accounts.dev"
      //   is the smoking gun for instance mismatch.
      // - azp identifies which front-end app the token was minted for.
      // - kid identifies the signing keypair; if backend's JWKS doesn't
      //   include this kid we'll see verification fail every time.
      iss: claims?.iss,
      azp: claims?.azp,
      kid: claims?.kid,
      exp: claims?.exp,
      isExpired,
      sessionId: auth?.sessionId ?? null,
    },
    "auth rejected — request denied with 401",
  );

  res.status(401).json({ error: "Unauthorized" });
}

router.use(requireAuth, binanceRouter);

export default router;
