import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import type { Express } from "express";

import { signSession, signWebSession } from "./sessionJwt";
import { WEB_CSRF_COOKIE, WEB_SESSION_COOKIE } from "./webSession";

process.env.SESSION_JWT_SECRET = "web-session-test-secret-32-characters-min";

type HttpResult = {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
};

function setCookies(headers: http.IncomingHttpHeaders): string[] {
  const raw = headers["set-cookie"];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function namedCookies(headers: http.IncomingHttpHeaders, name: string): string[] {
  return setCookies(headers).filter((cookie) => cookie.startsWith(`${name}=`));
}

function request(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, method, path, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

describe("browser cookie auth", { concurrency: 1 }, () => {
  let server: http.Server;
  let port = 0;

  before(async () => {
    const { default: app } = await import("../app");
    server = http.createServer(app as Express);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("removedSignInRoutes_issueNoSessionToken", async () => {
    for (const path of [
      "/api/auth/apple",
      "/api/auth/microsoft",
      "/api/auth/microsoft/start",
      "/api/auth/microsoft/callback",
      "/api/diag/crash",
    ]) {
      const response = await request(
        port,
        path.endsWith("start") || path.endsWith("callback") || path.endsWith("crash") ? "GET" : "POST",
        path,
        { "content-type": "application/json" },
        path.endsWith("apple") || path.endsWith("microsoft") ? "{}" : undefined,
      );
      assert.equal(response.status, 401, path);
      assert.equal(response.body.includes("sessionToken"), false);
      assert.equal(namedCookies(response.headers, WEB_SESSION_COOKIE).length, 0);
    }
  });

  it("bearer_doesNotAuthenticateOrSkipCsrf", async () => {
    const bearer = await signSession({ sub: "canonical-user", email: "a@example.com" });
    const web = await signWebSession({ sub: "canonical-user", email: "a@example.com" });
    const session = await request(port, "GET", "/api/auth/session", {
      authorization: `Bearer ${bearer}`,
      cookie: `${WEB_SESSION_COOKIE}=${encodeURIComponent(web)}`,
    });
    assert.equal(session.status, 401);
    assert.equal(session.body.includes("sessionToken"), false);

    const sync = await request(port, "GET", "/api/accounts/sync", {
      authorization: `Bearer ${web}`,
    });
    assert.equal(sync.status, 401);
  });

  it("cookieSession_requiresCsrfOnLogout_andClearsCookies", async () => {
    const web = await signWebSession({ sub: "canonical-user", email: "a@example.com" });
    const csrf = "csrf-token-value";
    const cookie = `${WEB_SESSION_COOKIE}=${encodeURIComponent(web)}; ${WEB_CSRF_COOKIE}=${csrf}`;
    const session = await request(port, "GET", "/api/auth/session", { cookie });
    assert.equal(session.status, 200);
    const body = JSON.parse(session.body) as { sessionToken?: string; user?: { sub?: string } };
    assert.equal(body.sessionToken, undefined);
    assert.equal(body.user?.sub, "canonical-user");
    assert.equal(session.body.includes("canonical-user"), true);

    const missingCsrf = await request(port, "POST", "/api/auth/logout", { cookie });
    assert.equal(missingCsrf.status, 403);

    const logout = await request(port, "POST", "/api/auth/logout", {
      cookie,
      "x-csrf-token": csrf,
    });
    assert.equal(logout.status, 204);
    const cleared = namedCookies(logout.headers, WEB_SESSION_COOKIE);
    assert.equal(cleared.length, 1);
    assert.match(cleared[0] ?? "", /Secure/);
    assert.match(cleared[0] ?? "", /HttpOnly/);
    assert.match(cleared[0] ?? "", /SameSite=Lax/);
    assert.equal((cleared[0] ?? "").toLowerCase().includes("domain="), false);
    assert.match(cleared[0] ?? "", /^__Host-ledger_session=/);
  });
});
