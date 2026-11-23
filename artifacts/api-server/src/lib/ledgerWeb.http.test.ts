import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { Express } from "express";

delete process.env.SENTRY_DSN;
delete process.env.CLERK_SECRET_KEY;
process.env.NODE_ENV = "production";
process.env.EDGE_ACCESS_GATE = "on";
process.env.ALLOWED_CLIENT_IPS = "203.0.113.50";
process.env.SESSION_JWT_SECRET = "ledger-web-test-secret-32-characters-min";
process.env.VITE_API_BASE_URL = "https://evil.example";
process.env.CLERK_PUBLISHABLE_KEY = "pk_test_public_only";

const webRoot = mkdtempSync(path.join(tmpdir(), "ledger-web-"));
mkdirSync(path.join(webRoot, "assets"));
writeFileSync(
  path.join(webRoot, "index.html"),
  "<!doctype html><head><title>LedgerIndexMarker</title></head><body><div id=\"root\"></div></body>",
);
writeFileSync(path.join(webRoot, "assets", "app.js"), "ledger-asset-marker");
process.env.LEDGER_WEB_ROOT = webRoot;

type HttpResult = { status: number; body: string };

function request(port: number, method: string, requestPath: string): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, method, path: requestPath }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

describe("ledger web behind the edge gate", { concurrency: 1 }, () => {
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
    rmSync(webRoot, { recursive: true, force: true });
  });

  it("deniedClient_rootAndAssets_are403WithoutHtml", async () => {
    process.env.ALLOWED_CLIENT_IPS = "203.0.113.50";
    const root = await request(port, "GET", "/");
    assert.equal(root.status, 403);
    assert.equal(root.body.includes("LedgerIndexMarker"), false);
    assert.equal(root.body.includes("ledger-asset-marker"), false);
    assert.equal(root.body.includes("evil.example"), false);
    assert.match(root.body, /Forbidden/);

    const asset = await request(port, "GET", "/assets/app.js");
    assert.equal(asset.status, 403);
    assert.equal(asset.body.includes("ledger-asset-marker"), false);

    const route = await request(port, "GET", "/sign-in");
    assert.equal(route.status, 403);
    assert.equal(route.body.includes("LedgerIndexMarker"), false);
  });

  it("deniedClient_healthz_staysOpenAndStatusOnly", async () => {
    process.env.ALLOWED_CLIENT_IPS = "203.0.113.50";
    const health = await request(port, "GET", "/api/healthz");
    assert.equal(health.status, 200);
    assert.equal(health.body, '{"status":"ok"}');
    assert.equal(health.body.includes("version"), false);
  });

  it("allowedClient_servesIndexForRoutes_andDoesNotSwallowApi", async () => {
    process.env.ALLOWED_CLIENT_IPS = "127.0.0.1";
    const root = await request(port, "GET", "/");
    assert.equal(root.status, 200);
    assert.equal(root.body.includes("LedgerIndexMarker"), true);
    assert.match(root.body, /"apiBaseUrl":""/);
    assert.equal(root.body.includes("pk_test_public_only"), true);
    assert.equal(root.body.includes("evil.example"), false);

    const route = await request(port, "GET", "/portfolio/btc");
    assert.equal(route.status, 200);
    assert.equal(route.body.includes("LedgerIndexMarker"), true);

    const asset = await request(port, "GET", "/assets/app.js");
    assert.equal(asset.status, 200);
    assert.equal(asset.body, "ledger-asset-marker");

    const missing = await request(port, "GET", "/assets/missing.js");
    assert.equal(missing.status, 404);
    assert.equal(missing.body.includes("LedgerIndexMarker"), false);

    const api = await request(port, "GET", "/api/not-a-real-route");
    assert.notEqual(api.status, 200);
    assert.equal(api.body.includes("LedgerIndexMarker"), false);

    const health = await request(port, "GET", "/api/healthz");
    assert.equal(health.status, 200);
    assert.equal(health.body, '{"status":"ok"}');
  });
});
