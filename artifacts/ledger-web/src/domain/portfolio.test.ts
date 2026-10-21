import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ASSET_NOT_FOUND,
  CHART_EMPTY,
  COLLATERAL_ABSENT,
  COLLATERAL_FROM_LIVE,
  COLLATERAL_FROM_SNAPSHOT,
  FILTER_EMPTY,
  HOLDINGS_ABSENT,
  HOLDINGS_UNFILTERED,
  NO_OPEN_LOANS,
  PORTFOLIO_MISSING,
  PRICE_UNAVAILABLE,
  QTY_UNAVAILABLE,
  RATE_UNAVAILABLE,
  WALLET_BALANCES_ABSENT,
  aggregatePositions,
  allocationSummary,
  assetDetail,
  choosePositions,
  displayAsset,
  portfolioPaint,
  slicePage,
  unitPriceUsd,
} from "./portfolio";

const btcLive = {
  id: "loan-btc",
  accountId: "link-personal",
  collateral: { asset: "BTC", qty: 0.5, valueUsd: 2000 },
};
const xbtLive = {
  id: "loan-xbt",
  accountId: "link-trust",
  collateral: { asset: "xbt", qty: 0.25, valueUsd: 1000 },
};
const ethLive = {
  id: "loan-eth",
  accountId: "link-personal",
  collateral: { asset: "ETH", qty: 2, valueUsd: 500 },
};

const snapshot = {
  asOf: "2026-10-09T22:30:00.000Z",
  holdingsUsd: 300,
  fxUsdToZar: 18,
  loans: [
    {
      id: "snap-btc",
      accountId: "link-personal",
      collateralAsset: "BTC",
      collateralValueUsd: 2000,
    },
  ],
};

function ready(input: Parameters<typeof portfolioPaint>[0]) {
  const paint = portfolioPaint(input);
  assert.equal(paint.kind, "ready");
  if (paint.kind !== "ready") throw new Error("expected a portfolio");
  return paint.view;
}

describe("displayAsset", () => {
  it("displayAsset_xbt_isBtc", () => {
    assert.equal(displayAsset("xbt"), "BTC");
    assert.equal(displayAsset(" Eth "), "ETH");
  });
});

describe("aggregatePositions", () => {
  it("aggregatePositions_mergesXbtIntoBtc_withoutAddingHoldings", () => {
    const chosen = choosePositions({
      liveFailed: false,
      liveLoans: [btcLive, xbtLive, ethLive],
      snapshotFailed: false,
      snapshotLoans: snapshot.loans,
    });
    const assets = aggregatePositions(chosen.positions, null);
    assert.equal(assets[0]?.symbol, "BTC");
    assert.equal(assets[0]?.usd, 3000);
    assert.equal(assets[0]?.qty, 0.75);
    assert.equal(assets[1]?.symbol, "ETH");
    assert.equal(assets[1]?.usd, 500);
    assert.equal(allocationSummary(assets).includes("BTC"), true);
    assert.equal(allocationSummary(assets).includes("wallet balance"), true);
  });

  it("aggregatePositions_partialQuantity_doesNotInventATotal", () => {
    const assets = aggregatePositions(
      [
        {
          id: "a",
          accountId: "link-1",
          collateralAsset: "BTC",
          collateralValueUsd: 100,
          collateralQty: 1,
        },
        {
          id: "b",
          accountId: "link-1",
          collateralAsset: "BTC",
          collateralValueUsd: 50,
          collateralQty: null,
        },
      ],
      null,
    );
    assert.equal(assets[0]?.qty, null);
    assert.equal(assets[0]?.usd, 150);
    assert.equal(assets[0]?.positions[0]?.qty, 1);
    assert.equal(assets[0]?.positions[1]?.qty, null);
  });

  it("aggregatePositions_filter_keepsOnlyThatProfile", () => {
    const chosen = choosePositions({
      liveFailed: false,
      liveLoans: [btcLive, ethLive, xbtLive],
      snapshotFailed: false,
      snapshotLoans: null,
    });
    const personal = aggregatePositions(chosen.positions, new Set(["link-personal"]));
    assert.deepEqual(
      personal.map((asset) => asset.symbol),
      ["BTC", "ETH"],
    );
    assert.equal(personal[0]?.usd, 2000);
  });

  it("aggregatePositions_zeroTotal_hasNoShare", () => {
    const assets = aggregatePositions(
      [
        {
          id: "a",
          accountId: "link-1",
          collateralAsset: "BTC",
          collateralValueUsd: 0,
          collateralQty: null,
        },
      ],
      null,
    );
    assert.equal(assets[0]?.sharePct, null);
    assert.equal(allocationSummary(assets), CHART_EMPTY);
  });
});

