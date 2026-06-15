import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { LunoTransaction } from "@workspace/api-client-react";

import { filterLunoTxsForContainer } from "./lunoFunding";
import { buildSchedule } from "./loanRepaymentPlan";

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
