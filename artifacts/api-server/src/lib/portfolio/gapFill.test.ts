import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fillHistoryGaps, gapFillEnabled, type GapFillInput } from "./gapFill";
import { jhbDay, jhbDayEnd, jhbDayStart } from "./time";
import type { HistoryPoint, LedgerEvent, StatementSeries } from "./types";

const noon = (day: string) => jhbDayStart(day) + 12 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-19T08:00:00Z");

function point(t: number, holdings: Record<string, number>, extras: Partial<HistoryPoint> = {}): HistoryPoint {
  const h = { none: { ...holdings } };
  return { t, a: 0, d: 0, h, c: { none: [0, 0] }, p: { BTC: 10 }, fx: 20, ...extras };
}

function series(points: Array<{ date: string; value: number | null }>): StatementSeries {
  return {
    key: "fund",
    kind: "as",
    accountNumber: "1",
    product: "perec-as",
    containerId: null,
    asset: "Fund",
    currency: "USD",
    points: points.map((item) => ({ date: item.date, value: item.value, currency: "USD", change: null, product: "perec-as" })),
  };
}

function input(partial: Partial<GapFillInput> & Pick<GapFillInput, "points">): GapFillInput {
  return {
    events: [],
    linkContainer: new Map([["L1", "none"]]),
    price: (asset) => (asset === "BTC" ? 10 : 0),
    fx: () => 20,
    nowMs: NOW,
    ...partial,
  };
}

function onDay(points: HistoryPoint[], day: string): HistoryPoint[] {
  return points.filter((item) => jhbDay(item.t) === day);
}

describe("portfolio gap fill", () => {
  it("fillHistoryGaps_closedDayWithOnlyMidnightTick_addsCarriedClose", () => {
    const midnight = jhbDayStart("2026-10-17") + 10_000;
    const result = fillHistoryGaps(input({ points: [point(midnight, { BTC: 2, Fund: 4 })], series: [series([{ date: "2026-10-17", value: 5 }])] }));
    assert.deepEqual(result.filled, ["2026-10-17", "2026-10-18"]);
    const saturday = onDay(result.points, "2026-10-17");
    assert.equal(saturday.length, 2);
    assert.equal(saturday[0]?.t, midnight);
    const close = saturday[1];
    assert.equal(close?.gapFill, true);
    assert.equal(close?.t, jhbDayEnd("2026-10-17") - 1);
    assert.equal(close?.h.none?.BTC, 2);
    assert.equal(close?.h.none?.Fund, 5);
    assert.deepEqual(close?.carried, ["none|BTC"]);
    assert.equal(close?.a, 25);
    const again = fillHistoryGaps(input({ points: result.points, series: [series([{ date: "2026-10-17", value: 5 }])] }));
    assert.deepEqual(again.filled, []);
    assert.equal(again.points.length, result.points.length);
  });

  it("fillHistoryGaps_afternoonSnapshot_isLeftAlone", () => {
    const points = [point(noon("2026-10-16"), { BTC: 2 }), point(noon("2026-10-17"), { BTC: 2 })];
    const result = fillHistoryGaps(input({ points }));
    assert.deepEqual(result.filled, ["2026-10-18"]);
    assert.equal(onDay(result.points, "2026-10-16").length, 1);
    assert.equal(onDay(result.points, "2026-10-17").filter((item) => item.gapFill).length, 0);
  });

  it("fillHistoryGaps_ledgerTrade_isNotMarkedCarried", () => {
    const sale: LedgerEvent = {
      id: "sell-1",
      t: noon("2026-10-17"),
      exchange: "binance",
      linkId: "L1",
      type: "sell",
      asset: "BTC",
      qty: -1,
    };
    const result = fillHistoryGaps(input({ points: [point(noon("2026-10-16"), { BTC: 2 })], events: [sale] }));
    const close = onDay(result.points, "2026-10-17").find((item) => item.gapFill);
    assert.equal(close?.h.none?.BTC, 1);
    assert.equal((close?.carried ?? []).includes("none|BTC"), false);
    assert.equal(close?.a, 10);
  });

  it("fillHistoryGaps_missingPortalDay_carriesLastStatementValue", () => {
    const result = fillHistoryGaps(input({
      points: [point(noon("2026-10-16"), { Fund: 4 })],
      series: [series([{ date: "2026-10-16", value: 4 }, { date: "2026-10-17", value: null }, { date: "2026-10-18", value: null }])],
    }));
    const saturday = onDay(result.points, "2026-10-17").find((item) => item.gapFill);
    const sunday = onDay(result.points, "2026-10-18").find((item) => item.gapFill);
    assert.equal(saturday?.h.none?.Fund, 4);
    assert.deepEqual(saturday?.carried, ["none|Fund"]);
    assert.equal(sunday?.h.none?.Fund, 4);
    assert.equal(onDay(result.points, "2026-10-19").length, 0);
  });

  it("fillHistoryGaps_statementStub_keepsExchangeHoldings", () => {
    const stub = point(jhbDayEnd("2026-10-18") - 1, { Fund: 3 }, { a: 3 });
    const result = fillHistoryGaps(input({
      points: [point(noon("2026-10-16"), { BTC: 2 }), stub],
      series: [series([{ date: "2026-10-18", value: 3 }])],
    }));
    const sunday = onDay(result.points, "2026-10-18");
    assert.equal(sunday.length, 1);
    assert.equal(sunday[0]?.gapFill, true);
    assert.equal(sunday[0]?.h.none?.BTC, 2);
    assert.equal(sunday[0]?.h.none?.Fund, 3);
    assert.equal(sunday[0]?.carried?.includes("none|BTC"), true);
    assert.equal(sunday[0]?.carried?.includes("none|Fund"), false);
  });

  it("fillHistoryGaps_noHistory_doesNotInventADay", () => {
    const result = fillHistoryGaps(input({ points: [], series: [series([{ date: "2026-10-17", value: 5 }])] }));
    assert.deepEqual(result.filled, []);
    assert.equal(result.points.length, 0);
  });

  it("gapFillEnabled_skipsPinnedProfilePrefix", () => {
    assert.equal(gapFillEnabled("2ad8b0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), false);
    assert.equal(gapFillEnabled("d609e13453c430118d09dcbe8ff7419546c0e4bf2531bb0f633d4725c3bc2c2d"), true);
  });
});
