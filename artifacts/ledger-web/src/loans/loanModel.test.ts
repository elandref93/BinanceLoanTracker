import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { LoanHistoryPoint } from "@workspace/api-client-react";

import {
  bandCounts,
  bandStops,
  combinedTarget,
  dropToPct,
  ltvDomain,
  ltvSeries,
  rankLoans,
  seriesSummary,
  stressedLtv,
  toTarget,
} from "./loanModel";

const loan = (id: string, ltv: number, targetLtv: number | null, debtUsd = 1000) => ({ id, ltv, targetLtv, debtUsd });

describe("loan model", () => {
  it("rankLoans_mixedTargets_ranksByEachProfilesOwnTarget", () => {
    const ranked = rankLoans([loan("personal-55", 55, 65), loan("trust-50", 50, 40), loan("margin", 86, 65), loan("default", 66, null)]);
    assert.deepEqual(ranked.map((item) => item.id), ["margin", "trust-50", "default", "personal-55"]);
  });

  it("rankLoans_sameSeverity_largerDebtFirst", () => {
    const ranked = rankLoans([loan("small", 50, 50, 100), loan("large", 50, 50, 900)]);
    assert.deepEqual(ranked.map((item) => item.id), ["large", "small"]);
  });

  it("bandCounts_loans_countsEachBand", () => {
    assert.deepEqual(bandCounts([loan("a", 30, 65), loan("b", 70, 65), loan("c", 92, 65)]), { healthy: 1, above: 1, margin: 0, liquidation: 1 });
  });

  it("combinedTarget_profiles_weightsByDebt", () => {
    assert.equal(combinedTarget([{ debtUsd: 3000, targetLtv: 60 }, { debtUsd: 1000, targetLtv: 40 }]), 55);
    assert.equal(combinedTarget([{ debtUsd: 1000, targetLtv: null }]), 65);
    assert.equal(combinedTarget([]), 65);
  });

  it("dropToPct_priceAndTrigger_returnsPercentFall", () => {
    assert.equal(dropToPct(100, 75), 25);
    assert.ok(Math.abs((dropToPct(100, 110) ?? 0) + 10) < 1e-9);
    assert.equal(dropToPct(null, 75), null);
  });

  it("stressedLtv_priceFalls_raisesLtv", () => {
    assert.equal(stressedLtv(50, -50), 100);
    assert.equal(stressedLtv(50, 100), 25);
    assert.equal(stressedLtv(50, -100), Infinity);
  });

  it("toTarget_aboveAndBelow_reportsWhatItTakes", () => {
    const above = toTarget({ debtUsd: 70, collateralUsd: 100, targetLtv: 50 });
    assert.deepEqual(above, { addCollateralUsd: 40, repayUsd: 20, spareCollateralUsd: 0 });
    const below = toTarget({ debtUsd: 40, collateralUsd: 100, targetLtv: 50 });
    assert.deepEqual(below, { addCollateralUsd: 0, repayUsd: 0, spareCollateralUsd: 20 });
  });

  it("ltvSeries_keys_picksCombinedLoanOrProfileValues", () => {
    const history: LoanHistoryPoint[] = [
      { t: "2026-10-01T00:00:00Z", ltv: 40, loans: { a: 41 }, profiles: { P: 42 } },
      { t: "2026-10-02T00:00:00Z", ltv: null, loans: {}, profiles: {} },
      { t: "2026-10-03T00:00:00Z", ltv: 45, loans: { a: 46 }, profiles: { P: 47 } },
    ];
    assert.deepEqual(ltvSeries(history, { kind: "all" }).map((point) => point.v), [40, 45]);
    assert.deepEqual(ltvSeries(history, { kind: "loan", id: "a" }).map((point) => point.v), [41, 46]);
    assert.deepEqual(ltvSeries(history, { kind: "profile", id: "P" }).map((point) => point.v), [42, 47]);
    assert.deepEqual(seriesSummary(ltvSeries(history, { kind: "all" })), { start: 40, end: 45, low: 40, high: 45 });
  });

  it("ltvDomain_values_alwaysIncludesLiquidationBand", () => {
    assert.deepEqual(ltvDomain([42, 48]), [30, 95]);
    assert.deepEqual(ltvDomain([88, 97]), [80, 100]);
  });

  it("bandStops_targetAboveMargin_dropsEmptyBand", () => {
    assert.deepEqual(bandStops(65).map((stop) => stop.band), ["healthy", "above", "margin", "liquidation"]);
    assert.deepEqual(bandStops(88).map((stop) => stop.band), ["healthy", "margin", "liquidation"]);
  });
});
