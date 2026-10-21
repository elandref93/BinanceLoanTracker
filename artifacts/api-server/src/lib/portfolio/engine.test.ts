import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cgtIfSoldToday, runCostBasis, summariseCgt } from "./cgt";
import { compactHistory, toHistoryPoint } from "./history";
import { buildDailySeries, modifiedDietz, periodFromSeries } from "./pnl";
import { balanceKey, reconcile, reconstructBalances } from "./reconstruct";
import { DAY_MS, jhbDay, jhbDayStart, saTaxYear } from "./time";
import type { HistoryPoint, LedgerEvent, PortfolioState } from "./types";

const noon = (day: string) => jhbDayStart(day) + 12 * 60 * 60 * 1000;

function event(partial: Partial<LedgerEvent> & Pick<LedgerEvent, "id" | "t" | "type" | "asset" | "qty">): LedgerEvent {
  return { exchange: "binance", linkId: "L1", ...partial };
}

describe("portfolio time", () => {
  it("jhbDay_lateUtcEvening_isNextJohannesburgDay", () => {
    assert.equal(jhbDay(Date.parse("2026-10-10T22:30:00Z")), "2026-10-11");
    assert.equal(jhbDay(Date.parse("2026-10-10T21:59:00Z")), "2026-10-10");
  });

  it("saTaxYear_marchFirst_startsNewYear", () => {
    assert.equal(saTaxYear(noon("2026-02-28")).label, "2025/26");
    assert.equal(saTaxYear(noon("2026-03-01")).label, "2026/27");
    assert.equal(saTaxYear(noon("2028-02-29")).to, "2028-02-29");
  });
});

describe("portfolio history", () => {
  it("compactHistory_appliesFifteenMinuteHourlyDailyRetention", () => {
    const now = Date.parse("2026-10-11T10:00:00Z");
    const points: HistoryPoint[] = [];
    for (let t = now - 120 * DAY_MS; t <= now; t += 15 * 60 * 1000) {
      points.push({ t, a: 1, d: 0, h: {}, c: {}, p: {}, fx: null });
    }
    const kept = compactHistory(points, now);
    const recent = kept.filter((point) => now - point.t <= 7 * DAY_MS);
    const hourly = kept.filter((point) => now - point.t > 7 * DAY_MS && now - point.t <= 90 * DAY_MS);
    const daily = kept.filter((point) => now - point.t > 90 * DAY_MS);
    assert.equal(recent.length, 7 * 96 + 1);
    assert.ok(hourly.length >= 83 * 24 - 1 && hourly.length <= 83 * 24 + 1);
    assert.ok(daily.length >= 29 && daily.length <= 31);
  });

  it("toHistoryPoint_debtIsNegativeQuantityAndSeparateTotal", () => {
    const state: PortfolioState = {
      asOf: 1,
      positions: [{ exchange: "binance", linkId: "L1", linkName: "A", containerId: "P", wallet: "collateral", asset: "BTC", qty: 2 }],
      debts: [{ loanId: "x", exchange: "binance", linkId: "L1", containerId: "P", asset: "USDT", qty: 50_000, collateralAsset: "BTC", collateralQty: 2, ltv: 40, marginCallLtv: 80, liqLtv: 90, apr: 8, hourlyRate: 0 }],
      prices: { BTC: 60_000 },
      change24h: {},
      fx: 18,
      fxSource: "luno",
      containers: [],
      errors: [],
    };
    const point = toHistoryPoint(state);
    assert.equal(point.a, 120_000);
    assert.equal(point.d, 50_000);
    assert.deepEqual(point.h.P, { BTC: 2, USDT: -50_000 });
    assert.deepEqual(point.c.P, [120_000, 50_000]);
  });
});

