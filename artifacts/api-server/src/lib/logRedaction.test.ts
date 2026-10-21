import http from "node:http";
import assert from "node:assert/strict";
import { once } from "node:events";
import { Writable } from "node:stream";
import express from "express";
import { describe, it } from "node:test";

import { httpRequestLogger } from "../app";
import { createLogger } from "./logger";

const BEARER = "sentinel-bearer-token-9f3a";
const COOKIE = "sentinel-cookie-value-9f3a";
const BINANCE = "sentinel-binance-secret-9f3a";
const LUNO = "sentinel-luno-secret-9f3a";
const MBX = "sentinel-mbx-key-9f3a";

function capturingLogger(): { lines: string[]; logger: ReturnType<typeof createLogger> } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { lines, logger: createLogger(stream) };
}

function assertSecretsAbsent(blob: string): void {
  assert.equal(blob.includes(BEARER), false);
  assert.equal(blob.includes(COOKIE), false);
  assert.equal(blob.includes(BINANCE), false);
  assert.equal(blob.includes(LUNO), false);
  assert.equal(blob.includes(MBX), false);
}

describe("request log redaction", () => {
  it("httpRequestLogger_requestWithSecrets_omitsBearerCookieAndExchangeHeaders", async () => {
    const { lines, logger } = capturingLogger();
    const app = express();
    app.use(httpRequestLogger(logger));
    app.get("/api/probe", (req, res) => {
      req.log.info(
        { headers: req.headers, req: { headers: req.headers } },
        "request headers",
      );
      assert.equal(req.header("authorization"), `Bearer ${BEARER}`);
      assert.equal(req.header("cookie"), `session=${COOKIE}`);
      assert.equal(req.header("x-binance-accounts"), BINANCE);
      assert.equal(req.header("x-luno-accounts"), LUNO);
      res.status(204).end();
    });

    const server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("test server did not bind a port");
    }
    try {
      const status = await new Promise<number>((resolve, reject) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port: address.port,
            path: `/api/probe?access_token=${BEARER}`,
            method: "GET",
            headers: {
              Authorization: `Bearer ${BEARER}`,
              Cookie: `session=${COOKIE}`,
              "X-Binance-Accounts": BINANCE,
              "X-Luno-Accounts": LUNO,
              "X-MBX-APIKEY": MBX,
            },
          },
          (res) => {
            res.resume();
            res.on("end", () => resolve(res.statusCode ?? 0));
          },
        );
        req.on("error", reject);
        req.end();
      });
      assert.equal(status, 204);
      const blob = lines.join("\n");
      assert.ok(blob.includes("[Redacted]"));
      assert.ok(blob.includes("/api/probe"));
      assert.equal(blob.includes("access_token="), false);
      assertSecretsAbsent(blob);
    } finally {
      server.close();
      await once(server, "close");
    }
  });

  it("createLogger_nestedCredentialHeaders_redactsValues", () => {
    const { lines, logger } = capturingLogger();
    logger.info(
      {
        err: {
          config: {
            headers: {
              authorization: `Bearer ${BEARER}`,
              cookie: `session=${COOKIE}`,
              "x-binance-accounts": BINANCE,
              "x-luno-accounts": LUNO,
              "X-MBX-APIKEY": MBX,
            },
          },
        },
        res: { headers: { "set-cookie": [`session=${COOKIE}`] } },
      },
      "nested headers",
    );
    const blob = lines.join("\n");
    assert.ok(blob.includes("[Redacted]"));
    assertSecretsAbsent(blob);
  });

  it("createLogger_exchangeKeyFields_redactsValues", () => {
    const { lines, logger } = capturingLogger();
    logger.info(
      {
        account: { apiKey: BINANCE, apiSecret: LUNO, name: "desk" },
        nested: { link: { keySecret: MBX } },
      },
      "stored link",
    );
    const blob = lines.join("\n");
    assert.equal(blob.includes(BINANCE), false);
    assert.equal(blob.includes(LUNO), false);
    assert.equal(blob.includes(MBX), false);
    assert.ok(blob.includes("desk"));
  });
});
