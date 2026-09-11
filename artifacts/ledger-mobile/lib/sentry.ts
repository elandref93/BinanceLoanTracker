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
 *
 * Expo Go does not ship the Sentry native module. Requiring `@sentry/react-native`
 * there deadlocks JS before React mounts, which leaves the BTC splash up forever.
 * Load the real SDK only in standalone / dev-client builds.
 */
import Constants, { ExecutionEnvironment } from "expo-constants";

import { isExpoGo } from "@/lib/runtime";

type SentryModule = typeof import("@sentry/react-native");

// Public client ingest key (DSN). Safe to embed: it is write-only and ships
// inside every client build by design. Overridable per-environment via
// EXPO_PUBLIC_SENTRY_DSN.
const SENTRY_DSN =
  process.env.EXPO_PUBLIC_SENTRY_DSN ||
  "https://3fae81419d7ff0214ca6b500ebf22e01@o4511503179907072.ingest.us.sentry.io/4511503195832320";

const noopSentry = {
  init: () => undefined,
  wrap: <T>(component: T): T => component,
  setContext: () => undefined,
  setTag: () => undefined,
  captureMessage: () => undefined,
  captureException: () => undefined,
  addBreadcrumb: () => undefined,
} as unknown as SentryModule;

function runningInExpoGo(): boolean {
  return (
    isExpoGo() ||
    Constants.executionEnvironment === ExecutionEnvironment.StoreClient
  );
}

function loadSentry(): SentryModule {
  if (runningInExpoGo()) {
    return noopSentry;
  }
  try {
    // Evaluated only when this branch runs. Metro still bundles the package,
    // but Expo Go never executes the native-module import.
    return require("@sentry/react-native") as SentryModule;
  } catch {
    return noopSentry;
  }
}

export const Sentry = loadSentry();

let started = false;

export function initSentry(): void {
  if (started) return;
  started = true;
  if (runningInExpoGo()) return;
  try {
    Sentry.init({
      dsn: SENTRY_DSN,
      environment: __DEV__ ? "development" : "production",
      // Errors & crashes only — performance tracing and session replay are off.
      // This is a 3-user private app: keep it well inside the free tier and
      // avoid collecting anything we don't need.
      tracesSampleRate: 0,
      sendDefaultPii: false,
      enableNative: true,
      enableNativeCrashHandling: true,
      enableAutoSessionTracking: true,
      enableWatchdogTerminationTracking: true,
      enableAppHangTracking: false,
      attachStacktrace: true,
      // Don't ship events from Metro during local development — only
      // real TestFlight/production builds report.
      enabled: !__DEV__,
    });
  } catch {
    // Observability must never break app startup.
  }
}