describe("choosePositions", () => {
  it("choosePositions_liveLoans_ignoreSnapshotRows", () => {
    const chosen = choosePositions({
      liveFailed: false,
      liveLoans: [ethLive],
      snapshotFailed: false,
      snapshotLoans: snapshot.loans,
    });
    assert.equal(chosen.source, "live");
    assert.equal(chosen.positions.length, 1);
    assert.equal(chosen.positions[0]?.collateralAsset, "ETH");
    assert.equal(chosen.positions[0]?.collateralQty, 2);
  });

  it("choosePositions_emptyLive_usesSnapshotAndOmitsQuantity", () => {
    const chosen = choosePositions({
      liveFailed: false,
      liveLoans: [],
      snapshotFailed: false,
      snapshotLoans: snapshot.loans,
    });
    assert.equal(chosen.source, "snapshot");
    assert.equal(chosen.positions[0]?.collateralQty, null);
    assert.equal(chosen.positions[0]?.collateralValueUsd, 2000);
  });

  it("choosePositions_unreadableLoan_isDropped", () => {
    const chosen = choosePositions({
      liveFailed: false,
      liveLoans: [{ id: "bad" }, ethLive],
      snapshotFailed: false,
      snapshotLoans: null,
    });
    assert.equal(chosen.dropped, 1);
    assert.equal(chosen.positions.length, 1);
  });
});

describe("portfolioPaint", () => {
  const idle = {
    snapshotPending: false,
    snapshotFailed: false,
    livePending: false,
    liveFailed: false,
    currency: "USD" as const,
    filterAccountIds: null,
    filterActive: false,
    page: 1,
  };

  it("portfolioPaint_pending_staysLoading", () => {
    const paint = portfolioPaint({
      ...idle,
      snapshotPending: true,
      snapshot: null,
      liveLoans: null,
    });
    assert.equal(paint.kind, "loading");
  });

  it("portfolioPaint_noSnapshotAndNoLoans_staysEmpty", () => {
    const paint = portfolioPaint({
      ...idle,
      snapshot: null,
      liveLoans: [],
    });
    assert.equal(paint.kind, "blocked");
    if (paint.kind === "blocked") {
      assert.equal(paint.message, PORTFOLIO_MISSING);
      assert.equal(/\d/.test(paint.message), false);
    }
  });

  it("portfolioPaint_holdingsOnly_doesNotInventAssets", () => {
    const view = ready({
      ...idle,
      snapshot: { asOf: snapshot.asOf, holdingsUsd: 300, fxUsdToZar: 18 },
      liveLoans: [],
    });
    assert.equal(view.holdings, "$300,00");
    assert.equal(view.assets.length, 0);
    assert.equal(view.collateralNote, NO_OPEN_LOANS);
    assert.equal(view.chartSummary, CHART_EMPTY);
    assert.equal(view.walletNote, WALLET_BALANCES_ABSENT);
    assert.match(view.asOfLabel ?? "", /00:30/);
    assert.equal(view.fxLabel, "R18,00 per USD");
  });

  it("portfolioPaint_omittedLoanList_saysCollateralIsAbsent", () => {
    const view = ready({
      ...idle,
      liveFailed: true,
      liveLoans: null,
      snapshot: { asOf: snapshot.asOf, holdingsUsd: 300, fxUsdToZar: 18 },
    });
    assert.equal(view.holdings, "$300,00");
    assert.equal(view.assets.length, 0);
    assert.equal(view.collateralNote, COLLATERAL_ABSENT);
  });

  it("portfolioPaint_missingHoldings_saysSo", () => {
    const view = ready({
      ...idle,
      snapshot: { asOf: snapshot.asOf, loans: [] },
      liveLoans: [],
    });
    assert.equal(view.holdings, null);
    assert.equal(view.holdingsNote, HOLDINGS_ABSENT);
    assert.equal(view.collateralNote, NO_OPEN_LOANS);
  });

  it("portfolioPaint_zar_usesSnapshotRate", () => {
    const view = ready({
      ...idle,
      currency: "ZAR",
      snapshot: { asOf: snapshot.asOf, holdingsUsd: 300, fxUsdToZar: 18, loans: [] },
      liveLoans: [],
    });
    assert.equal(view.holdings, "R5 400,00");
  });

  it("portfolioPaint_zarWithoutRate_doesNotGuess", () => {
    const view = ready({
      ...idle,
      currency: "ZAR",
      snapshot: { asOf: snapshot.asOf, holdingsUsd: 300, loans: snapshot.loans },
      liveLoans: [],
    });
    assert.equal(view.holdings, null);
    assert.equal(view.holdingsNote, RATE_UNAVAILABLE);
    assert.equal(view.assets[0]?.value, RATE_UNAVAILABLE);
  });

  it("portfolioPaint_snapshotCollateral_isSeparateFromHoldings", () => {
    const view = ready({
      ...idle,
      snapshot,
      liveLoans: [],
    });
    assert.equal(view.holdings, "$300,00");
    assert.equal(view.assets[0]?.symbol, "BTC");
    assert.equal(view.assets[0]?.value, "$2 000,00");
    assert.equal(view.assets[0]?.quantity, QTY_UNAVAILABLE);
    assert.equal(view.collateralNote, COLLATERAL_FROM_SNAPSHOT);
    assert.equal(view.sourceNote, "Using the saved snapshot.");
  });

  it("portfolioPaint_liveCollateral_includesQuantity", () => {
    const view = ready({
      ...idle,
      snapshot,
      liveLoans: [btcLive, ethLive],
    });
    assert.equal(view.collateralNote, COLLATERAL_FROM_LIVE);
    assert.equal(view.assets[0]?.quantity, "0,5000 BTC");
    assert.equal(view.sourceNote, null);
  });

  it("portfolioPaint_profileFilter_doesNotSplitHoldings", () => {
    const view = ready({
      ...idle,
      snapshot,
      liveLoans: [btcLive, xbtLive],
      filterActive: true,
      filterAccountIds: new Set(["link-trust"]),
    });
    assert.equal(view.holdings, "$300,00");
    assert.equal(view.holdingsNote, HOLDINGS_UNFILTERED);
    assert.equal(view.assets.length, 1);
    assert.equal(view.assets[0]?.symbol, "BTC");
    assert.equal(view.assets[0]?.value, "$1 000,00");
  });

  it("portfolioPaint_profileFilter_emptyCollateral", () => {
    const view = ready({
      ...idle,
      snapshot,
      liveLoans: [btcLive],
      filterActive: true,
      filterAccountIds: new Set(["link-trust"]),
    });
    assert.equal(view.filterEmptyNote, FILTER_EMPTY);
    assert.equal(view.assets.length, 0);
  });

  it("portfolioPaint_pagesCollateralRows", () => {
    const view = ready({
      ...idle,
      snapshot: { asOf: snapshot.asOf, holdingsUsd: 1, loans: [] },
      liveLoans: [btcLive, ethLive, { ...ethLive, id: "loan-eth-2", collateral: { asset: "SOL", qty: 3, valueUsd: 90 } }],
      page: 2,
      pageSize: 2,
    });
    assert.equal(view.pageCount, 2);
    assert.equal(view.page, 2);
    assert.equal(view.assets.length, 1);
    assert.equal(view.assets[0]?.symbol, "SOL");
  });
});

