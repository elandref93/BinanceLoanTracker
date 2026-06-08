/**
 * Tiny app-wide hook for "the session token was rejected" (HTTP 401).
 *
 * Every authenticated API path (the central api-client-react fetch plus the
 * account / settings / credentials sync modules) calls `notifyAuthFailure()`
 * when the server returns 401. SessionContext registers a handler that signs
 * the user out so they are re-prompted to sign in.
 *
 * Why this matters: the stored session token has no client-side expiry check,
 * so without this a dead token (expired, or invalidated by the RS256 signing
 * cutover) would silently fail every request with no path back to a working
 * state.
 */
type AuthFailureHandler = () => void;

let handler: AuthFailureHandler | null = null;

export function setAuthFailureHandler(fn: AuthFailureHandler | null): void {
  handler = fn;
}

export function notifyAuthFailure(): void {
  try {
    handler?.();
  } catch {
    // A failing handler must never break the request path that reported the 401.
  }
}
