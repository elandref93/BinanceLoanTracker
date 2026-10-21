import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  APR_NOT_RETURNED,
  APR_SINGLE,
  ASSETS_NOT_RETURNED,
  CHARGED_NOT_RETURNED,
  DAILY_EMPTY,
  DAILY_LOADING,
  DAILY_NOT_RETURNED,
  DAILY_UNREADABLE,
  FROM_INTEREST,
  FROM_SNAPSHOT,
  INTEREST_ROWS_LOADING,
  LIFETIME_NOT_RETURNED,
  LOANS_EMPTY,
  LOANS_NOT_RETURNED,
  LTV_EMPTY,
  LTV_NOT_RETURNED,
  LTV_SINGLE,
  PROJECTED_NOT_RETURNED,
  ROWS_REPLACE_SNAPSHOT,
  SERIES_FLAT,
  SNAPSHOT_DAILY_ABSENT,
  ZAR_RATE_ABSENT,
  aprStatsForSeries,
  buildHistoryView,
  labelUtcDay,
  type HistoryInterest,
  type HistorySnapshot,
} from "./historyView";

const snapshot: HistorySnapshot = {
  asOf: "2026-10-09T10:00:00.000Z",
  fxUsdToZar: 18.25,
  interestLifetimeUsd: 1000.5,
  interestProjected30dUsd: 88.4,
  loans: [{ id: "loan-1" }],
  history: [
    { t: "2026-10-07T10:00:00.000Z", ltv: 41.5 },
    { t: "2026-10-09T10:00:00.000Z", ltv: 40 },
    { t: "2026-10-08T10:00:00.000Z", ltv: 42.25 },
  ],
  dailyCharge: [
    { t: "2026-10-07", usd: 12.5 },
    { t: "2026-10-08", usd: 13.25 },
    { t: "not-a-day", usd: 9 },
    { t: "2026-10-06", usd: -4 },
  ],
};

const interest: HistoryInterest = {
  totalUsd: 40.5,
  weightedApr: 5.5,
  projected30dUsd: 90,
  byLoan: [
    {
      loanId: "loan-1",
      accountId: "link-1",
      asset: "USDC",
      collateralAsset: "BTC",
      currentApr: 6,
      avg30dApr: 5,
      min30dApr: 4,
      max30dApr: 6,
      projected30dUsd: 90,
      lifetimeInterestUsd: 1200,
      loanAgeDays: 100,
      rateHistory: [
        { ts: "1970-01-01T00:00:03.000Z", apr: 20 },
        { ts: "1970-01-01T00:00:00.000Z", apr: 10 },
        { ts: "1970-01-01T00:00:01.000Z", apr: 20 },
      ],
    },
    {
      loanId: "loan-2",
      accountId: "missing",
      asset: "USDT",
      collateralAsset: "ETH",
      currentApr: 3,
      avg30dApr: 3,
      min30dApr: 3,
      max30dApr: 3,
      projected30dUsd: 10,
      lifetimeInterestUsd: 0,
      loanAgeDays: 0,
      rateHistory: [],
    },
  ],
  byAsset: [
    { asset: "USDT", debtUsd: 100, weightedApr: 3, projected30dUsd: 10 },
    { asset: "USDC", debtUsd: 1000, weightedApr: 5.5, projected30dUsd: 90 },
  ],
  rows: [
    { ts: "2026-10-08T12:00:00.000Z", amountUsd: 4 },
    { ts: "2026-10-08T18:00:00.000Z", amountUsd: 5.5 },
    { ts: "2026-10-10T01:00:00.000Z", amountUsd: 2 },
  ],
};

describe("aprStatsForSeries", () => {
  it("aprStatsForSeries_timeWeightsUntilTheNextSample", () => {
    const stats = aprStatsForSeries([
      { t: 0, apr: 10 },
      { t: 1000, apr: 20 },
      { t: 3000, apr: 20 },
    ]);
    assert.ok(stats);
    assert.equal(stats.samples, 3);
    assert.equal(stats.min, 10);
    assert.equal(stats.max, 20);
    assert.ok(Math.abs(stats.avg - 50000 / 3000) < 1e-9);
  });

  it("aprStatsForSeries_onePoint_returnsNull", () => {
    assert.equal(aprStatsForSeries([{ t: 0, apr: 5 }]), null);
    assert.equal(aprStatsForSeries([{ t: 0, apr: 0 }, { t: 10, apr: -1 }]), null);
  });
});

