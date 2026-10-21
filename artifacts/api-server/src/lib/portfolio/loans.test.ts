import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deriveFrom } from "./derived";
import { toHistoryPoint } from "./history";
import { buildLoans, pointLoanLtvs, triggerPrice } from "./loans";
import type { PriceBook } from "./prices";
import { DAY_MS } from "./time";
import type { DebtPosition, PortfolioState } from "./types";

const AS_OF = Date.parse("2026-10-11T10:00:00Z");

const book: PriceBook = {
  close: () => 0,
  fx: () => 18,
  fxIsReference: () => false,
  hourly: () => [],
  daily: () => ({}),
};

function loan(partial: Partial<DebtPosition>): DebtPosition {
  return {
    loanId: "loan-a",
    exchange: "binance",
    linkId: "L1",
    containerId: "P",
    asset: "USDT",
    qty: 30_000,
    collateralAsset: "BTC",
    collateralQty: 1,
    ltv: 50,
    marginCallLtv: 85,
    liqLtv: 91,
    apr: 7.3,
    hourlyRate: 0.0000083,
    ...partial,
  };
}

function state(asOf: number, btc: number, debts: DebtPosition[]): PortfolioState {
  return {
    asOf,
    positions: [
      { exchange: "binance", linkId: "L1", linkName: "Personal Binance", containerId: "P", wallet: "collateral", asset: "BTC", qty: 1 },
      { exchange: "binance", linkId: "L2", linkName: "Trust Binance", containerId: "T", wallet: "collateral", asset: "BTC", qty: 1 },
    ],
    debts,
    prices: { BTC: btc },
    change24h: {},
    fx: 18,
    fxSource: "luno",
    containers: [
      { id: "P", name: "Personal", type: "personal", linkIds: ["L1"], targetLtv: 65 },
      { id: "T", name: "Trust", type: "trust", linkIds: ["L2"], targetLtv: 40 },
    ],
    errors: [],
  };
}

const debts = [
  loan({}),
  loan({ loanId: "loan-b", linkId: "L2", containerId: "T", qty: 24_000 }),
];

describe("loan views", () => {
  it("triggerPrice_debtAndCollateral_returnsPriceAtLtv", () => {
    assert.equal(triggerPrice(30_000, 1, 50), 60_000);
    assert.equal(triggerPrice(30_000, 0, 50), null);
    assert.equal(triggerPrice(30_000, 1, null), null);
  });

  it("toHistoryPoint_openLoans_recordsDebtCollateralAndProfile", () => {
    const point = toHistoryPoint(state(AS_OF, 60_000, debts));
    assert.deepEqual(point.l, { "loan-a": [30_000, 60_000, "P"], "loan-b": [24_000, 60_000, "T"] });
    assert.deepEqual(pointLoanLtvs(point, new Set(["T"])), { ltv: 40, loans: { "loan-b": 40 }, profiles: { T: 40 } });
  });

  it("buildLoans_twoProfiles_usesEachProfileTargetAndRanksByLtv", () => {
    const earlier = toHistoryPoint(state(AS_OF - 7 * DAY_MS, 75_000, debts));
    const derived = deriveFrom({ state: state(AS_OF, 60_000, debts), points: [earlier], ledger: null, book });
    const view = buildLoans(derived, "1M", undefined);
    assert.deepEqual(view.loans.map((item) => item.loanId), ["loan-a", "loan-b"]);
    const [first, second] = view.loans;
    assert.equal(first?.targetLtv, 65);
    assert.equal(second?.targetLtv, 40);
    assert.equal(first?.profileName, "Personal");
    assert.equal(first?.linkName, "Personal Binance");
    assert.equal(first?.priceAtMarginCallUsd, 35_294.118);
    assert.equal(first?.ltvChange7d, 10);
    assert.equal(view.totals.ltv, 45);
    assert.equal(view.historyBasis, "loans");
    assert.deepEqual(view.history.map((point) => point.ltv), [36, 45]);
  });

  it("buildLoans_scopedWithoutLoanHistory_ignoresAggregateFallback", () => {
    const derived = deriveFrom({ state: state(AS_OF, 60_000, debts), points: [], ledger: null, book });
    const aggregate = [{ t: new Date(AS_OF - 2 * DAY_MS).toISOString(), ltv: 44 }];
    assert.equal(buildLoans(derived, "1M", "T", aggregate).historyBasis, "none");
    const all = buildLoans(derived, "1M", undefined, aggregate);
    assert.equal(all.historyBasis, "aggregate");
    assert.deepEqual(all.history.map((point) => point.ltv), [44, 45]);
  });
});
