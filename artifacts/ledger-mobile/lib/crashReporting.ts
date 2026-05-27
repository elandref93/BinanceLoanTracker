/**
 * Crash-reporting shim.
 *
 * We do not bundle Sentry / Bugsnag yet (would need a paid DSN + a config
 * decision the owner hasn't made). This module gives the rest of the app one
 * place to call when something goes wrong, so adding a real backend later is
 * a single-file swap instead of an audit of every error handler.
 *
 * For now we just log to the dev console. In a production TestFlight build
 * this is visible in Console.app when the device is tethered to a Mac.
 */

export type ReportableError = unknown;

export function reportError(
  err: ReportableError,
  context?: Record<string, unknown>,
): void {
  // eslint-disable-next-line no-console
  console.error("[crashReporting]", err, context ?? {});
}

export function reportMessage(
  message: string,
  context?: Record<string, unknown>,
): void {
  // eslint-disable-next-line no-console
  console.warn("[crashReporting]", message, context ?? {});
}

export function initCrashReporting(): void {
  // Hook to attach Sentry/Bugsnag init when we add it. No-op today.
}
