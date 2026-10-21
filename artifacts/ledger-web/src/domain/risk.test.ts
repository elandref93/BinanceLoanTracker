import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_TARGET_LTV,
  LIQ_LTV,
  canDeriveCollateralPrice,
  collateralShortfallToTarget,
  currentCollateralPrice,
  headroomToTarget,
  priceAtLtv,
  priceDropPctTo,
  riskBand,
  riskBandLabel,
  riskSeverity,
  statusFromLtv,
  statusLabel,
  type RiskLoan,
} from "./risk";

const loan: RiskLoan = {
  id: "loan-1",
  debtUsd: 650,
  ltv: 32.5,
  collateral: { asset: "BTC", qty: 2, valueUsd: 2000 },
};

describe("statusFromLtv", () => {
  it("statusFromLtv_usesTargetThenWarning", () => {
    assert.equal(statusFromLtv(64.9, DEFAULT_TARGET_LTV), "ok");
    assert.equal(statusFromLtv(65, DEFAULT_TARGET_LTV), "warn");
    assert.equal(statusFromLtv(84.9, DEFAULT_TARGET_LTV), "warn");
    assert.equal(statusFromLtv(85, DEFAULT_TARGET_LTV), "danger");
    assert.equal(statusLabel("ok"), "Healthy");
    assert.equal(statusLabel("warn"), "Caution");
    assert.equal(statusLabel("danger"), "At risk");
  });
});

describe("riskBand", () => {
  it("riskBand_usesProfileTargetThenBinanceLevels", () => {
    assert.equal(riskBand(59.9, 60), "healthy");
    assert.equal(riskBand(60, 60), "above");
    assert.equal(riskBand(85, 60), "margin");
    assert.equal(riskBand(91, 60), "liquidation");
    assert.equal(riskBandLabel("margin"), "Margin call");
  });

  it("riskSeverity_ranksWorstFirst", () => {
    const loans = [
      { id: "a", ltv: 50, target: 65 },
      { id: "b", ltv: 62, target: 60 },
      { id: "c", ltv: 86, target: 65 },
    ];
    const ranked = [...loans].sort((x, y) => riskSeverity(y.ltv, y.target) - riskSeverity(x.ltv, x.target));
    assert.deepEqual(ranked.map((loan) => loan.id), ["c", "b", "a"]);
  });
});

describe("price and headroom", () => {
  it("priceAtLtv_and_priceDrop_matchTheDebtFormula", () => {
    assert.equal(currentCollateralPrice(loan), 1000);
    assert.equal(priceAtLtv(loan, 65), 500);
    assert.equal(priceDropPctTo(loan, 65), 50);
    assert.equal(priceAtLtv(loan, LIQ_LTV), 650 / 2 / (LIQ_LTV / 100));
  });

  it("headroomToTarget_isPositiveBelowTarget_andNegativeAbove", () => {
    assert.equal(headroomToTarget(loan, 65), 1000);
    assert.equal(collateralShortfallToTarget(loan, 65), 0);
    const over: RiskLoan = {
      ...loan,
      collateral: { ...loan.collateral, valueUsd: 500 },
    };
    assert.equal(headroomToTarget(over, 65), -500);
    assert.equal(collateralShortfallToTarget(over, 65), 500);
  });

  it("priceHelpers_returnZeroWhenQuantityIsMissing", () => {
    const snapshotLoan: RiskLoan = {
      ...loan,
      collateral: { asset: "BTC", qty: 0, valueUsd: 2000 },
    };
    assert.equal(canDeriveCollateralPrice(snapshotLoan), false);
    assert.equal(priceAtLtv(snapshotLoan, LIQ_LTV), 0);
    assert.equal(priceDropPctTo(snapshotLoan, LIQ_LTV), 0);
    assert.equal(headroomToTarget(snapshotLoan, 65), 1000);
  });
});
