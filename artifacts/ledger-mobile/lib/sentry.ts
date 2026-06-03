/**
 * Sentry wiring for the Ledger app.
 *
 * Sentry is the cloud crash/error dashboard. Unlike the on-device reporter in
 * `crashReporting.ts`, the native Sentry SDK can capture NATIVE iOS crashes
 * (the class of crash the JS reporter physically cannot see) in addition to JS
 * errors. The two are complementary:
 *   - crashReporting.ts → in-app Diagnostics screen + backend log stream.
 *   - Sentry            → cloud dashboard, including native crashes.
 *
 * `reportError` / `reportFatal` / `reportMessage` in crashReporting.ts forward
 * into Sentry, so every call site we already instrumented lands in both places.
 */
import * as Sentry from "@sentry/react-native";

// Public client ingest key (DSN). Safe to embed: it is write-only and ships
// inside every client build by design. Overridable per-environment via
// EXPO_PUBLIC_SENTRY_DSN.
const SENTRY_DSN =
  process.env.EXPO_PUBLIC_SENTRY_DSN ||
  "https://3fae81419d7ff0214ca6b500ebf22e01@o4511503179907072.ingest.us.sentry.io/4511503195832320";

let started = false;

export function initSentry(): void {
  if (started) return;
  started = true;
  try {
    Sentry.init({
      dsn: SENTRY_DSN,
      environment: __DEV__ ? "development" : "production",
      // Errors & crashes only — performance tracing and session replay are off.
      // This is a 3-user private app: keep it well inside the free tier and
      // avoid collecting anything we don't need.
      tracesSampleRate: 0,
      sendDefaultPii: false,
      // Don't ship events from Metro / Expo Go during local development — only
      // real TestFlight/production builds report. Avoids dev noise and keeps
      // the web preview bundle from emitting events.
      enabled: !__DEV__,
    });
  } catch {
    // Observability must never break app startup.
  }
}

export { Sentry };