describe("labelUtcDay", () => {
  it("labelUtcDay_keepsTheReturnedCalendarDay", () => {
    const label = labelUtcDay("2026-10-09");
    assert.equal(label.includes("9"), true);
    assert.equal(label.includes("2026"), true);
    assert.equal(label.includes("10 Oct") || label.includes("10 October"), false);
  });
});

describe("buildHistoryView", () => {
  it("buildHistoryView_missingSeries_saysTheyWereNotReturned", () => {
    const view = buildHistoryView({
      snapshotState: "ready",
      snapshot: { asOf: "2026-10-09T10:00:00.000Z", history: [] },
      interestState: "missing",
      interest: null,
      currency: "USD",
    });
    assert.equal(view.ltvMessage, LTV_EMPTY);
    assert.equal(view.ltvPoints.length, 0);
    assert.equal(view.ltvLine, false);
    assert.equal(view.dailyMessage, DAILY_NOT_RETURNED);
    assert.equal(view.dailyPoints.length, 0);
    assert.equal(view.lifetime.text, LIFETIME_NOT_RETURNED);
    assert.equal(view.projected.text, PROJECTED_NOT_RETURNED);
    assert.equal(view.charged30d.text, CHARGED_NOT_RETURNED);
    assert.equal(view.aprMessage, APR_NOT_RETURNED);
    assert.equal(view.loansMessage, LOANS_NOT_RETURNED);
    assert.equal(view.assetsMessage, ASSETS_NOT_RETURNED);
    assert.equal(view.loans.length, 0);
  });

  it("buildHistoryView_emptyDailyArray_isDistinctFromMissing", () => {
    const view = buildHistoryView({
      snapshotState: "ready",
      snapshot: { history: [], dailyCharge: [] },
      interestState: "ready",
      interest: { totalUsd: 0, weightedApr: 0, projected30dUsd: 0, byLoan: [], byAsset: [], rows: [] },
      currency: "USD",
    });
    assert.equal(view.dailyMessage, DAILY_EMPTY);
    assert.equal(view.lifetime.text, LIFETIME_NOT_RETURNED);
    assert.equal(view.projected.text, "$0,00");
    assert.equal(view.projected.source, FROM_INTEREST);
    assert.equal(view.loansMessage, LOANS_EMPTY);
  });

  it("buildHistoryView_usesReturnedSeries_andDoesNotFillGaps", () => {
    const labels = new Map([["link-1", "Personal · Main"]]);
    const view = buildHistoryView({
      snapshotState: "ready",
      snapshot,
      interestState: "ready",
      interest,
      currency: "USD",
      accountLabels: labels,
    });
    assert.equal(view.lifetime.text, "$1 200,00");
    assert.equal(view.lifetime.source, FROM_INTEREST);
    assert.equal(view.snapshotLifetime, "$1 000,50");
    assert.equal(view.projected.text, "$90,00");
    assert.equal(view.snapshotProjected, "$88,40");
    assert.equal(view.charged30d.text, "$40,50");
    assert.equal(view.weightedApr.text, "5,50%");
    assert.equal(view.openLoans.text, "1");
    assert.equal(view.openLoans.source, FROM_SNAPSHOT);
    assert.equal(view.ltvLine, true);
    assert.equal(view.ltvPoints.length, 3);
    assert.equal(view.ltvPoints[0].ltv, "41,50%");
    assert.equal(view.ltvPoints[2].ltv, "40,00%");
    assert.equal(view.ltvSummary.includes("12:00"), true);
    assert.equal(view.ltvSummary.includes("Africa/Johannesburg"), true);
    assert.deepEqual(
      view.dailyPoints.map((point) => point.day),
      ["2026-10-07", "2026-10-08", "2026-10-10"],
    );
    assert.equal(view.dailyPoints[0].amount, "$12,50");
    assert.equal(view.dailyPoints[1].amount, "$9,50");
    assert.equal(view.dailyPoints[2].amount, "$2,00");
    assert.equal(view.dailySummary.includes(ROWS_REPLACE_SNAPSHOT), true);
    assert.equal(view.dailySummary.includes("2026-10-09"), false);
    assert.equal(view.loans[0].loanId, "loan-1");
    assert.equal(view.loans[0].accountLabel, "Personal · Main");
    assert.equal(view.loans[0].delta?.text, "▲20,0%");
    assert.deepEqual(view.loans[0].aprValues, [10, 20, 20]);
    assert.equal(view.loans[0].aprSummary.includes("16,67%"), true);
    assert.equal(view.loans[1].aprValues.length, 0);
    assert.equal(view.loans[1].aprSummary, APR_NOT_RETURNED);
    assert.equal(view.loans[1].accountLabel, "Account not in the synced list");
    assert.equal(view.assets[0].asset, "USDC");
    assert.equal(view.asOfLabel?.includes("12:00"), true);
  });

  it("buildHistoryView_flatSeries_isShownAsReturned", () => {
    const view = buildHistoryView({
      snapshotState: "missing",
      snapshot: null,
      interestState: "ready",
      interest: {
        totalUsd: 1,
        weightedApr: 5,
        projected30dUsd: 2,
        byLoan: [
          {
            loanId: "loan-flat",
            accountId: "link-1",
            asset: "USDC",
            collateralAsset: "BTC",
            currentApr: 5,
            avg30dApr: 5,
            min30dApr: 5,
            max30dApr: 5,
            projected30dUsd: 2,
            lifetimeInterestUsd: 3,
            loanAgeDays: 4,
            rateHistory: [
              { ts: "2026-10-08T00:00:00.000Z", apr: 5 },
              { ts: "2026-10-09T00:00:00.000Z", apr: 5 },
            ],
          },
        ],
        byAsset: [],
        rows: [{ ts: "2026-10-09T00:00:00.000Z", amountUsd: 1.25 }],
      },
      currency: "USD",
    });
    assert.deepEqual(view.loans[0].aprValues, [5, 5]);
    assert.equal(view.loans[0].aprSummary.includes(SERIES_FLAT), true);
    assert.equal(view.loans[0].delta, null);
    assert.equal(view.dailyPoints.length, 1);
    assert.equal(view.dailySummary.includes(SNAPSHOT_DAILY_ABSENT), true);
    assert.equal(view.ltvMessage, LTV_NOT_RETURNED);
    assert.equal(view.assetsMessage, LOANS_EMPTY);
  });

  it("buildHistoryView_singleLtvSample_doesNotDrawALine", () => {
    const view = buildHistoryView({
      snapshotState: "ready",
      snapshot: { history: [{ t: "2026-10-09T22:30:00.000Z", ltv: 40 }] },
      interestState: "missing",
      interest: null,
      currency: "USD",
    });
    assert.equal(view.ltvLine, false);
    assert.equal(view.ltvPoints.length, 1);
    assert.equal(view.ltvMessage.includes(LTV_SINGLE), true);
    assert.equal(view.ltvMessage.includes("00:30"), true);
    assert.equal(view.ltvMessage.includes("10"), true);
  });

  it("buildHistoryView_unreadableDaily_isNotAnEmptySeries", () => {
    const view = buildHistoryView({
      snapshotState: "ready",
      snapshot: { history: [{ t: "bad", ltv: Number.NaN }], dailyCharge: [{ t: "bad", usd: -1 }] },
      interestState: "ready",
      interest: { totalUsd: 0, weightedApr: 0, projected30dUsd: 0, byLoan: [], byAsset: [], rows: [] },
      currency: "USD",
    });
    assert.equal(view.dailyMessage, DAILY_UNREADABLE);
    assert.equal(view.ltvMessage.includes("could not be read"), true);
  });

  it("buildHistoryView_zarUsesSnapshotRate_andReportsWhenItIsAbsent", () => {
    const withRate = buildHistoryView({
      snapshotState: "ready",
      snapshot,
      interestState: "ready",
      interest,
      currency: "ZAR",
    });
    assert.equal(withRate.lifetime.text, "R21 900,00");
    assert.equal(withRate.fxLabel, "R18,25 per USD");
    assert.equal(withRate.zarNote, null);
    const withoutRate = buildHistoryView({
      snapshotState: "ready",
      snapshot: { history: [], interestLifetimeUsd: 10 },
      interestState: "missing",
      interest: null,
      currency: "ZAR",
    });
    assert.equal(withoutRate.lifetime.text, "Exchange rate is not in this snapshot");
    assert.equal(withoutRate.zarNote, ZAR_RATE_ABSENT);
  });

  it("buildHistoryView_whileInterestLoads_keepsSnapshotSeries", () => {
    const view = buildHistoryView({
      snapshotState: "ready",
      snapshot,
      interestState: "loading",
      interest: null,
      currency: "USD",
    });
    assert.equal(view.lifetime.text, "$1 000,50");
    assert.equal(view.lifetime.source, FROM_SNAPSHOT);
    assert.equal(view.snapshotLifetime, null);
    assert.equal(view.dailyPoints.length, 2);
    assert.equal(view.dailySummary.includes(INTEREST_ROWS_LOADING), true);
    assert.equal(view.aprMessage?.includes("Loading"), true);
    assert.equal(view.loans.length, 0);
  });

  it("buildHistoryView_whileSnapshotLoads_doesNotCallDailyMissing", () => {
    const view = buildHistoryView({
      snapshotState: "loading",
      snapshot: null,
      interestState: "loading",
      interest: null,
      currency: "USD",
    });
    assert.equal(view.dailyMessage, DAILY_LOADING);
    assert.equal(view.ltvMessage.includes("Loading"), true);
    assert.equal(view.lifetime.status, "loading");
  });

  it("buildHistoryView_rangeKeepsTheLatestReturnedDays", () => {
    const august = Array.from({ length: 31 }, (_, index) => ({
      t: `2026-08-${String(index + 1).padStart(2, "0")}`,
      usd: index + 1,
    }));
    const september = Array.from({ length: 9 }, (_, index) => ({
      t: `2026-09-${String(index + 1).padStart(2, "0")}`,
      usd: index + 32,
    }));
    const view = buildHistoryView({
      snapshotState: "ready",
      snapshot: { history: [], dailyCharge: [...august, ...september] },
      interestState: "ready",
      interest: { totalUsd: 0, weightedApr: 0, projected30dUsd: 0, byLoan: [], byAsset: [], rows: [] },
      currency: "USD",
      dailyRange: 30,
    });
    assert.equal(view.dailyReturnedCount, 40);
    assert.equal(view.dailyPoints.length, 30);
    assert.equal(view.dailyPoints[0].day, "2026-08-11");
    assert.equal(view.dailyPoints[29].day, "2026-09-09");
    assert.equal(view.dailySummary.includes("last 30 of 40"), true);
  });

  it("buildHistoryView_oneAprSample_doesNotRepeatTheCurrentRate", () => {
    const view = buildHistoryView({
      snapshotState: "missing",
      snapshot: null,
      interestState: "ready",
      interest: {
        totalUsd: 1,
        weightedApr: 9,
        projected30dUsd: 1,
        byLoan: [
          {
            loanId: "loan-1",
            accountId: "link-1",
            asset: "USDC",
            collateralAsset: "BTC",
            currentApr: 9,
            avg30dApr: 9,
            min30dApr: 9,
            max30dApr: 9,
            projected30dUsd: 1,
            lifetimeInterestUsd: 1,
            loanAgeDays: 1,
            rateHistory: [{ ts: "2026-10-09T10:00:00.000Z", apr: 4 }],
          },
        ],
        byAsset: [],
        rows: [],
      },
      currency: "USD",
    });
    assert.deepEqual(view.loans[0].aprValues, [4]);
    assert.equal(view.loans[0].aprSummary.includes(APR_SINGLE), true);
    assert.equal(view.loans[0].aprSummary.includes("9,00%"), false);
  });
});
