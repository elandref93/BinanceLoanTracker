import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PnlPeriod, PortfolioOverview } from "@workspace/api-client-react";

import { homeInsights } from "./insights";

const period = (partial: Partial<PnlPeriod> = {}): PnlPeriod => ({
  from: "2026-10-05T00:00:00.000Z",
  startUsd: 100_000,
  endUsd: 100_000,
  pnlUsd: 0,
  pct: 0,
  flowsUsd: 0,
  basis: "ledger",
  attribution: null,
  byProfile: [],
  spark: [],
  ...partial,
});

function overview(partial: Partial<PortfolioOverview> = {}): PortfolioOverview {
  return {
    available: true,
    asOf: "2026-10-11T10:00:00.000Z",
    scope: "all",
    fxUsdToZar: 18,
    fxSource: "luno",
    totals: { assetsUsd: 150_000, debtUsd: 50_000, netUsd: 100_000 },
    today: period(),
    week: period(),
    month: period(),
    allocation: [
      { asset: "BTC", qty: 2, usd: 120_000, pct: 80 },
      { asset: "USDT", qty: 30_000, usd: 30_000, pct: 20 },
    ],
    movers: [],
    profiles: [],
    exchanges: [],
    loans: { count: 0, debtUsd: 0, collateralUsd: 0, ltv: null, dailyInterestUsd: 0 },
    sparkline: [],
    import: { state: "complete", progress: 1, earliest: null, flaggedCount: 0 },
    flags: [],
    ...partial,
  };
}

const format = {
  signed: (usd: number) => `${usd >= 0 ? "+" : "−"}$${Math.round(Math.abs(usd))}`,
  amount: (usd: number) => `$${Math.round(usd)}`,
  profileName: (id: string) => (id === "trust" ? "Trust" : "Personal"),
};

describe("home insights", () => {
  it("homeInsights_marginCallOutranksEverything", () => {
    const cards = homeInsights(
      overview({
        profiles: [
          { containerId: "trust", name: "Trust", type: "trust", assetsUsd: 1, debtUsd: 1, netUsd: 0, ltv: 86, targetLtv: 60 },
          { containerId: "me", name: "Me", type: "personal", assetsUsd: 1, debtUsd: 1, netUsd: 0, ltv: 62, targetLtv: 55 },
        ],
        today: period({ pct: 5, pnlUsd: 5_000 }),
      }),
      format,
    );
    assert.equal(cards[0]?.tone, "danger");
    assert.match(cards[0]?.title ?? "", /^Trust LTV is 86,0%/);
    assert.equal(cards[1]?.tone, "warn");
    assert.match(cards[1]?.title ?? "", /above its 55% target/);
    assert.equal(cards.length, 3);
  });

  it("homeInsights_weekDriver_skipsStablecoinsAndShowsPct", () => {
    const cards = homeInsights(
      overview({
        week: period({
          attribution: {
            marketUsd: 10_000,
            incomeUsd: 0,
            costsUsd: 0,
            otherUsd: 0,
            byAsset: [
              { asset: "USDT", marketUsd: 12_000 },
              { asset: "BTC", marketUsd: 10_000 },
            ],
          },
        }),
      }),
      format,
    );
    const driver = cards.find((card) => card.id === "driver-BTC");
    assert.ok(driver);
    assert.equal(driver.title, "BTC +9,1% this week added +$10000");
  });

  it("homeInsights_quietPortfolio_onlyConcentration", () => {
    const cards = homeInsights(overview(), format);
    assert.deepEqual(
      cards.map((card) => card.id),
      ["concentration-BTC"],
    );
  });
});
