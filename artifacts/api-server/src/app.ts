import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import type { Logger } from "pino";
import cookieParser from "cookie-parser";
import { isBrowserOriginAllowed } from "./lib/browserOrigin";
import { httpLogSerializers, logger } from "./lib/logger";
import { clerkMiddleware } from "@clerk/express";
import { attachBrowserAuth } from "./lib/requestAuth";
import { Sentry } from "./lib/sentry";

const app: Express = express();

// Trust the Azure App Service / front-door proxy so req.ip reflects the real
// client (used by the rate limiter below).
app.set("trust proxy", 1);

// Sentry request context must be the very first middleware. We attach only the
// method + path — never headers, cookies, query string or body — so session
// tokens and Binance/Luno API keys are never sent to Sentry. v11 has no
// Handlers.requestHandler; the isolation scope keeps concurrent requests apart.
app.use((req, _res, next) => {
  Sentry.withIsolationScope((scope) => {
    const pathOnly = (req.originalUrl || req.url || "").split("?")[0];
    scope.addEventProcessor((event) => {
      event.request = {
        method: req.method,
        url: pathOnly,
      };
      delete event.user;
      return event;
    });
    next();
  });
});

/** Request log used by the API. Tests pass a capturing logger; production uses the shared one. */
export function httpRequestLogger(baseLogger: Logger = logger) {
  return pinoHttp({
    logger: baseLogger,
    serializers: httpLogSerializers,
  });
}

app.use(httpRequestLogger());

// CORS: pin to the configured front-end origins instead of reflecting any
// Origin header. The mobile app talks server-to-server (no Origin header at
// all, which `cors` lets through), so this primarily protects against
// browser-side abuse if the API URL ever leaks.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    credentials: true,
    origin(origin, cb) {
      // No Origin: non-browser clients. A browser Origin must be listed.
      // Development also accepts a private-network host so the Vite proxy can
      // forward a phone page on the LAN. An empty allow-list does not reflect
      // a public origin.
      if (isBrowserOriginAllowed(origin, ALLOWED_ORIGINS, process.env.NODE_ENV)) {
        return cb(null, true);
      }
      return cb(new Error("CORS: origin not allowed"));
    },
  }),
);

// Defensive headers for any browser surface that touches the API.
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});

app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: true, limit: "256kb" }));
app.use(cookieParser());

// Lightweight per-IP rate limiter — no external dep. Buckets:
// - sign-in exchange:  10 req / 5 min
// - session probe:     60 req / min
// - default:           120 req / min
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function rateLimit(opts: { max: number; windowMs: number; keyPrefix: string }) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = (req.ip ?? req.socket.remoteAddress ?? "unknown").replace(
      /^::ffff:/,
      "",
    );
    const key = `${opts.keyPrefix}:${ip}`;
    const now = Date.now();
    const b = buckets.get(key);
    if (!b || b.resetAt < now) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      next();
      return;
    }
    b.count += 1;
    if (b.count > opts.max) {
      res.setHeader(
        "Retry-After",
        Math.ceil((b.resetAt - now) / 1000).toString(),
      );
      res.status(429).json({ error: "Too many requests" });
      return;
    }
    next();
  };
}

// Janitor: drop expired buckets every 5 min so the Map can't grow unbounded.
setInterval(
  () => {
    const now = Date.now();
    for (const [k, b] of buckets) if (b.resetAt < now) buckets.delete(k);
  },
  5 * 60 * 1000,
).unref();

// Only the sign-in exchange gets the strict bucket. The session probe runs on
// every app focus, so it shares the default bucket and a failed probe is never
// treated as a sign-out by the web app.
app.use(
  "/api/auth/clerk",
  rateLimit({ max: 10, windowMs: 5 * 60 * 1000, keyPrefix: "auth" }),
);
app.use(
  "/api/auth/session",
  rateLimit({ max: 60, windowMs: 60 * 1000, keyPrefix: "session" }),
);
app.use(
  "/api",
  rateLimit({ max: 120, windowMs: 60 * 1000, keyPrefix: "api" }),
);

// Clerk attaches its own auth object when a Clerk session cookie is present.
// Mobile requests carry a Ledger bearer; those skip Clerk so an app token is
// not parsed as a Clerk session. A Clerk failure does not replace that bearer.
if (process.env.CLERK_SECRET_KEY) {
  const clerkAuth = clerkMiddleware();
  app.use((req, res, next) => {
    if (req.header("authorization")) {
      next();
      return;
    }
    clerkAuth(req, res, (err) => {
      if (err) {
        logger.warn(
          { err, op: "auth.clerk.middleware" },
          "clerk middleware did not attach auth",
        );
        next();
        return;
      }
      next();
    });
  });
}

app.use("/api", attachBrowserAuth());
app.use("/api", router);

// Last-resort error handler: sanitize so we never leak stack traces or
// internal error messages to the client. Per-route handlers (e.g. binance)
// still get first crack at their own errors.
//
// Sentry capture happens centrally via the logger's `logMethod` hook (see
// lib/logger.ts), so this `logger.error` both records the structured log AND
// reports the error to Sentry with the request scope set up by the
// isolation-scope middleware above — no separate Sentry error middleware needed.
app.use(
  (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    // Derive the status FIRST so we can log at the right level. Upstream
    // middleware (e.g. body-parser on a malformed JSON body, an oversized
    // payload, or a rejected CORS origin) attaches a client-error status —
    // that's a 4xx, not a server fault.
    const raw =
      (err as { status?: unknown; statusCode?: unknown } | null) ?? {};
    const status =
      typeof raw.status === "number"
        ? raw.status
        : typeof raw.statusCode === "number"
          ? raw.statusCode
          : 500;
    const isClientError = status >= 400 && status < 500;

    // The logger mirrors `error`/`fatal` into Sentry (see lib/logger.ts). A
    // malformed request body is client-driven garbage, not a code defect, so
    // logging it at `error` floods Sentry with non-actionable issues (e.g.
    // "SyntaxError: Expected property name ... in JSON"). Log client errors at
    // `warn` — they stay visible in the Azure log stream but never create a
    // Sentry issue. Genuine 5xx server faults still log at `error` → Sentry.
    if (isClientError) {
      logger.warn({ err, path: req.path, status }, "client request error");
    } else {
      logger.error({ err, path: req.path, status }, "unhandled route error");
    }

    if (res.headersSent) return;
    // We never echo `err.message`: it can contain raw request content, so the
    // response stays generic.
    if (isClientError) {
      res.status(status).json({ error: "Bad request" });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  },
);

export default app;
