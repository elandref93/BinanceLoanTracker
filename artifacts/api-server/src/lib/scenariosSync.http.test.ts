import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import express, { type Express, type NextFunction, type Request, type Response } from "express";

import "../lib/requestAuth";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "ledger-scenarios-"));
process.env.ACCOUNT_SYNC_DIR = dataDir;

const { default: scenariosRouter } = await import("../routes/scenarios");

type HttpResult = { status: number; body: string };

function request(
  port: number,
  method: string,
  urlPath: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, method, path: urlPath, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") });
      });
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function blobPath(userId: string): string {
  const hash = crypto.createHash("sha256").update(userId).digest("hex");
  return path.join(dataDir, `${hash}.scenarios.json`);
}

const userHeaders = {
  "content-type": "application/json",
  "x-test-user": "scenario-sync-user",
};

describe("scenario sync", { concurrency: 1 }, () => {
  let server: http.Server;
  let port = 0;

  before(async () => {
    const app: Express = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
      const user = req.header("x-test-user");
      if (user) req.userId = user;
      next();
    });
    app.use("/api/scenarios", scenariosRouter);
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await rm(dataDir, { recursive: true, force: true });
  });

  it("putAndGet_roundTripAndConflict_keepsUnknownFieldsAndDropsSecrets", async () => {
    const missing = await request(port, "GET", "/api/scenarios/sync", userHeaders);
    assert.equal(missing.status, 404);

    const original = {
      id: "scn_1",
      name: "Desk",
      inputs: { btcGrowth: 29, apiSecret: "nested-secret", deskNote: "keep-input" },
      note: "keep-scenario",
      apiKey: "top-secret",
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    };
    const created = await request(
      port,
      "PUT",
      "/api/scenarios/sync",
      userHeaders,
      JSON.stringify({
        updatedAt: "2020-01-02T00:00:00.000Z",
        scenarios: [original],
      }),
    );
    assert.equal(created.status, 200);
    const createdBody = JSON.parse(created.body) as { ok: boolean; updatedAt: string };
    assert.equal(createdBody.ok, true);
    assert.equal(createdBody.updatedAt, "2020-01-02T00:00:00.000Z");

    const stored = await readFile(blobPath("scenario-sync-user"), "utf8");
    assert.equal(stored.includes("top-secret"), false);
    assert.equal(stored.includes("nested-secret"), false);
    assert.equal(stored.includes("keep-scenario"), true);
    assert.equal(stored.includes("keep-input"), true);
    const settingsPath = path.join(
      dataDir,
      `${crypto.createHash("sha256").update("scenario-sync-user").digest("hex")}.settings.json`,
    );
    await assert.rejects(readFile(settingsPath, "utf8"));

    const loaded = await request(port, "GET", "/api/scenarios/sync", userHeaders);
    assert.equal(loaded.status, 200);
    const record = JSON.parse(loaded.body) as {
      updatedAt: string;
      scenarios: Array<Record<string, unknown>>;
    };
    assert.equal(record.updatedAt, "2020-01-02T00:00:00.000Z");
    assert.equal(record.scenarios.length, 1);
    const scenario = record.scenarios[0];
    if (!scenario) throw new Error("missing scenario");
    assert.equal(scenario.name, "Desk");
    assert.equal(scenario.note, "keep-scenario");
    assert.equal("apiKey" in scenario, false);
    const inputs = scenario.inputs as Record<string, unknown>;
    assert.equal(inputs.deskNote, "keep-input");
    assert.equal(inputs.btcGrowth, 29);
    assert.equal("apiSecret" in inputs, false);

    const tie = await request(
      port,
      "PUT",
      "/api/scenarios/sync",
      userHeaders,
      JSON.stringify({
        updatedAt: "2020-01-02T00:00:00.000Z",
        scenarios: [{ ...original, name: "Tied" }],
      }),
    );
    assert.equal(tie.status, 409);
    const tieBody = JSON.parse(tie.body) as { scenarios: Array<{ name: string }> };
    assert.equal(tieBody.scenarios[0]?.name, "Desk");

    const stale = await request(
      port,
      "PUT",
      "/api/scenarios/sync",
      userHeaders,
      JSON.stringify({
        updatedAt: "2020-01-01T00:00:00.000Z",
        scenarios: [{ ...original, name: "Stale" }],
      }),
    );
    assert.equal(stale.status, 409);

    const serverClock = await request(
      port,
      "PUT",
      "/api/scenarios/sync",
      userHeaders,
      JSON.stringify({
        scenarios: [{ ...original, apiKey: "again", name: "Round trip", note: "keep-scenario" }],
      }),
    );
    assert.equal(serverClock.status, 200);
    const serverBody = JSON.parse(serverClock.body) as { updatedAt: string };
    assert.equal(Number.isNaN(Date.parse(serverBody.updatedAt)), false);
    assert.equal(serverBody.updatedAt > "2020-01-02T00:00:00.000Z", true);

    const afterServer = await request(port, "GET", "/api/scenarios/sync", userHeaders);
    const afterRecord = JSON.parse(afterServer.body) as {
      updatedAt: string;
      scenarios: Array<Record<string, unknown>>;
    };
    assert.equal(afterRecord.updatedAt, serverBody.updatedAt);
    assert.equal(afterRecord.scenarios[0]?.name, "Round trip");
    assert.equal(afterRecord.scenarios[0]?.note, "keep-scenario");
    assert.equal("apiKey" in (afterRecord.scenarios[0] ?? {}), false);

    const future = await request(
      port,
      "PUT",
      "/api/scenarios/sync",
      userHeaders,
      JSON.stringify({
        updatedAt: "2099-01-01T00:00:00.000Z",
        scenarios: [{ id: "scn_1", name: "Future", inputs: { btcGrowth: 1 } }],
      }),
    );
    assert.equal(future.status, 200);

    const olderServer = await request(
      port,
      "PUT",
      "/api/scenarios/sync",
      userHeaders,
      JSON.stringify({ scenarios: [{ id: "scn_1", name: "Should not land", inputs: {} }] }),
    );
    assert.equal(olderServer.status, 409);
    const stillFuture = JSON.parse(olderServer.body) as { scenarios: Array<{ name: string }> };
    assert.equal(stillFuture.scenarios[0]?.name, "Future");

    const other = await request(port, "GET", "/api/scenarios/sync", {
      "x-test-user": "scenario-sync-other",
    });
    assert.equal(other.status, 404);
  });

  it("putScenarioSync_badShapeOrNoUser_isRejected", async () => {
    const unauthenticated = await request(
      port,
      "PUT",
      "/api/scenarios/sync",
      { "content-type": "application/json" },
      JSON.stringify({ scenarios: [] }),
    );
    assert.equal(unauthenticated.status, 401);

    const badShape = await request(
      port,
      "PUT",
      "/api/scenarios/sync",
      userHeaders,
      JSON.stringify({ scenarios: { id: "scn_1" } }),
    );
    assert.equal(badShape.status, 400);
  });
});
