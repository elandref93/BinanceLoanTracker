import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";

import {
  BinanceApiError,
  binanceSignedGet,
  binanceSignedPost,
  resetBinanceClockOffset,
  type BinanceCredentials,
} from "./binance";
import { logger } from "./logger";

const API_KEY = "sentinel-binance-api-key-9f3a";
const API_SECRET = "sentinel-binance-api-secret-9f3a";
const CREDS: BinanceCredentials = { apiKey: API_KEY, apiSecret: API_SECRET };
const SKEW_MS = 60_000;

interface SeenCall {
  href: string;
  method: string;
  apiKey: string | null;
}

const logged: unknown[][] = [];

function rememberLog(...args: unknown[]): void {
  logged.push(args);
}

afterEach(() => {
  mock.restoreAll();
  resetBinanceClockOffset();
  logged.length = 0;
});

function captureLogs(): void {
  for (const level of ["debug", "info", "warn", "error"] as const) {
    mock.method(logger, level, rememberLog);
  }
}

function installFetch(
  handler: (url: URL, call: SeenCall) => Response | Promise<Response>,
): SeenCall[] {
  const calls: SeenCall[] = [];
  mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const href =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const headers = new Headers(init?.headers);
    const call: SeenCall = {
      href,
      method: init?.method ?? "GET",
      apiKey: headers.get("x-mbx-apikey"),
    };
    calls.push(call);
    return handler(new URL(href), call);
  });
  return calls;
}

function signedCalls(calls: SeenCall[]): SeenCall[] {
  return calls.filter((call) => call.href.includes("signature="));
}

function assertNoSecrets(blob: string): void {
  assert.equal(blob.includes(API_KEY), false);
  assert.equal(blob.includes(API_SECRET), false);
  assert.equal(blob.includes("signature="), false);
}

function skewResponse(): Response {
  return Response.json(
    {
      code: -1021,
      msg: `Timestamp for this request is outside of the recvWindow. signature=abc123 ${API_SECRET}`,
    },
    { status: 400 },
  );
}

