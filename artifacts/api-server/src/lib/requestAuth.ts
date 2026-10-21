import type { NextFunction, Request, Response } from "express";

import { logger } from "./logger";
import { verifyWebSession, signWebSession, type SessionClaims } from "./sessionJwt";
import {
  WEB_CSRF_COOKIE,
  WEB_SESSION_COOKIE,
  clearWebSessionCookies,
  isUnsafeMethod,
  setCsrfCookie,
  setWebSessionCookie,
  tokensMatch,
  newCsrfToken,
} from "./webSession";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      authVia?: "bearer" | "cookie" | "bearer_invalid";
      sessionClaims?: SessionClaims;
    }
  }
}

export type ResolvedAuth =
  | { kind: "bearer"; claims: SessionClaims }
  | { kind: "cookie"; claims: SessionClaims }
  | { kind: "bearer_invalid" }
  | { kind: "none" };

const BEARER = /^Bearer\s+(\S+)$/i;

function cookieValue(req: Request, name: string): string | undefined {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * The browser session is the cookie only. An `Authorization` bearer is never
 * a Ledger session: the removed phone app used that header, and accepting it
 * would skip the CSRF check. A bearer also does not fall through onto a
 * cookie, so a client cannot send `Bearer junk` and still mutate with the
 * cookie. Clerk's own session token is read by `/api/auth/clerk`, not here.
 */
export async function resolveRequestAuth(req: Request): Promise<ResolvedAuth> {
  const header = req.header("authorization");
  if (header && BEARER.test(header)) {
    return { kind: "bearer_invalid" };
  }

  const session = cookieValue(req, WEB_SESSION_COOKIE);
  if (!session) return { kind: "none" };
  const result = await verifyWebSession(session);
  if (!result.ok) return { kind: "none" };
  return { kind: "cookie", claims: result.claims };
}

function isLogout(req: Request): boolean {
  const path = req.originalUrl.split("?")[0];
  return path === "/api/auth/logout";
}

/**
 * Cookie-authenticated state changes must echo the double-submit token.
 * Logout is included. Bearer requests are not.
 */
export function attachBrowserAuth() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const resolved = await resolveRequestAuth(req);
      req.authVia = resolved.kind === "none" ? undefined : resolved.kind;
      if (resolved.kind === "bearer" || resolved.kind === "cookie") {
        req.userId = resolved.claims.sub;
        req.sessionClaims = resolved.claims;
      }

      if (isUnsafeMethod(req.method) && resolved.kind === "cookie") {
        const header = req.header("x-csrf-token");
        if (!tokensMatch(cookieValue(req, WEB_CSRF_COOKIE), header)) {
          logger.warn(
            { route: req.path, reason: "csrf_missing" },
            "cookie-authenticated mutation rejected — CSRF token missing",
          );
          res.status(403).json({ error: "CSRF token missing" });
          return;
        }
      }

      if (resolved.kind === "cookie" && !isLogout(req)) {
        const fresh = await signWebSession({
          sub: resolved.claims.sub,
          email: resolved.claims.email,
          name: resolved.claims.name,
        });
        setWebSessionCookie(res, fresh);
        // Slide the CSRF cookie with the session. Reuse the current token so
        // other tabs keep a match; mint one only when it is missing.
        const csrf = cookieValue(req, WEB_CSRF_COOKIE);
        setCsrfCookie(res, csrf ?? newCsrfToken());
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

export function clearBrowserSession(res: Response): void {
  clearWebSessionCookies(res);
}
