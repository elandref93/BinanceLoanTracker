import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyExpectedReturn,
  compareExpectedReturn,
  EXPECTED_RETURN_FIELD,
  expectedReturnRows,
  holdingStart,
  parseExpectedAnnual,
  readExpectedReturn,
  readExpectedReturns,
  returnStatusLabel,
} from "./expectedReturn";

const DAY_MS = 86_400_000;

describe("expected annual return", () => {
  it("readExpectedReturns_unsetBlobHasNoPercent", () => {
    assert.deepEqual(readExpectedReturns({ currency: "ZAR", targetLtv: 55 }), {});
    assert.equal(readExpectedReturn({}, "BTC"), null);
    assert.equal(readExpectedReturn({ [EXPECTED_RETURN_FIELD]: { BTC: "40" } }, "BTC"), null);
    const cleared = applyExpectedReturn({ currency: "ZAR", alertRules: [{ id: "r1" }] }, "BTC", null);
    assert.equal(EXPECTED_RETURN_FIELD in cleared, false);
    assert.equal(cleared.currency, "ZAR");
    assert.deepEqual(cleared.alertRules, [{ id: "r1" }]);
  });

  it("applyExpectedReturn_storesOnlyTheHoldingThatWasSet", () => {
    const next = applyExpectedReturn({ currency: "ZAR", targetLtv: 55 }, "BTC", 12.5);
    assert.equal(readExpectedReturn(next, "BTC"), 12.5);
    assert.equal(readExpectedReturn(next, "ETH"), null);
    assert.equal(next.currency, "ZAR");
    assert.equal(next.targetLtv, 55);
    const removed = applyExpectedReturn(next, "BTC", null);
    assert.equal(readExpectedReturn(removed, "BTC"), null);
    assert.equal(parseExpectedAnnual(""), null);
    assert.equal(parseExpectedAnnual("12,5"), 12.5);
    assert.equal(parseExpectedAnnual("nope"), null);
  });

  it("compareExpectedReturn_proratesByElapsedFractionOf365", () => {
    const now = Date.parse("2026-10-19T12:00:00.000Z");
    const fullYear = compareExpectedReturn({
      annualPct: 10,
      startedAt: new Date(now - 365 * DAY_MS).toISOString(),
      startUsd: 80,
      nowUsd: 96,
      nowMs: now,
    });
    assert.equal(fullYear?.expectedPct, 10);
    assert.ok(fullYear?.actualPct != null && Math.abs(fullYear.actualPct - 20) < 1e-9);
    assert.ok(fullYear?.gapPp != null && Math.abs(fullYear.gapPp - (fullYear.actualPct - fullYear.expectedPct)) < 1e-9);
    assert.ok(Math.abs(fullYear.gapPp - 10) < 1e-9);
    assert.equal(fullYear?.status, "ahead");
    assert.equal(returnStatusLabel(fullYear.status, fullYear.gapPp), "Ahead 10,0 pp");

    const half = compareExpectedReturn({
      annualPct: 40,
      startedAt: new Date(now - 100 * DAY_MS).toISOString(),
      startUsd: 100,
      nowUsd: 110,
      nowMs: now,
    });
    assert.ok(half);
    assert.ok(Math.abs(half.expectedPct - 40 * (100 / 365)) < 1e-9);
    assert.ok(half.actualPct != null && Math.abs(half.actualPct - 10) < 1e-9);
    assert.ok(half.gapPp != null && Math.abs(half.gapPp - (half.actualPct - half.expectedPct)) < 1e-9);
    assert.equal(half.status, "behind");
    assert.equal(returnStatusLabel(half.status, half.gapPp), "Behind 1,0 pp");

    const partial = compareExpectedReturn({
      annualPct: 365,
      startedAt: new Date(now - DAY_MS / 2).toISOString(),
      startUsd: 100,
      nowUsd: 100.5,
      nowMs: now,
    });
    assert.ok(partial);
    assert.ok(Math.abs(partial.expectedPct - 0.5) < 1e-9);
    assert.ok(partial.gapPp != null && Math.abs(partial.gapPp) < 1e-9);
    assert.equal(partial.status, "on_par");
    assert.equal(returnStatusLabel(partial.status, partial.gapPp), "On par");

    const ahead = compareExpectedReturn({
      annualPct: 10,
      startedAt: new Date(now - 365 * DAY_MS).toISOString(),
      startUsd: 1000,
      nowUsd: 1111,
      nowMs: now,
    });
    assert.ok(ahead?.gapPp != null && Math.abs(ahead.gapPp - 1.1) < 1e-9);
    assert.equal(returnStatusLabel(ahead.status ?? "on_par", ahead.gapPp), "Ahead 1,1 pp");
    const behind = compareExpectedReturn({
      annualPct: 10,
      startedAt: new Date(now - 365 * DAY_MS).toISOString(),
      startUsd: 1000,
      nowUsd: 1076,
      nowMs: now,
    });
    assert.ok(behind?.gapPp != null && Math.abs(behind.gapPp - -2.4) < 1e-9);
    assert.equal(returnStatusLabel(behind.status ?? "on_par", behind.gapPp), "Behind 2,4 pp");
  });

  it("compareExpectedReturn_bandIsHalfAPercentagePoint", () => {
    const now = Date.parse("2026-10-19T00:00:00.000Z");
    const startedAt = new Date(now - 365 * DAY_MS).toISOString();
    const onEdge = compareExpectedReturn({ annualPct: 10, startedAt, startUsd: 100, nowUsd: 110.5, nowMs: now });
    const over = compareExpectedReturn({ annualPct: 10, startedAt, startUsd: 100, nowUsd: 110.51, nowMs: now });
    assert.equal(onEdge?.status, "on_par");
    assert.ok(onEdge?.gapPp != null && Math.abs(onEdge.gapPp - 0.5) < 1e-9);
    assert.equal(returnStatusLabel(onEdge.status, onEdge.gapPp), "On par");
    assert.equal(over?.status, "ahead");
    assert.ok(over?.gapPp != null && over.gapPp > 0.5);
    assert.equal(returnStatusLabel(over.status, over.gapPp), "Ahead 0,5 pp");
    assert.equal(compareExpectedReturn({ annualPct: 10, startedAt, startUsd: 0, nowUsd: 10, nowMs: now }), null);
  });

  it("compareExpectedReturn_tinyStartOmitsActualPercent", () => {
    const now = Date.parse("2026-10-19T12:00:00.000Z");
    const startedAt = new Date(now - 365 * DAY_MS).toISOString();
    const dust = compareExpectedReturn({
      annualPct: 10,
      startedAt,
      startUsd: 0.15,
      nowUsd: 1_000_000,
      nowMs: now,
    });
    assert.ok(dust);
    assert.equal(dust.expectedPct, 10);
    assert.equal(dust.actualPct, null);
    assert.equal(dust.gapPp, null);
    assert.equal(dust.status, null);
    const nearZero = compareExpectedReturn({
      annualPct: 10,
      startedAt,
      startUsd: 0.01,
      nowUsd: 1_000_000,
      nowMs: now,
    });
    assert.equal(nearZero?.actualPct, null);
    const real = compareExpectedReturn({
      annualPct: 10,
      startedAt,
      startUsd: 1,
      nowUsd: 2,
      nowMs: now,
    });
    assert.equal(real?.actualPct, 100);
    assert.equal(real?.status, "ahead");
  });

  it("holdingStart_usesOpenedPointAheadOfTheChartWindow", () => {
    const opened = "2024-06-01T21:59:59.999Z";
    const start = holdingStart({
      holdingOpened: { t: opened, usd: 4 },
      holdingHistory: [{ t: "2026-01-01T00:00:00.000Z", usd: 9 }],
    });
    assert.equal(start?.t, opened);
    assert.equal(start?.usd, 4);
    const fromHistory = holdingStart({
      holdingHistory: [
        { t: "2026-02-01T00:00:00.000Z", usd: 0 },
        { t: "2026-03-01T00:00:00.000Z", usd: 3 },
      ],
    });
    assert.equal(fromHistory?.t, "2026-03-01T00:00:00.000Z");
  });

  it("compareExpectedReturn_depositAfterStartIsNotGrowth", () => {
    const now = Date.parse("2026-10-19T12:00:00.000Z");
    const startedAt = new Date(now - 100 * DAY_MS).toISOString();
    const deposited = compareExpectedReturn({
      annualPct: 75,
      startedAt,
      startUsd: 100,
      nowUsd: 200,
      nowMs: now,
      flows: [{ t: new Date(now - 40 * DAY_MS).toISOString(), usd: 100 }],
    });
    assert.equal(deposited?.flowsRemoved, true);
    assert.ok(deposited?.actualPct != null && Math.abs(deposited.actualPct) < 1e-9);
    const plain = compareExpectedReturn({
      annualPct: 75,
      startedAt,
      startUsd: 100,
      nowUsd: 200,
      nowMs: now,
    });
    assert.equal(plain?.flowsRemoved, false);
    assert.ok(plain?.actualPct != null && Math.abs(plain.actualPct - 100) < 1e-9);
    const opening = compareExpectedReturn({
      annualPct: 75,
      startedAt,
      startUsd: 100,
      nowUsd: 110,
      nowMs: now,
      flows: [{ t: startedAt, usd: 100 }],
    });
    assert.equal(opening?.flowsRemoved, false);
    assert.ok(opening?.actualPct != null && Math.abs(opening.actualPct - 10) < 1e-9);
  });

  it("compareExpectedReturn_withdrawalIsNotALossAndDividendStaysInside", () => {
    const now = Date.parse("2026-10-19T12:00:00.000Z");
    const startedAt = new Date(now - 100 * DAY_MS).toISOString();
    const withdrawn = compareExpectedReturn({
      annualPct: 10,
      startedAt,
      startUsd: 100,
      nowUsd: 60,
      nowMs: now,
      flows: [{ t: new Date(now - 40 * DAY_MS).toISOString(), usd: -40 }],
    });
    assert.ok(withdrawn?.actualPct != null && Math.abs(withdrawn.actualPct) < 1e-9);
    const dividend = compareExpectedReturn({
      annualPct: 10,
      startedAt,
      startUsd: 100,
      nowUsd: 103,
      nowMs: now,
    });
    assert.equal(dividend?.flowsRemoved, false);
    assert.ok(dividend?.actualPct != null && Math.abs(dividend.actualPct - 3) < 1e-9);
  });

  it("compareExpectedReturn_proratedTargetIgnoresRemovedDeposits", () => {
    const startedAt = "2026-07-21T21:59:59.999Z";
    const startMs = Date.parse(startedAt);
    const elapsed = 90.34;
    const now = startMs + elapsed * DAY_MS;
    const jump = new Date(startMs + 9 * DAY_MS).toISOString();
    const compared = compareExpectedReturn({
      annualPct: 75,
      startedAt,
      startUsd: 100,
      nowUsd: 210,
      nowMs: now,
      marks: [
        { t: startedAt, usd: 100 },
        { t: new Date(Date.parse(jump) + DAY_MS).toISOString(), usd: 202 },
      ],
      flows: [{ t: jump, usd: 102 }],
    });
    assert.ok(compared);
    assert.ok(Math.abs(compared.expectedPct - 75 * (elapsed / 365)) < 1e-9);
    const market = ((202 - 100 - 102) / (100 + 0.5 * 102)) + 1;
    const linked = (market * (1 + (210 - 202) / 202) - 1) * 100;
    assert.ok(compared.actualPct != null && Math.abs(compared.actualPct - linked) < 1e-9);
    assert.ok(compared.actualPct != null && compared.actualPct < 20);
    assert.equal(compared.status, "behind");
    const dust = compareExpectedReturn({
      annualPct: 75,
      startedAt,
      startUsd: 0.2,
      nowUsd: 210,
      nowMs: now,
      flows: [{ t: jump, usd: 102 }],
    });
    assert.equal(dust?.actualPct, null);
    assert.equal(dust?.flowsRemoved, false);
  });

  it("expectedReturnRows_keepsOnlyHoldingsInScope", () => {
    const now = Date.parse("2026-07-01T00:00:00.000Z");
    const rows = expectedReturnRows({
      targets: { BTC: 10, "Personal Note": 40 },
      holdings: [{ asset: "BTC", title: "Bitcoin" }],
      nowMs: now,
      details: new Map([
        [
          "BTC",
          {
            holdingOpened: { t: new Date(now - 365 * DAY_MS).toISOString(), usd: 50 },
            holdingHistory: [],
            priceHistory: [{ t: new Date(now).toISOString() }],
            asset: { usd: 60 },
          },
        ],
      ]),
    });
    assert.deepEqual(
      rows.map((row) => row.asset),
      ["BTC"],
    );
    assert.equal(rows[0]?.title, "Bitcoin");
    assert.equal(rows[0]?.comparison?.expectedPct, 10);
    assert.ok(rows[0]?.comparison?.actualPct != null && Math.abs(rows[0].comparison.actualPct - 20) < 1e-9);
    assert.equal(rows[0]?.comparison?.status, "ahead");
  });
});
