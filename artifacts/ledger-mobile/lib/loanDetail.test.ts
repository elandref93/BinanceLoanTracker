import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { LunoTransaction } from "@workspace/api-client-react";

import {
  documentedConversionRate,
  evaluateRepaymentRateAlert,
  evaluateRepaymentRateAlerts,
  isStableBorrowAsset,
} from "./repaymentRateAlerts";
import { filterLunoTxsForContainer } from "./lunoFunding";
import {
  buildCollateralSchedule,
  buildSchedule,
  monthsToTargetLtv,
} from "./loanRepaymentPlan";

function lunoTx(
  accountId: string,
  accountName: string,
  asset: string,
  amount: number,
): LunoTransaction {
  return {
    accountId,
    accountName,
    walletId: "w1",
    asset,
    rowIndex: 0,
    ts: "2026-01-01T12:00:00.000Z",
    amount,
    balance: 100,
    description: "",
  };
}

describe("filterLunoTxsForContainer", () => {
  it("keeps only txs for Luno links on the given container", () => {
    const personalLuno = "link_personal_luno";
    const trustLuno = "link_trust_luno";
    const txs = [
      lunoTx(personalLuno, "Personal", "USDT", 100),
      lunoTx(trustLuno, "Trust", "USDT", 200),
    ];
    const filtered = filterLunoTxsForContainer(txs, {
      links: [
        { id: personalLuno, exchange: "luno" },
        { id: "link_personal_binance", exchange: "binance" },
      ],
    });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.accountName, "Personal");
  });

  it("returns empty when container has no Luno link", () => {
    const txs = [lunoTx("x", "Personal", "USDT", 1)];
    assert.equal(
      filterLunoTxsForContainer(txs, {
        links: [{ id: "b1", exchange: "binance" }],
      }).length,
      0,
    );
  });
});

describe("buildSchedule", () => {
  it("accrues non-zero interest when principal and rate are positive", () => {
    const rows = buildSchedule(10_000, 0.01, 500, 3);
    assert.ok(rows.length >= 1);
    assert.ok(rows[0]!.interest > 0);
    assert.equal(rows[0]!.interest, 100);
  });
});

describe("buildCollateralSchedule", () => {
  it("lowers LTV as collateral grows and stops at the target", () => {
    const rows = buildCollateralSchedule({
      debt: 50_000,
      collateralValue: 100_000, // start LTV 50%
      collateralQty: 2,
      collateralPriceUsd: 50_000,
      monthlyRate: 0.005,
      monthlyContribution: 20_000,
      targetLtv: 30,
    });
    assert.ok(rows.length >= 1);
    // LTV is monotonically decreasing while contribution outpaces interest.
    assert.ok(rows[0]!.ltv < 50);
    const last = rows[rows.length - 1]!;
    assert.ok(last.ltv <= 30);
    assert.ok(last.collateralQty > 2);
    assert.ok(last.liqPrice > 0);
  });

  it("never reaches target when interest outpaces contribution", () => {
    const months = monthsToTargetLtv({
      debt: 50_000,
      collateralValue: 60_000, // LTV ~83%
      collateralQty: 1,
      collateralPriceUsd: 60_000,
      monthlyRate: 0.05,
      monthlyContribution: 1, // negligible
      targetLtv: 30,
    });
    assert.equal(months, null);
  });

  it("returns 0 months when already at/below target", () => {
    const months = monthsToTargetLtv({
      debt: 20_000,
      collateralValue: 100_000, // LTV 20%
      collateralQty: 2,
      collateralPriceUsd: 50_000,
      monthlyRate: 0.01,
      monthlyContribution: 1_000,
      targetLtv: 30,
    });
    assert.equal(months, 0);
  });
});

describe("effectiveLoanApr", () => {
  it("prefers quoted apr, then hourly, then fallback", () => {
    assert.equal(effectiveLoanApr({ apr: 7.5, hourlyInterestRate: 0 }), 7.5);
    assert.equal(
      effectiveLoanApr({ apr: 0, hourlyInterestRate: 0.0000057 }),
      0.0000057 * HOURS_PER_YEAR * 100,
    );
    assert.equal(
      effectiveLoanApr({ apr: 0, hourlyInterestRate: 0 }, 6.25),
      6.25,
    );
    assert.equal(effectiveLoanApr({ apr: 0, hourlyInterestRate: 0 }), 0);
  });
});

describe("repaymentRateAlerts", () => {
  it("identifies stable borrow assets", () => {
    assert.equal(isStableBorrowAsset("USDC"), true);
    assert.equal(isStableBorrowAsset("usdt"), true);
    assert.equal(isStableBorrowAsset("BTC"), false);
  });

  it("prefers explicit sellRate over borrowedValueZar / debt", () => {
    assert.equal(
      documentedConversionRate({ sellRate: 16.5, borrowedValueZar: 100_000 }, 10_000),
      16.5,
    );
    assert.equal(
      documentedConversionRate({ borrowedValueZar: 165_000 }, 10_000),
      16.5,
    );
  });

  it("notifies when live Luno rate is at or below documented conversion rate", () => {
    const tickers = new Map([["USDCZAR", 16.2]]);
    const result = evaluateRepaymentRateAlert(
      { asset: "USDC", debt: 10_000 },
      { sellRate: 16.5 },
      tickers,
    );
    assert.equal(result.shouldNotify, true);
    assert.equal(result.suppressed, false);
  });

  it("uses target rate instead of conversion rate when a custom target is set", () => {
    const tickers = new Map([["USDCZAR", 15.9]]);
    const result = evaluateRepaymentRateAlert(
      { asset: "USDC", debt: 10_000 },
      { sellRate: 16.5, targetRepaymentUsdcZarRate: 16.0 },
      tickers,
    );
    assert.equal(result.shouldNotify, true);
    assert.equal(result.suppressed, true);
    assert.equal(result.kind, "target");
    assert.equal(result.threshold, 16.0);
  });

  it("notifies when live Luno rate hits a custom target repayment rate", () => {
    const tickers = new Map([["USDCZAR", 16.0]]);
    const evals = evaluateRepaymentRateAlerts(
      { asset: "USDC", debt: 10_000 },
      { targetRepaymentUsdcZarRate: 16.2 },
      tickers,
    );
    assert.equal(evals.length, 1);
    assert.equal(evals[0]?.kind, "target");
    assert.equal(evals[0]?.shouldNotify, true);
    assert.equal(evals[0]?.threshold, 16.2);
  });

  it("does not notify when live rate is above custom target repayment rate", () => {
    const tickers = new Map([["USDCZAR", 16.5]]);
    const evals = evaluateRepaymentRateAlerts(
      { asset: "USDC", debt: 10_000 },
      { targetRepaymentUsdcZarRate: 16.2 },
      tickers,
    );
    assert.equal(evals[0]?.shouldNotify, false);
  });

  it("does not notify when live rate is above documented conversion rate", () => {
    const tickers = new Map([["USDCZAR", 16.8]]);
    const result = evaluateRepaymentRateAlert(
      { asset: "USDC", debt: 10_000 },
      { sellRate: 16.5 },
      tickers,
    );
    assert.equal(result.shouldNotify, false);
  });
});