describe("binance clock offset", () => {
  it("binanceSignedGet_clockSkew_retriesOnceWithServerOffset", async () => {
    captureLogs();
    let announced = 0;
    const calls = installFetch((url) => {
      if (url.pathname === "/api/v3/time") {
        announced = Date.now() + SKEW_MS;
        return Response.json({ serverTime: announced });
      }
      const ts = Number(url.searchParams.get("timestamp"));
      if (Math.abs(ts - (Date.now() + SKEW_MS)) > 5000) return skewResponse();
      return Response.json({ ok: true });
    });

    const body = await binanceSignedGet<{ ok: boolean }>(CREDS, "/api/v3/account");
    assert.equal(body.ok, true);

    const signed = signedCalls(calls);
    assert.equal(signed.length, 2);
    assert.equal(calls.filter((call) => call.href.includes("/api/v3/time")).length, 1);
    const timeCall = calls.find((call) => call.href.includes("/api/v3/time"));
    assert.ok(timeCall);
    assert.equal(timeCall.apiKey, null);
    assert.equal(new URL(timeCall.href).search, "");

    for (const call of signed) {
      const url = new URL(call.href);
      assert.equal(url.searchParams.get("recvWindow"), "5000");
      assert.equal(call.apiKey, API_KEY);
      assert.equal(call.method, "GET");
    }
    const firstTs = Number(new URL(signed[0].href).searchParams.get("timestamp"));
    const secondTs = Number(new URL(signed[1].href).searchParams.get("timestamp"));
    assert.ok(Math.abs(firstTs - (announced - SKEW_MS)) < 2500);
    assert.ok(Math.abs(secondTs - announced) < 2500);
    assertNoSecrets(JSON.stringify(logged));
  });

  it("binanceSignedPost_clockSkew_retriesOnceWithServerOffset", async () => {
    captureLogs();
    const calls = installFetch((url) => {
      if (url.pathname === "/api/v3/time") {
        return Response.json({ serverTime: Date.now() + SKEW_MS });
      }
      const ts = Number(url.searchParams.get("timestamp"));
      if (Math.abs(ts - (Date.now() + SKEW_MS)) > 5000) return skewResponse();
      return Response.json({ ok: true });
    });

    const body = await binanceSignedPost<{ ok: boolean }>(
      CREDS,
      "/sapi/v1/asset/get-funding-asset",
    );
    assert.equal(body.ok, true);
    const signed = signedCalls(calls);
    assert.equal(signed.length, 2);
    assert.equal(signed[1].method, "POST");
    assert.equal(new URL(signed[1].href).searchParams.get("recvWindow"), "5000");
    assertNoSecrets(JSON.stringify(logged));
  });

  it("binanceSignedGet_secondClockSkew_doesNotRetryAgain", async () => {
    captureLogs();
    const calls = installFetch((url) => {
      if (url.pathname === "/api/v3/time") {
        return Response.json({ serverTime: Date.now() + SKEW_MS });
      }
      return skewResponse();
    });

    await assert.rejects(
      () => binanceSignedGet(CREDS, "/api/v3/account"),
      (err: unknown) => {
        assert.ok(err instanceof BinanceApiError);
        assert.equal(err.code, -1021);
        assert.equal(err.message.includes(API_SECRET), false);
        assert.equal(err.message.includes("signature="), false);
        return true;
      },
    );
    assert.equal(signedCalls(calls).length, 2);
    assert.equal(calls.filter((call) => call.href.includes("/api/v3/time")).length, 1);
    assertNoSecrets(JSON.stringify(logged));
  });

  it("binanceSignedGet_otherBinanceError_doesNotRetry", async () => {
    captureLogs();
    const calls = installFetch(() =>
      Response.json({ code: -2015, msg: `Invalid API-key ${API_SECRET}` }, { status: 401 }),
    );

    await assert.rejects(
      () => binanceSignedGet(CREDS, "/api/v3/account"),
      (err: unknown) => {
        assert.ok(err instanceof BinanceApiError);
        assert.equal(err.code, -2015);
        assert.equal(err.message.includes(API_SECRET), false);
        return true;
      },
    );
    assert.equal(signedCalls(calls).length, 1);
    assert.equal(calls.some((call) => call.href.includes("/api/v3/time")), false);
    assertNoSecrets(JSON.stringify(logged));
  });

  it("binanceSignedGet_serverTimeUnavailable_doesNotRetrySignedCall", async () => {
    captureLogs();
    const calls = installFetch((url) => {
      if (url.pathname === "/api/v3/time") {
        return Response.json({ code: -1000, msg: "throttled" }, { status: 500 });
      }
      return skewResponse();
    });

    await assert.rejects(
      () => binanceSignedGet(CREDS, "/api/v3/account"),
      (err: unknown) => err instanceof BinanceApiError && err.code === -1021,
    );
    assert.equal(signedCalls(calls).length, 1);
    assertNoSecrets(JSON.stringify(logged));
  });

  it("binanceSignedGet_networkError_logsWithoutSignatureOrSecret", async () => {
    captureLogs();
    installFetch(() => {
      throw new Error(
        `connect ECONNREFUSED ${API_SECRET} signature=deadbeefcafe https://api.binance.com/api/v3/account?timestamp=1&signature=deadbeefcafe`,
      );
    });

    await assert.rejects(() => binanceSignedGet(CREDS, "/api/v3/account"));
    const blob = JSON.stringify(logged);
    assertNoSecrets(blob);
    assert.equal(blob.includes("deadbeefcafe"), false);
  });

  it("binanceSignedGet_inWindow_doesNotFetchServerTime", async () => {
    captureLogs();
    const calls = installFetch((url) => {
      assert.equal(url.searchParams.get("recvWindow"), "5000");
      return Response.json({ ok: true });
    });

    const body = await binanceSignedGet<{ ok: boolean }>(CREDS, "/api/v3/account");
    assert.equal(body.ok, true);
    assert.equal(signedCalls(calls).length, 1);
    assert.equal(calls.some((call) => call.href.includes("/api/v3/time")), false);
    assertNoSecrets(JSON.stringify(logged));
  });
});
