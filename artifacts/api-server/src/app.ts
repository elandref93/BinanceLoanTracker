import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Trust the Azure App Service / front-door proxy so req.ip reflects the real
// client (used by the rate limiter below).
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

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
      // Server-to-server / native fetch — no Origin → allow.
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.length === 0) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
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

// Lightweight per-IP rate limiter — no external dep. Two buckets:
// - sign-in:  10 req / 5 min
// - default:  120 req / min
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

app.use(
  "/api/auth",
  rateLimit({ max: 10, windowMs: 5 * 60 * 1000, keyPrefix: "auth" }),
);
app.use(
  "/api",
  rateLimit({ max: 120, windowMs: 60 * 1000, keyPrefix: "api" }),
);

app.use("/api", router);

// Last-resort error handler: sanitize so we never leak stack traces or
// internal error messages to the client. Per-route handlers (e.g. binance)
// still get first crack at their own errors.
app.use(
  (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    logger.error({ err, path: req.path }, "unhandled route error");
    if (res.headersSent) return;
    res.status(500).json({ error: "Internal server error" });
  },
);

export default app;