describe("balance reconstruction", () => {
  it("reconstructBalances_walksBackFromAnchor", () => {
    const events = [
      event({ id: "d1", t: noon("2026-01-01"), type: "deposit", asset: "BTC", qty: 1.5, external: true }),
      event({ id: "w1", t: noon("2026-01-03"), type: "withdrawal", asset: "BTC", qty: -0.5, external: true }),
    ];
    const anchor = new Map([[balanceKey("L1", "BTC", false), 1]]);
    const recon = reconstructBalances({ anchorT: noon("2026-01-04"), anchor, events });
    assert.deepEqual(recon.days, ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"]);
    assert.deepEqual(recon.endOfDay.map((day) => day.get(balanceKey("L1", "BTC", false))), [1.5, 1.5, 1, 1]);
    assert.equal(recon.opening.get(balanceKey("L1", "BTC", false)), 0);
    assert.equal(recon.adjustments.length, 0);
  });

  it("reconstructBalances_missingOutflow_clampsAndFlags", () => {
    const events = [event({ id: "d1", t: noon("2026-01-01"), type: "deposit", asset: "BTC", qty: 1, external: true })];
    const anchor = new Map([[balanceKey("L1", "BTC", false), 0.2]]);
    const recon = reconstructBalances({ anchorT: noon("2026-01-02"), anchor, events });
    assert.equal(recon.adjustments.length, 1);
    assert.ok(Math.abs((recon.adjustments[0]?.qty ?? 0) + 0.8) < 1e-9);
    assert.equal(recon.adjustments[0]?.flagged, true);
    assert.equal(recon.opening.get(balanceKey("L1", "BTC", false)), 0);
  });

  it("reconcile_flagsLargeUnexplainedDifferencesOnly", () => {
    const anchor = new Map([
      [balanceKey("L1", "BTC", false), 1],
      [balanceKey("L1", "ETH", false), 10],
    ]);
    const events = [
      event({ id: "a", t: 1, type: "deposit", asset: "BTC", qty: 0.5 }),
      event({ id: "b", t: 1, type: "deposit", asset: "ETH", qty: 9.9999 }),
    ];
    const rows = reconcile(anchor, events, (asset) => (asset === "BTC" ? 60_000 : 3_000));
    const btc = rows.find((row) => row.key.includes("BTC"));
    const eth = rows.find((row) => row.key.includes("ETH"));
    assert.equal(btc?.flagged, true);
    assert.equal(eth?.flagged, false);
  });
});

describe("profit and loss", () => {
  const prices: Record<string, Record<string, number>> = {
    BTC: { "2025-12-31": 100, "2026-01-01": 100, "2026-01-02": 110, "2026-01-03": 110 },
  };
  const price = (asset: string, day: string) => (asset === "USDT" ? 1 : prices[asset]?.[day] ?? 0);

  it("periodFromSeries_depositIsNotProfit_marketMoveIs", () => {
    const events = [event({ id: "d1", t: noon("2026-01-01"), type: "deposit", asset: "BTC", qty: 1, external: true })];
    const anchor = new Map([[balanceKey("L1", "BTC", false), 1]]);
    const recon = reconstructBalances({ anchorT: noon("2026-01-02"), anchor, events });
    const series = buildDailySeries({ recon, events, linkContainer: new Map([["L1", "P"]]), price });
    const result = periodFromSeries(series, null, "2026-01-01");
    assert.equal(result.flowsUsd, 100);
    assert.equal(result.pnlUsd, 10);
    assert.ok(Math.abs((result.twrPct ?? 0) - 10) < 1e-9);
    assert.equal(result.marketUsd, 10);
    assert.ok(Math.abs(result.otherUsd) < 1e-9);
  });

  it("periodFromSeries_incomeAndCostsAreAttributed", () => {
    const events = [
      event({ id: "d1", t: noon("2026-01-01"), type: "deposit", asset: "USDT", qty: 1000, external: true }),
      event({ id: "i1", t: noon("2026-01-02"), type: "income", asset: "USDT", qty: 5 }),
      event({ id: "f1", t: noon("2026-01-02"), type: "fee", asset: "USDT", qty: -1 }),
    ];
    const anchor = new Map([[balanceKey("L1", "USDT", false), 1004]]);
    const recon = reconstructBalances({ anchorT: noon("2026-01-02"), anchor, events });
    const series = buildDailySeries({ recon, events, linkContainer: new Map(), price });
    const result = periodFromSeries(series, null, "2026-01-02");
    assert.equal(result.pnlUsd, 4);
    assert.equal(result.incomeUsd, 5);
    assert.equal(result.costsUsd, -1);
    assert.ok(Math.abs(result.otherUsd) < 1e-9);
  });

  it("modifiedDietz_weightsFlowsAtMidpoint", () => {
    assert.ok(Math.abs(modifiedDietz(1000, 1150, 100) - 50 / 1050) < 1e-12);
    assert.equal(modifiedDietz(0, 0, 0), 0);
  });
});

describe("capital gains", () => {
  const price = (asset: string, day: string) => (asset === "BTC" ? (day === "2026-04-01" ? 100 : day === "2026-05-01" ? 200 : 300) : 1);
  const events = [
    event({ id: "b1", t: noon("2026-04-01"), type: "buy", asset: "BTC", qty: 1, usd: 100 }),
    event({ id: "b2", t: noon("2026-05-01"), type: "buy", asset: "BTC", qty: 1, usd: 200 }),
    event({ id: "s1", t: noon("2026-06-01"), type: "sell", asset: "BTC", qty: -1, usd: 300 }),
  ];
  const common = { events, linkContainer: new Map([["L1", "P"]]), price, fxOn: () => 10 };

  it("runCostBasis_weightedAverageVersusFifo", () => {
    const weighted = runCostBasis({ ...common, method: "weighted" });
    const fifo = runCostBasis({ ...common, method: "fifo" });
    assert.equal(weighted.disposals[0]?.costUsd, 150);
    assert.equal(fifo.disposals[0]?.costUsd, 100);
    assert.equal(weighted.holdings.get("P")?.get("BTC")?.costUsd, 150);
    assert.equal(fifo.holdings.get("P")?.get("BTC")?.costUsd, 200);
  });

  it("summariseCgt_individualExclusionVersusTrustInclusion", () => {
    const { disposals } = runCostBasis({ ...common, method: "fifo" });
    const now = noon("2026-10-11");
    const individual = summariseCgt({ disposals, containerTypes: new Map([["P", "personal"]]), containers: null, now, fxKnown: true });
    assert.equal(individual.realizedGainZar, 2000);
    assert.equal(individual.taxableGainZar, 0);
    const trust = summariseCgt({ disposals, containerTypes: new Map([["P", "trust"]]), containers: null, now, fxKnown: true });
    assert.equal(trust.taxableGainZar, 1600);
    assert.equal(trust.inclusionRate, 0.8);
  });

  it("cgtIfSoldToday_addsOpenGainToRealisedPerProfile", () => {
    const { disposals, holdings } = runCostBasis({ ...common, method: "fifo" });
    const values = new Map([["P", new Map([["BTC", 60_000], ["ZAR", 5_000]])]]);
    const now = noon("2026-10-11");
    const [individual] = cgtIfSoldToday({ disposals, holdings, values, containers: [{ id: "P", name: "Personal", type: "personal" }], scope: null, now });
    assert.equal(individual?.realizedGainZar, 2000);
    assert.equal(individual?.unrealizedGainZar, 58_000);
    assert.equal(individual?.taxableIfSoldZar, 8000);
    assert.equal(individual?.taxIfSoldZar, 3600);
    const [trust] = cgtIfSoldToday({ disposals, holdings, values, containers: [{ id: "P", name: "Trust", type: "trust" }], scope: null, now });
    assert.equal(trust?.taxableIfSoldZar, 48_000);
    assert.equal(cgtIfSoldToday({ disposals, holdings, values, containers: [], scope: new Set(["Q"]), now }).length, 0);
  });
});
