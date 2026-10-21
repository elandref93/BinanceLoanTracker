import crypto from "node:crypto";
import type { Response } from "express";

/**
 * Browser session cookies.
 *
 * `__Host-` requires Secure, Path=/, and no Domain attribute. Do not add a
 * Domain attribute.
 *
 * Cross-site cookies (the SPA on one host and /api on another, including
 * Azure Static Web Apps calling azurewebsites.net) fail in Safari. Production
 * must proxy /api on the same host as the web app. A same-origin Vite dev
 * proxy is enough locally: Chromium and current Safari treat http://localhost
 * as a secure context, so the Secure flag is still stored.
 */
export const WEB_SESSION_COOKIE = "__Host-ledger_session";
export const WEB_CSRF_COOKIE = "__Host-ledger_csrf";
export const WEB_OAUTH_COOKIE = "__Host-ledger_oauth";

/** Idle window for the browser cookie. Shorter than the mobile 30-day bearer. */
export const WEB_SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
export const WEB_SESSION_IDLE_SECONDS = WEB_SESSION_IDLE_MS / 1000;
const OAUTH_COOKIE_SECONDS = 10 * 60;

/**
 * True once `nowMs` is at least one idle window after the last activity.
 * Activity re-issues the cookie, so this is a sliding timeout.
 */
export function isWebSessionIdleExpired(lastActivityMs: number, nowMs: number): boolean {
  return nowMs - lastActivityMs >= WEB_SESSION_IDLE_MS;
}

export function newCsrfToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function tokensMatch(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function serialize(
  name: string,
  value: string,
  options: { httpOnly: boolean; maxAgeSeconds: number },
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${options.maxAgeSeconds}`,
  ];
  if (options.httpOnly) parts.push("HttpOnly");
  return parts.join("; ");
}

function clear(name: string, httpOnly: boolean): string {
  const parts = [`${name}=`, "Path=/", "Secure", "SameSite=Lax", "Max-Age=0"];
  if (httpOnly) parts.push("HttpOnly");
  return parts.join("; ");
}

function append(res: Response, cookie: string): void {
  res.appendHeader("Set-Cookie", cookie);
}

export function setWebSessionCookie(res: Response, token: string): void {
  append(res, serialize(WEB_SESSION_COOKIE, token, {
    httpOnly: true,
    maxAgeSeconds: WEB_SESSION_IDLE_SECONDS,
  }));
}

export function setCsrfCookie(res: Response, token: string): void {
  // Not HttpOnly: each tab reads this cookie and echoes it in a header.
  // The session JWT stays HttpOnly and is never placed in browser storage.
  append(res, serialize(WEB_CSRF_COOKIE, token, {
    httpOnly: false,
    maxAgeSeconds: WEB_SESSION_IDLE_SECONDS,
  }));
}

export function setOauthStateCookie(res: Response, state: string): void {
  append(res, serialize(WEB_OAUTH_COOKIE, state, {
    httpOnly: true,
    maxAgeSeconds: OAUTH_COOKIE_SECONDS,
  }));
}

export function clearOauthStateCookie(res: Response): void {
  append(res, clear(WEB_OAUTH_COOKIE, true));
}

export function clearWebSessionCookies(res: Response): void {
  append(res, clear(WEB_SESSION_COOKIE, true));
  append(res, clear(WEB_CSRF_COOKIE, false));
  append(res, clear(WEB_OAUTH_COOKIE, true));
}

export function isUnsafeMethod(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}
