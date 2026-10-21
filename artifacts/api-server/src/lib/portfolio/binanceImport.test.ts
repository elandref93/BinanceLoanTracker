import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BinanceApiError } from "../binance";
import { isBeyondRetentionError, isPermanentBinanceError, newCursor, settleSourceError, sourceFloor } from "./binanceImport";
import { DAY_MS } from "./time";

const now = Date.parse("2026-10-12T15:00:00Z");

function cursor(patch: Partial<ReturnType<typeof newCursor>> = {}) {
  return { ...newCursor("binance:L1:pay", "L1", "Main", "pay"), ...patch };
}

describe("binance history source errors", () => {
  it("isPermanentBinanceError_marginAccountMissing_isPermanent", () => {
    const err = new BinanceApiError("/sapi/v1/margin/borrow-repay", 400, -3003, "Margin account does not exist.");
    assert.equal(isPermanentBinanceError(err), true);
  });

  it("isPermanentBinanceError_timeRangeTooLarge_isRetryable", () => {
    const err = new BinanceApiError("/sapi/v1/simple-earn/flexible/history/rewardsRecord", 400, -6021, "Query time range too large");
    assert.equal(isPermanentBinanceError(err), false);
    assert.equal(isBeyondRetentionError(err), false);
  });

  it("settleSourceError_marginMissing_marksSourceUnavailable", () => {
    const err = new BinanceApiError("/sapi/v1/margin/borrow-repay", 400, -3003, "Margin account does not exist.");
    const next = settleSourceError(cursor({ source: "margin-loans", coveredFrom: null }), err, err.message, now);
    assert.equal(next.state, "unavailable");
    assert.equal(next.backfillDone, true);
    assert.match(next.error ?? "", /Margin account does not exist/);
  });

  it("settleSourceError_payOlderThanRetention_finishesWithoutDroppingCoverage", () => {
    const coveredFrom = now - 400 * DAY_MS;
    const err = new BinanceApiError("/sapi/v1/pay/transactions", 400, 403004, "The request has an invalid parameter");
    const next = settleSourceError(cursor({ coveredFrom, rows: 4 }), err, err.message, now);
    assert.equal(next.state, "complete");
    assert.equal(next.backfillDone, true);
    assert.equal(next.error, null);
    assert.equal(next.coveredFrom, coveredFrom);
    assert.equal(next.rows, 4);
  });

  it("settleSourceError_payInvalidOnFirstWindow_staysFailed", () => {
    const err = new BinanceApiError("/sapi/v1/pay/transactions", 400, 403004, "The request has an invalid parameter");
    const next = settleSourceError(cursor({ coveredFrom: null }), err, err.message, now);
    assert.equal(next.state, "error");
    assert.equal(next.backfillDone, false);
    assert.equal(next.coveredFrom, null);
  });

  it("sourceFloor_payRetention_doesNotRequestOlderThanEighteenMonths", () => {
    const floor = sourceFloor({ floor: Date.parse("2021-01-01T00:00:00Z"), retentionMs: 18 * 30 * DAY_MS }, now);
    assert.equal(floor, now - 18 * 30 * DAY_MS);
  });
});
