import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { LunoTransaction } from "@workspace/api-client-react";

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
