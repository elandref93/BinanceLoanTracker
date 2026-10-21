import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DASHBOARD_EMPTY_PORTFOLIO,
  DASHBOARD_MISSING_SNAPSHOT,
  DASHBOARD_RATE_UNAVAILABLE,
  dashboardPaint,
  healthStatusLabel,
  type SnapshotInput,
} from "./dashboardState";

describe("healthStatusLabel", () => {
  it("healthStatusLabel_pending_saysChecking", () => {
    assert.equal(healthStatusLabel({ pending: true, failed: false, status: "ok" }), "Checking the API…");
  });

  it("healthStatusLabel_failed_saysUnreachable", () => {
    assert.equal(healthStatusLabel({ pending: false, failed: true }), "Unreachable");
  });

  it("healthStatusLabel_success_usesServerStatus", () => {
    assert.equal(healthStatusLabel({ pending: false, failed: false, status: "ok" }), "ok");
    assert.equal(healthStatusLabel({ pending: false, failed: false, status: "  " }), "Unreachable");
    assert.equal(healthStatusLabel({ pending: false, failed: false }), "Unreachable");
  });
});

describe("DASHBOARD_EMPTY_PORTFOLIO", () => {
  it("DASHBOARD_EMPTY_PORTFOLIO_hasNoSampleBalance", () => {
    assert.equal(/\d/.test(DASHBOARD_EMPTY_PORTFOLIO), false);
    assert.equal(DASHBOARD_EMPTY_PORTFOLIO.includes("API keys stay on the server"), true);
  });
});

const snapshot: SnapshotInput = {
  updatedAt: "2026-10-09T22:30:00.000Z",
  asOf: "2026-10-09T22:30:00.000Z",
  aggregateLtv: 40,
  totalDebtUsd: 1000,
  totalCollateralUsd: 2500,
  fxUsdToZar: 18,
  loans: [
    {
      id: "loan-1",
      accountId: "link-1",
      asset: "USDC",
      debtUsd: 650,
      collateralAsset: "BTC",
      collateralValueUsd: 2000,
      ltv: 32.5,
      apr: 4.5,
    },
  ],
  perContainer: [
    {
      containerId: "acct-1",
      name: "Personal",
      type: "personal",
      debtUsd: 1000,
      collateralUsd: 2500,
      ltv: 40,
      loanCount: 1,
    },
  ],
  holdingsUsd: 300,
};

describe("dashboardPaint", () => {
  it("dashboardPaint_signedOut_staysEmpty", () => {
    const paint = dashboardPaint({
      signedIn: false,
      pending: false,
      failed: false,
      envelope: { available: true, snapshot },
      currency: "USD",
    });
    assert.equal(paint.kind, "signed-out");
    if (paint.kind === "signed-out") assert.equal(paint.message, DASHBOARD_EMPTY_PORTFOLIO);
  });

  it("dashboardPaint_missingSnapshot_doesNotInventNumbers", () => {
    const paint = dashboardPaint({
      signedIn: true,
      pending: false,
      failed: false,
      envelope: { available: false },
      currency: "USD",
    });
    assert.equal(paint.kind, "missing");
    if (paint.kind === "missing") {
      assert.equal(paint.message, DASHBOARD_MISSING_SNAPSHOT);
      assert.equal(/\d/.test(paint.message), false);
    }
  });

  it("dashboardPaint_snapshot_usesServerFiguresOnly", () => {
    const paint = dashboardPaint({
      signedIn: true,
      pending: false,
      failed: false,
      envelope: { available: true, snapshot },
      currency: "USD",
      accountLabels: new Map([["link-1", "Personal"]]),
    });
    assert.equal(paint.kind, "snapshot");
    if (paint.kind !== "snapshot") return;
    assert.equal(paint.view.aggregateLtv, "40,0%");
    assert.equal(paint.view.debt, "$1 000");
    assert.equal(paint.view.collateral, "$2 500");
    assert.equal(paint.view.holdings, "$300");
    assert.equal(paint.view.loans[0]?.accountLabel, "Personal");
    assert.equal(paint.view.loans[0]?.status, "ok");
    assert.equal(paint.view.loans[0]?.headroom.includes("$1 000"), true);
    assert.equal(paint.view.closest?.id, "loan-1");
    assert.equal(paint.view.priceNote?.includes("not in this snapshot"), true);
    assert.equal(paint.view.asOfLabel.includes("10"), true);
  });

  it("dashboardPaint_withoutFx_doesNotUseTheFallbackRate", () => {
    const { fxUsdToZar: _rate, ...withoutFx } = snapshot;
    const paint = dashboardPaint({
      signedIn: true,
      pending: false,
      failed: false,
      envelope: { available: true, snapshot: withoutFx },
      currency: "ZAR",
    });
    assert.equal(paint.kind, "snapshot");
    if (paint.kind !== "snapshot") return;
    assert.equal(paint.view.zarAvailable, false);
    assert.equal(paint.view.debt, DASHBOARD_RATE_UNAVAILABLE);
    assert.equal(paint.view.fxLabel, null);
    const text = JSON.stringify(paint.view);
    assert.equal(text.includes("18,5"), false);
    assert.equal(text.includes("R"), false);
  });

  it("dashboardPaint_omittedLoans_isNotAnEmptyBook", () => {
    const { loans: _loans, perContainer: _containers, ...rest } = snapshot;
    const paint = dashboardPaint({
      signedIn: true,
      pending: false,
      failed: false,
      envelope: { available: true, snapshot: rest },
      currency: "USD",
    });
    assert.equal(paint.kind, "snapshot");
    if (paint.kind !== "snapshot") return;
    assert.equal(paint.view.loansNote, "Loans are not included in this snapshot.");
    assert.equal(paint.view.containersNote, "Per-account LTV is not included in this snapshot.");
    assert.equal(paint.view.loans.length, 0);
  });
});