describe("assetDetail", () => {
  it("assetDetail_price_usesReturnedQuantity", () => {
    const chosen = choosePositions({
      liveFailed: false,
      liveLoans: [btcLive],
      snapshotFailed: false,
      snapshotLoans: null,
    });
    const paint = portfolioPaint({
      snapshotPending: false,
      snapshotFailed: false,
      snapshot,
      livePending: false,
      liveFailed: false,
      liveLoans: [btcLive],
      currency: "USD",
      filterAccountIds: null,
      filterActive: false,
      page: 1,
    });
    const detail = assetDetail({
      symbol: "btc",
      paint,
      accountLabels: new Map([["link-personal", "Personal"]]),
      currency: "USD",
      fx: 18,
      positions: chosen.positions,
      filterAccountIds: null,
      page: 1,
    });
    assert.equal(detail.kind, "asset");
    if (detail.kind !== "asset") return;
    assert.equal(detail.view.quantity, "0,5000 BTC");
    assert.equal(detail.view.price, "$4 000,00");
    assert.equal(detail.view.positions[0]?.accountLabel, "Personal");
    assert.equal(unitPriceUsd(2000, 0.5), 4000);
  });

  it("assetDetail_snapshotQuantity_doesNotInventAPrice", () => {
    const chosen = choosePositions({
      liveFailed: false,
      liveLoans: [],
      snapshotFailed: false,
      snapshotLoans: snapshot.loans,
    });
    const paint = portfolioPaint({
      snapshotPending: false,
      snapshotFailed: false,
      snapshot,
      livePending: false,
      liveFailed: false,
      liveLoans: [],
      currency: "USD",
      filterAccountIds: null,
      filterActive: false,
      page: 1,
    });
    const detail = assetDetail({
      symbol: "BTC",
      paint,
      accountLabels: new Map(),
      currency: "USD",
      fx: 18,
      positions: chosen.positions,
      filterAccountIds: null,
      page: 1,
    });
    assert.equal(detail.kind, "asset");
    if (detail.kind !== "asset") return;
    assert.equal(detail.view.price, null);
    assert.equal(detail.view.priceNote, PRICE_UNAVAILABLE);
    assert.equal(detail.view.quantity, QTY_UNAVAILABLE);
  });

  it("assetDetail_unknownSymbol_staysMissing", () => {
    const paint = portfolioPaint({
      snapshotPending: false,
      snapshotFailed: false,
      snapshot,
      livePending: false,
      liveFailed: false,
      liveLoans: [],
      currency: "USD",
      filterAccountIds: null,
      filterActive: false,
      page: 1,
    });
    const detail = assetDetail({
      symbol: "DOGE",
      paint,
      accountLabels: new Map(),
      currency: "USD",
      fx: 18,
      positions: [],
      filterAccountIds: null,
      page: 1,
    });
    assert.equal(detail.kind, "missing");
    if (detail.kind === "missing") assert.equal(detail.message, ASSET_NOT_FOUND);
  });
});

describe("slicePage", () => {
  it("slicePage_clampsThePage", () => {
    const page = slicePage(["a", "b", "c"], 9, 2);
    assert.equal(page.page, 2);
    assert.deepEqual(page.items, ["c"]);
  });
});
