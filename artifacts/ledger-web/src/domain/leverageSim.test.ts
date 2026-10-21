import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Loan } from "@workspace/api-client-react";

import { getUsdToZar, setUsdToZar } from "./format";
import { compute, DEFAULT_INPUTS, snapshotFromLoans } from "./leverageSim";

function roundedExit(taxMode: "personal" | "trust" | "taxfree", startingCapital = 0) {
  const result = compute({ ...DEFAULT_INPUTS, taxMode, startingCapital });
  const lastA = result.rowsA[result.rowsA.length - 1];
  const lastB = result.rowsB[result.rowsB.length - 1];
  if (!lastA || !lastB) throw new Error("expected year rows");
  return {
    a: Math.round(lastA.net),
    b: Math.round(lastB.net),
    tax: Math.round(result.totTaxA),
  };
}

describe("compute ZAR CGT fixtures", () => {
  it("compute_trustZeroStart_matchesDocumentedExit", () => {
    assert.deepEqual(roundedExit("trust"), {
      a: 507_032_037,
      b: 515_379_634,
      tax: 161_160_147,
    });
  });

  it("compute_personalZeroStart_matchesDocumentedExit", () => {
    assert.deepEqual(roundedExit("personal"), {
      a: 725_693_156,
      b: 640_087_356,
      tax: 100_645_095,
    });
  });

  it("compute_taxFreeZeroStart_matchesDocumentedExit", () => {
    assert.deepEqual(roundedExit("taxfree"), {
      a: 1_017_828_134,
      b: 764_780_678,
      tax: 0,
    });
  });

  it("compute_trustFiveMillionStart_matchesDocumentedExit", () => {
    const exit = roundedExit("trust", 5_000_000);
    assert.equal(exit.a, 625_704_593);
    assert.equal(exit.b, 648_650_644);
  });

  it("compute_tenPercentEscalation_matchesContributionFixture", () => {
    const result = compute({ ...DEFAULT_INPUTS, contribEscalation: 10, startingCapital: 0 });
    const first = result.rowsA[0];
    const last = result.rowsA[result.rowsA.length - 1];
    if (!first || !last) throw new Error("expected year rows");
    assert.equal(Math.round(last.contributed), 114_749_457);
    assert.equal(Math.round(first.monthlyAtYear), 600_000);
    assert.equal(Math.round(last.monthlyAtYear), 1_414_769);
  });
});

describe("snapshotFromLoans", () => {
  it("snapshotFromLoans_noBtc_returnsNulls", () => {
    const loans = [
      {
        collateral: { asset: "ETH", qty: 1, valueUsd: 100 },
        debtUsd: 40,
        apr: 9,
      },
    ] as Loan[];
    assert.deepEqual(snapshotFromLoans(loans), {
      collateralZar: null,
      weightedAprPct: null,
      currentLtvPct: null,
    });
    assert.deepEqual(snapshotFromLoans([]), {
      collateralZar: null,
      weightedAprPct: null,
      currentLtvPct: null,
    });
  });

  it("snapshotFromLoans_btc_usesSuppliedRate", () => {
    const previous = getUsdToZar();
    setUsdToZar(20);
    try {
      const loans = [
        {
          collateral: { asset: "BTC", qty: 0.5, valueUsd: 100 },
          debtUsd: 40,
          apr: 3,
        },
        {
          collateral: { asset: "btc", qty: 0.1, valueUsd: 50 },
          debtUsd: 10,
          apr: 6,
        },
      ] as Loan[];
      const snap = snapshotFromLoans(loans);
      assert.equal(snap.collateralZar, 3_000);
      assert.equal(snap.weightedAprPct, 3.6);
      assert.equal(snap.currentLtvPct, (50 / 150) * 100);
    } finally {
      setUsdToZar(previous);
    }
  });
});
