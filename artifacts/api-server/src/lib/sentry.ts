/**
 * Sentry wiring for the api-server.
 *
 * We use @sentry/node v7 deliberately: the server is shipped as a SINGLE
 * esbuild bundle with NO node_modules at runtime (see the Dockerfile). v7 is
 * fully self-contained (no @opentelemetry/* runtime deps), so it bundles into
 * one file cleanly. v8+ requires OpenTelemetry packages that are externalized
 * in build.mjs and would be missing at runtime.
 *
 * Scope: capture unhandled server errors + uncaught exceptions/rejections to
 * the Sentry cloud dashboard, alongside the existing structured Pino logs.
 * Mobile crashes are sent to Sentry directly from the app, so we do NOT forward
 * the /api/diag/crash payloads here (that would double-report them).
 */
import * as Sentry from "@sentry/node";

// Public client ingest key (DSN). Safe to embed — write-only, ships in clients
// by design. Overridable via SENTRY_DSN.
const SENTRY_DSN =
  process.env.SENTRY_DSN ||
  "https://89c2e44f30df4acdafd2ffe248d57701@o4511503179907072.ingest.us.sentry.io/4511503185149952";

let started = false;

export function initSentry(): void {
  if (started) return;
  started = true;
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV || "production",
    // Errors only — no performance tracing for this small private service.
    tracesSampleRate: 0,
    // Financial app: never auto-collect IPs / PII. Request headers, cookies and
    // bodies (which carry session tokens and Binance/Luno API keys) are also
    // excluded at the requestHandler level in app.ts.
    sendDefaultPii: false,
    // Defense-in-depth: strip any query string from the captured request URL so
    // a secret can never leak through a query param.
    beforeSend(event) {
      if (event.request?.url) {
        event.request.url = event.request.url.split("?")[0];
      }
      return event;
    },
  });
}

// Initialise on import so the process-level uncaught-exception / unhandled-
// rejection handlers are installed as early as possible — but ONLY in production
// (or when SENTRY_DSN is explicitly set, e.g. to test from dev). This keeps ALL
// backend Sentry traffic out of local development by default, so the shared
// Sentry project only ever sees real production events.
if (process.env.NODE_ENV === "production" || process.env.SENTRY_DSN) {
  initSentry();
}

// Scalar log fields that are safe to attach to a Sentry event. Deliberately a
// whitelist: Pino's `redact` only scrubs Pino's OWN serialized output, so we
// must never hand the raw log object to Sentry (it could carry headers, cookies
// or bodies). None of these keys ever hold a secret.
const SAFE_LOG_FIELDS = [
  "op",
  "endpoint",
  "path",
  "accountId",
  "walletId",
  "reason",
  "code",
  "statusCode",
  "isIsolated",
] as const;

// Marks an Error as already sent to Sentry so the same object — logged at a low
// level and then again by the final error handler after it rethrows — produces
// exactly one Sentry event instead of two.
const SENTRY_CAPTURED = Symbol.for("ledger.sentry.captured");

/**
 * Mirror a Pino error/fatal log into Sentry so that *handled* failures — caught,
 * logged, and swallowed deep in the exchange clients (e.g. a single account's
 * loan fetch failing and returning []) — surface in Sentry too, not just
 * unhandled crashes. Wired in from the logger's `logMethod` hook (production
 * only). Must never throw: telemetry can't be allowed to break logging.
 */
export function captureLogEvent(level: number, args: readonly unknown[]): void {
  try {
    const sentryLevel: Sentry.SeverityLevel = level >= 60 ? "fatal" : "error";
    const first = args[0];
    let err: unknown;
    const extra: Record<string, unknown> = {};
    let message: string | undefined;

    // Pino call shapes: logger.error({ err, ...fields }, "message")
    //                or logger.error("message")
    if (first && typeof first === "object") {
      const obj = first as Record<string, unknown>;
      err = obj.err ?? obj.error;
      for (const key of SAFE_LOG_FIELDS) {
        if (obj[key] !== undefined) extra[key] = obj[key];
      }
      message = typeof args[1] === "string" ? args[1] : undefined;
    } else if (typeof first === "string") {
      message = first;
    }
    if (message) extra.message = message;

    // Don't mirror mobile crash intake (`POST /api/diag/crash`): the app already
    // reports those to Sentry directly, so mirroring the backend intake log
    // would double-count every client crash. It's still logged for Azure.
    if (extra.op === "diag.crash") return;

    // Dedupe rethrow paths: a helper often logs an error then rethrows, so the
    // same Error is logged again by the final error handler. Capture it once.
    if (err instanceof Error) {
      const tagged = err as Error & { [SENTRY_CAPTURED]?: true };
      if (tagged[SENTRY_CAPTURED]) return;
      try {
        Object.defineProperty(tagged, SENTRY_CAPTURED, {
          value: true,
          enumerable: false,
        });
      } catch {
        // Frozen error — fall through and capture anyway.
      }
    }

    Sentry.withScope((scope) => {
      scope.setLevel(sentryLevel);
      if (Object.keys(extra).length > 0) scope.setContext("log", extra);
      if (err instanceof Error) {
        Sentry.captureException(err);
      } else {
        Sentry.captureMessage(message ?? "Logged error event");
      }
    });
  } catch {
    // Telemetry must never break logging.
  }
}

export { Sentry };
