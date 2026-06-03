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
// rejection handlers are installed as early as possible.
initSentry();

export { Sentry };
