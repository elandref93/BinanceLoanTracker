import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Loan } from "@workspace/api-client-react";

import { fmtDate, getUsdToZar } from "./format";
import { compute, DEFAULT_INPUTS } from "./leverageSim";
import { DRAFT_NOT_SAVED } from "./leverageScenarios";
import { RATE_UNAVAILABLE } from "./portfolio";
import {
  buildSummaryHtml,
  chartSummary,
  formatSimMoney,
  inputsFromLivePosition,
  johannesburgMonth,
  positionForDisplay,
  toggleSaTaxYear,
} from "./strategyView";

const btcLoan = {
  collateral: { asset: "BTC", qty: 1, valueUsd: 1_000 },
  debtUsd: 400,
  apr: 3.26,
} as Loan;

describe("saved scenarios", () => {
  it("savedScenarios_unsavedDraft_isNotStoredInTheBrowser", () => {
    assert.match(DRAFT_NOT_SAVED, /not stored in this browser/);
  });
});

describe("positionForDisplay", () => {
  it("positionForDisplay_withoutSnapshotRate_doesNotInventCollateralZar", () => {
    const previous = getUsdToZar();
    const position = positionForDisplay([btcLoan], null);
    assert.equal(position.collateralZar, null);
    assert.equal(position.needsRate, true);
    assert.equal(position.weightedAprPct, 3.26);
    assert.equal(position.currentLtvPct, 40);
    assert.equal(inputsFromLivePosition(DEFAULT_INPUTS, position), null);
    assert.equal(getUsdToZar(), previous);
  });

  it("positionForDisplay_withSnapshotRate_convertsCollateral", () => {
    const position = positionForDisplay([btcLoan], 18);
    assert.equal(position.needsRate, false);
    assert.equal(position.collateralZar, 18_000);
    const next = inputsFromLivePosition(DEFAULT_INPUTS, position);
    assert.equal(next?.startingCapital, 18_000);
    assert.equal(next?.borrowCost, 3.3);
    assert.equal(next?.ltv, 40);
  });
});

describe("formatSimMoney", () => {
  it("formatSimMoney_usdWithoutRate_doesNotInventConversion", () => {
    assert.equal(formatSimMoney(725_693_156, "ZAR", null), "R725 693 156");
    assert.equal(formatSimMoney(725_693_156, "USD", null), RATE_UNAVAILABLE);
    assert.equal(formatSimMoney(18, "USD", 18), "$1");
  });
});

describe("Johannesburg calendar", () => {
  it("johannesburgMonth_usesAfricaJohannesburg", () => {
    assert.equal(johannesburgMonth(new Date("2026-01-31T22:30:00.000Z")), 2);
    assert.equal(johannesburgMonth(new Date("2026-10-09T12:00:00.000Z")), 10);
  });

  it("toggleSaTaxYear_offRestoresLegacyRebalance", () => {
    const on = toggleSaTaxYear(DEFAULT_INPUTS, new Date("2026-10-09T12:00:00.000Z"));
    assert.equal(on.startMonth, 10);
    assert.equal(on.rebalanceMonth, 2);
    const off = toggleSaTaxYear(on, new Date("2026-10-09T12:00:00.000Z"));
    assert.equal(off.startMonth, 1);
    assert.equal(off.rebalanceMonth, 1);
  });
});

describe("summary", () => {
  it("buildSummaryHtml_personalFixture_includesZarNetsAndAdviceLine", () => {
    const result = compute(DEFAULT_INPUTS);
    const generatedAt = new Date("2026-10-09T12:00:00.000Z");
    const html = buildSummaryHtml({
      title: "Unsaved scenario",
      inputs: DEFAULT_INPUTS,
      result,
      currency: "ZAR",
      fx: null,
      generatedAt,
    });
    assert.match(html, /R725\u00a0693\u00a0156/);
    assert.match(html, /R640\u00a0087\u00a0356/);
    assert.match(html, /R100\u00a0645\u00a0095/);
    assert.match(html, /not financial advice/);
    assert.match(html, new RegExp(fmtDate(generatedAt)));
    assert.equal(html.includes("apiKey"), false);
    assert.equal(html.includes("apiSecret"), false);
    assert.equal(chartSummary(result, "ZAR", null).includes("R725 693 156"), true);
  });
});
