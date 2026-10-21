import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PortfolioAnalytics } from "@workspace/api-client-react";

import { breakEvenGrowth, distanceToDanger, diversificationScore, forecastInput, shockFactor, stressPortfolio } from "./insightsModel";

describe("insights model", () => {
  it("shockFactor_cryptoDropSparesStablesBtcOnlySparesOthers", () => {
    assert.equal(shockFactor("BTC", "crypto", 30), 0.7);
    assert.equal(shockFactor("USDT", "crypto", 30), 1);
    assert.equal(shockFactor("ZAR", "crypto", 30), 1);
    assert.equal(shockFactor("ETH", "btc", 30), 1);
    assert.equal(shockFactor("BTC", "btc", 120), 0);
  });

  it("stressPortfolio_dropsAssetsAndRaisesLtv", () => {
    const result = stressPortfolio(
      [
        { asset: "BTC", usd: 1000, debtUsd: 0 },
        { asset: "USDT", usd: 100, debtUsd: 500 },
      ],
      [{ loanId: "L1", asset: "USDT", collateralAsset: "BTC", debtUsd: 500, collateralUsd: 1000, ltv: 50 }],
      "crypto",
      50,
    );
    assert.equal(result.netBefore, 600);
    assert.equal(result.netAfter, 100);
    assert.ok(Math.abs((result.changePct ?? 0) - -83.333) < 0.01);
    assert.equal(result.loans[0]?.ltv, 100);
  });

  it("distanceToDanger_nearestTriggerPerCollateral", () => {
    const rows = distanceToDanger([
      { collateralAsset: "BTC", collateralPriceUsd: 100_000, priceAtMarginCallUsd: 60_000, priceAtLiquidationUsd: 55_000 },
      { collateralAsset: "BTC", collateralPriceUsd: 100_000, priceAtMarginCallUsd: 80_000, priceAtLiquidationUsd: 70_000 },
      { collateralAsset: "ETH", collateralPriceUsd: 4000, priceAtMarginCallUsd: 2000, priceAtLiquidationUsd: null },
    ]);
    assert.equal(rows[0]?.asset, "BTC");
    assert.equal(rows[0]?.loanCount, 2);
    assert.equal(rows[0]?.marginPriceUsd, 80_000);
    assert.ok(Math.abs((rows[0]?.marginDropPct ?? 0) - 20) < 1e-9);
    assert.ok(Math.abs((rows[0]?.liqDropPct ?? 0) - 30) < 1e-9);
    assert.equal(rows[1]?.liqDropPct, null);
  });

  it("breakEvenGrowth_aprTimesDebtOverCollateral", () => {
    assert.equal(breakEvenGrowth([{ apr: 10, debtUsd: 600, collateralUsd: 1000 }]), 6);
    assert.equal(breakEvenGrowth([]), null);
  });

  it("diversificationScore_singleAssetZero", () => {
    assert.equal(diversificationScore(1), 0);
    assert.equal(diversificationScore(0.25), 75);
    assert.equal(diversificationScore(0), 0);
  });

  it("forecastInput_residualCoversSmallHoldings", () => {
    const analytics = {
      totals: { assetsUsd: 1000, debtUsd: 400, netUsd: 600 },
      assetReturns: [
        { asset: "BTC", weight: 0.9, debtWeight: 0, returns: [0.01] },
        { asset: "USDT", weight: 0, debtWeight: 0.4, returns: [] },
      ],
      loans: [{ id: "L1", containerId: null, asset: "USDT", collateralAsset: "BTC", debtUsd: 400, collateralUsd: 900, ltv: 44.4, marginCallLtv: 85, liqLtv: 91, apr: 6 }],
    } as unknown as PortfolioAnalytics;
    const input = forecastInput(analytics, "none");
    assert.ok(Math.abs(input.residualUsd - 100) < 1e-9);
    assert.equal(input.assets[1]?.debtApr, 6);
    assert.equal(input.loans.length, 1);
  });
});
