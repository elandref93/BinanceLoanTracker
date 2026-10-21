import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseTicker24hPercents } from "./positions";

describe("parseTicker24hPercents", () => {
  it("parseTicker24hPercents_miniTickerWithoutPercent_usesOpenAndLast", () => {
    const parsed = parseTicker24hPercents([
      { symbol: "BTCUSDT", openPrice: "100", lastPrice: "110" },
    ]);
    assert.equal(parsed.BTC, 10);
  });

  it("parseTicker24hPercents_fullTicker_keepsListedPercent", () => {
    const parsed = parseTicker24hPercents({
      symbol: "ETHUSDT",
      priceChangePercent: "-2.5",
      openPrice: "100",
      lastPrice: "90",
    });
    assert.equal(parsed.ETH, -2.5);
  });

  it("parseTicker24hPercents_missingPrices_omitsTheAsset", () => {
    const parsed = parseTicker24hPercents([
      { symbol: "XRPUSDT" },
      { symbol: "BNBBTC", openPrice: "1", lastPrice: "2" },
      { symbol: "USDT", openPrice: "1", lastPrice: "1" },
    ]);
    assert.deepEqual(parsed, {});
  });
});
