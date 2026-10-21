/** Must match the API `WEB_CSRF_COOKIE`. The session cookie is HttpOnly and is not read here. */
export const CSRF_COOKIE_NAME = "__Host-ledger_csrf";

export interface BrowserUser {
  sub: string;
  email: string | null;
  name: string | null;
}

export function readCookieValue(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    const raw = trimmed.slice(eq + 1);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

export function csrfHeaders(method: string, cookieHeader: string): Record<string, string> {
  const verb = method.toUpperCase();
  if (verb === "GET" || verb === "HEAD" || verb === "OPTIONS") return {};
  const token = readCookieValue(cookieHeader, CSRF_COOKIE_NAME);
  if (!token) return {};
  return { "X-CSRF-Token": token };
}

const CLERK_EXCHANGE_CODES = new Set([
  "not_allowed",
  "no_profile",
  "ambiguous",
  "not_configured",
  "signing_unavailable",
]);

/**
 * Maps the Clerk exchange response to a sign-in query code.
 * A missing signing key and a generic 401 stay off the allowlist message.
 */
export async function clerkExchangeFailure(response: {
  status: number;
  json: () => Promise<unknown>;
}): Promise<string> {
  let code = "";
  try {
    const body = await response.json();
    if (body && typeof body === "object" && "error" in body) {
      const error = (body as { error: unknown }).error;
      if (typeof error === "string") code = error;
    }
  } catch {
    code = "";
  }
  if (code === "no_profile" || code === "ambiguous") return "not_allowed";
  if (CLERK_EXCHANGE_CODES.has(code)) return code;
  if (response.status === 503) return "not_configured";
  return "sign_in_failed";
}

export function clerkSignInStatusMessage(error: string | null): string | null {
  if (error === "signing_unavailable") {
    return "The server signing key is missing, so no session was created.";
  }
  if (error === "no_profile" || error === "ambiguous" || error === "not_allowed") {
    return "This account is not allowed to use Ledger. No session was created.";
  }
  if (error === "not_configured") {
    return "Clerk sign-in is not configured. No session was created.";
  }
  if (error === "session_expired") {
    return "The session ended. Sign in again. No session is stored in this browser.";
  }
  if (error === "sign_in_failed") {
    return "Sign in did not finish. No session was created.";
  }
  return null;
}

/**
 * Only a confirmed 401 (a null user) means signed out. A failed check
 * (network, 429, 5xx) is "unreachable": the app keeps the last known user
 * on screen and retries, so a flaky connection never looks like a sign-out.
 */
export function sessionGate(input: {
  pending: boolean;
  failed: boolean;
  user: { sub: string } | null;
  hadUser?: boolean;
}): "pending" | "unreachable" | "signed-out" | "signed-in" {
  if (input.user) return "signed-in";
  if (input.pending) return "pending";
  if (input.failed) return input.hadUser ? "signed-in" : "unreachable";
  return "signed-out";
}

export class SessionCheckError extends Error {
  readonly status: number | null;
  constructor(status: number | null) {
    super(status == null ? "Session check could not reach the server" : `Session check failed (${status})`);
    this.name = "SessionCheckError";
    this.status = status;
  }
}

/** Retry policy for the session probe: never retry a definitive answer, back off otherwise. */
export function shouldRetrySessionCheck(failureCount: number, error: unknown): boolean {
  if (error instanceof SessionCheckError && error.status != null && error.status >= 400 && error.status < 500 && error.status !== 429) {
    return false;
  }
  return failureCount < 8;
}

export function sessionRetryDelayMs(attempt: number): number {
  return Math.min(30_000, 1_000 * 2 ** attempt);
}

export function parseBrowserSession(body: unknown): BrowserUser {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid session response");
  }
  const record = body as Record<string, unknown>;
  if ("sessionToken" in record) {
    throw new Error("Session token must not be returned to the browser");
  }
  const user = record.user;
  if (!user || typeof user !== "object") {
    throw new Error("Invalid session response");
  }
  const fields = user as Record<string, unknown>;
  if ("sessionToken" in fields) {
    throw new Error("Session token must not be returned to the browser");
  }
  if (typeof fields.sub !== "string" || fields.sub.length === 0) {
    throw new Error("Invalid session response");
  }
  return {
    sub: fields.sub,
    email: typeof fields.email === "string" ? fields.email : null,
    name: typeof fields.name === "string" ? fields.name : null,
  };
}

export async function fetchBrowserSession(
  apiBaseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BrowserUser | null> {
  let response: Response;
  try {
    response = await fetchImpl(`${apiBaseUrl}/api/auth/session`, {
      credentials: "include",
      headers: { accept: "application/json" },
    });
  } catch {
    throw new SessionCheckError(null);
  }
  if (response.status === 401) return null;
  if (!response.ok) throw new SessionCheckError(response.status);
  return parseBrowserSession(await response.json());
}

export async function logoutBrowser(
  apiBaseUrl: string,
  cookieHeader: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const response = await fetchImpl(`${apiBaseUrl}/api/auth/logout`, {
    method: "POST",
    credentials: "include",
    headers: csrfHeaders("POST", cookieHeader),
  });
  return response.status === 204;
}
