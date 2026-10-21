import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { percentile, runForecast, seededRandom, type ForecastInput } from "./forecast";

const zeros = (count: number) => Array.from({ length: count }, () => 0);
const swings = (count: number, size: number) => Array.from({ length: count }, (_, index) => (index % 2 === 0 ? size : -size));

const base: ForecastInput = {
  seed: 7,
  paths: 400,
  days: 365,
  drift: "none",
  residualUsd: 0,
  assets: [
    { asset: "BTC", usd: 1000, debtUsd: 0, debtApr: 0, returns: zeros(60) },
    { asset: "USDT", usd: 0, debtUsd: 500, debtApr: 10, returns: [] },
  ],
  loans: [{ id: "L1", asset: "USDT", collateralAsset: "BTC", debtUsd: 500, collateralUsd: 1000, apr: 10, marginCallLtv: 85, liqLtv: 91 }],
};

describe("forecast", () => {
  it("seededRandom_sameSeed_sameSequenceInRange", () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    for (let index = 0; index < 100; index++) {
      const value = a();
      assert.equal(value, b());
      assert.ok(value >= 0 && value < 1);
    }
  });

  it("percentile_interpolatesBetweenNeighbours", () => {
    assert.equal(percentile([0, 10, 20, 30, 40], 0.5), 20);
    assert.equal(percentile([0, 10], 0.25), 2.5);
    assert.ok(Number.isNaN(percentile([], 0.5)));
  });

  it("runForecast_shortHistory_notAvailable", () => {
    const result = runForecast({ ...base, assets: [{ asset: "BTC", usd: 1000, debtUsd: 0, debtApr: 0, returns: zeros(10) }] });
    assert.deepEqual(result, { ok: false, reason: "no_history" });
  });

  it("runForecast_flatPrices_onlyInterestMovesNetWorth", () => {
    const result = runForecast(base);
    assert.ok(result.ok);
    assert.equal(result.start, 500);
    const year = result.horizons.find((horizon) => horizon.day === 365);
    assert.ok(year);
    assert.ok(Math.abs(year.p50 - 450) < 1e-3);
    assert.ok(Math.abs(year.p10 - year.p90) < 1e-3);
    assert.equal(year.lowerProb, 1);
    assert.deepEqual(result.loans[0], { id: "L1", margin30: 0, margin90: 0, liq30: 0, liq90: 0 });
  });

  it("runForecast_volatileCollateral_ordersBandsAndOdds", () => {
    const input: ForecastInput = {
      ...base,
      assets: [
        { asset: "BTC", usd: 1000, debtUsd: 0, debtApr: 0, returns: swings(120, 0.06) },
        { asset: "USDT", usd: 0, debtUsd: 800, debtApr: 5, returns: [] },
      ],
      loans: [{ id: "L1", asset: "USDT", collateralAsset: "BTC", debtUsd: 800, collateralUsd: 1000, apr: 5, marginCallLtv: 85, liqLtv: 91 }],
    };
    const result = runForecast(input);
    assert.ok(result.ok);
    for (let day = 0; day < result.p50.length; day += 30) {
      assert.ok((result.p10[day] as number) <= (result.p25[day] as number) + 1e-6);
      assert.ok((result.p25[day] as number) <= (result.p50[day] as number) + 1e-6);
      assert.ok((result.p50[day] as number) <= (result.p75[day] as number) + 1e-6);
      assert.ok((result.p75[day] as number) <= (result.p90[day] as number) + 1e-6);
    }
    const odds = result.loans[0];
    assert.ok(odds);
    assert.ok(odds.margin90 > 0);
    assert.ok(odds.margin30 <= odds.margin90);
    assert.ok(odds.liq90 <= odds.margin90);
    assert.deepEqual(runForecast(input), result);
  });

  it("runForecast_drift_noneRemovesTrendHistoryKeepsIt", () => {
    const rising = { ...base, assets: [{ asset: "BTC", usd: 1000, debtUsd: 0, debtApr: 0, returns: Array.from({ length: 60 }, () => 0.001) }], loans: [] };
    const flat = runForecast({ ...rising, drift: "none" });
    const trend = runForecast({ ...rising, drift: "history" });
    assert.ok(flat.ok && trend.ok);
    assert.ok(Math.abs((flat.p50[365] as number) - 1000) < 1e-3);
    assert.ok(Math.abs((trend.p50[365] as number) - 1000 * Math.exp(0.365)) < 0.5);
  });
});
