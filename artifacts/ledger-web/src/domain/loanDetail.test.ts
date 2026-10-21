import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { LunoTransaction } from "@workspace/api-client-react";

import { fmtUsd } from "@/domain/format";
import {
  draftsFromAnnotation,
  parseAnnotationDrafts,
  writeLoanAnnotation,
} from "@/domain/loanAnnotations";
import {
  buildLoanDetail,
  COLLATERAL_PLAN_UNAVAILABLE,
  HOURS_PER_YEAR,
  INTEREST_FROM_APR,
  INTEREST_UNAVAILABLE,
  LOAN_MISSING,
  monthsToSettle,
  PAYOFF_UNAVAILABLE,
  payoffProjection,
  PRICE_TRIGGER_UNAVAILABLE,
  RATE_UNAVAILABLE,
  REPAYMENTS_EMPTY,
  REPAYMENTS_NO_KEY,
  requiredMonthly,
  simulatedLtv,
  type LoanEvent,
  type SnapshotLoanSource,
} from "@/domain/loanDetail";
import { lunoFundingForAsset } from "@/domain/lunoFunding";
import { priceAtLtv, type RiskLoan } from "@/domain/risk";

const snapshotLoan: SnapshotLoanSource = {
  id: "loan-1",
  accountId: "link-binance",
  asset: "USDT",
  debtUsd: 10_000,
  collateralAsset: "BTC",
  collateralValueUsd: 20_000,
  ltv: 50,
  apr: 10,
};

const readySnapshot = {
  loanId: "loan-1",
  currency: "USD" as const,
  targetLtv: 65,
  fx: 18.5,
  asOf: "2026-10-09T10:00:00.000Z",
  snapshotStatus: "ready" as const,
  loansIncluded: true,
  snapshotLoan,
  liveStatus: "ready" as const,
  liveLoan: null,
  accountLabel: "Personal",
  repayments: { status: "blocked" as const, reason: "no-key" as const },
  events: [] as LoanEvent[],
  luno: { status: "blocked" as const, reason: "no-link" as const },
  lunoTransactions: [] as LunoTransaction[],
  container: { links: [{ id: "link-binance", exchange: "binance" }] },
  containerName: "Personal",
};

describe("buildLoanDetail", () => {
  it("buildLoanDetail_snapshotWithoutQuantity_hidesPricesAndProjectsInterestFromApr", () => {
    const result = buildLoanDetail(readySnapshot);
    assert.equal(result.kind, "loan");
    if (result.kind !== "loan") return;
    const hourlyUsd = (10_000 * 0.1) / HOURS_PER_YEAR;
    assert.equal(result.view.title, "BTC/USDT");
    assert.equal(result.view.ltv, "50,0%");
    assert.equal(result.view.apr, "10,00%");
    assert.equal(result.view.position[0]?.value.includes(fmtUsd(10_000)), true);
    assert.equal(result.view.position[0]?.value.includes("Borrowed quantity is not"), true);
    assert.equal(result.view.position[1]?.value, "Collateral quantity is not in this snapshot.");
    assert.equal(result.view.priceNote, PRICE_TRIGGER_UNAVAILABLE);
    assert.equal(result.view.warningPrice, null);
    assert.equal(result.view.liquidationPrice, null);
    assert.equal(result.view.currentPrice, null);
    assert.equal(result.view.hourlyInterest, fmtUsd(hourlyUsd));
    assert.equal(result.view.dailyInterest, fmtUsd(hourlyUsd * 24));
    assert.equal(result.view.interestNote, INTEREST_FROM_APR);
    assert.equal(result.view.debtGrowth?.[1]?.value, fmtUsd(10_000 + hourlyUsd * 24 * 30));
    assert.equal(result.view.debtGrowth?.[2]?.value, fmtUsd(10_000 + hourlyUsd * 24 * 90));
    assert.equal(result.view.debtGrowth?.[3]?.value, fmtUsd(10_000 + hourlyUsd * 24 * 365));
    assert.equal(result.view.falls[1]?.changeLabel, "−10%");
    assert.equal(result.view.falls[1]?.ltvLabel, "56%");
    assert.equal(simulatedLtv(50, -10), 50 / 0.9);
    assert.equal(result.view.repaymentsNote, REPAYMENTS_NO_KEY);
    assert.equal(result.view.repayments, null);
    assert.equal(result.view.lunoNote?.includes("No Luno account is linked"), true);
    assert.equal(COLLATERAL_PLAN_UNAVAILABLE.includes("not shown"), true);
  });

  it("buildLoanDetail_zeroApr_doesNotInventInterest", () => {
    const result = buildLoanDetail({
      ...readySnapshot,
      snapshotLoan: { ...snapshotLoan, apr: 0 },
    });
    assert.equal(result.kind, "loan");
    if (result.kind !== "loan") return;
    assert.equal(result.view.apr, "0,00%");
    assert.equal(result.view.hourlyInterest, null);
    assert.equal(result.view.debtGrowth, null);
    assert.equal(result.view.interestNote, INTEREST_UNAVAILABLE);
  });

  it("buildLoanDetail_liveQuantity_showsWarningAndLiquidationPrices", () => {
    const result = buildLoanDetail({
      ...readySnapshot,
      liveLoan: {
        accountId: "link-binance",
        asset: "USDT",
        collateralAsset: "BTC",
        debtQty: 10_000,
        debtUsd: 10_000,
        collateralQty: 2,
        collateralValueUsd: 20_000,
        ltv: 50,
        apr: 10,
        hourlyInterestRate: 0.1 / HOURS_PER_YEAR,
      },
    });
    assert.equal(result.kind, "loan");
    if (result.kind !== "loan") return;
    const risk: RiskLoan = {
      id: "loan-1",
      debtUsd: 10_000,
      ltv: 50,
      collateral: { asset: "BTC", qty: 2, valueUsd: 20_000 },
    };
    assert.equal(result.view.position[1]?.value, "2,0000 BTC");
    assert.equal(result.view.warningPrice?.includes(fmtUsd(priceAtLtv(risk, 85))), true);
    assert.equal(result.view.liquidationPrice?.includes(fmtUsd(priceAtLtv(risk, 91))), true);
    assert.equal(result.view.currentPrice, fmtUsd(10_000));
    assert.equal(result.view.interestNote?.includes("live hourly rate"), true);
  });

  it("buildLoanDetail_missingLoan_staysEmpty", () => {
    const result = buildLoanDetail({
      ...readySnapshot,
      loanId: "missing",
      snapshotLoan: null,
    });
    assert.deepEqual(result, { kind: "missing", message: LOAN_MISSING });
  });

  it("buildLoanDetail_zarWithoutRate_doesNotInventARandAmount", () => {
    const result = buildLoanDetail({ ...readySnapshot, currency: "ZAR", fx: null });
    assert.equal(result.kind, "loan");
    if (result.kind !== "loan") return;
    assert.equal(result.view.position[2]?.value, RATE_UNAVAILABLE);
    assert.equal(result.view.hourlyInterest, RATE_UNAVAILABLE);
    assert.equal(/\d/.test(result.view.hourlyInterest ?? ""), false);
  });

  it("buildLoanDetail_repaymentsAndLunoBuys_useReturnedRowsOnly", () => {
    const events: LoanEvent[] = [
      {
        type: "repay",
        ts: "2026-10-08T08:00:00.000Z",
        asset: "USDT",
        amount: 100,
        amountUsd: 100,
      },
    ];
    const lunoTransactions: LunoTransaction[] = [
      tx("luno-1", "USDT", 100, "2026-10-07T08:00:00.000Z"),
      tx("luno-1", "ZAR", -1800, "2026-10-07T08:00:00.000Z"),
      tx("luno-1", "USDT", -100, "2026-10-07T09:00:00.000Z"),
    ];
    const result = buildLoanDetail({
      ...readySnapshot,
      repayments: { status: "ready" },
      events,
      luno: { status: "ready" },
      lunoTransactions,
      container: {
        links: [
          { id: "link-binance", exchange: "binance" },
          { id: "luno-1", exchange: "luno" },
        ],
      },
    });
    assert.equal(result.kind, "loan");
    if (result.kind !== "loan") return;
    assert.equal(result.view.repaymentsNote, null);
    assert.equal(result.view.repayments?.[0]?.amount, "+100,00 USDT");
    assert.equal(result.view.repayments?.[0]?.value, fmtUsd(100));
    assert.equal(result.view.repayments?.[0]?.funding?.includes("R18,00/USDT"), true);
    assert.equal(result.view.lunoBuys?.length, 1);
    assert.equal(result.view.lunoMoves?.length, 1);
    assert.equal(result.view.lunoScope, "Showing Personal activity only.");
    assert.notEqual(result.view.repaymentsNote, REPAYMENTS_EMPTY);
  });
});

describe("payoffProjection", () => {
  it("payoffProjection_withoutBorrowedQuantity_isUnavailable", () => {
    const projection = payoffProjection({
      debtQty: null,
      debtUsd: 10_000,
      hourlyRate: 0.1 / HOURS_PER_YEAR,
      contribution: 500,
      targetDate: null,
      currency: "USD",
      fx: 18,
    });
    assert.deepEqual(projection, { available: false, reason: PAYOFF_UNAVAILABLE });
  });

  it("monthsToSettle_clearsAZeroRateBalanceAndStopsWhenInterestWins", () => {
    assert.equal(monthsToSettle(100, 0, 100), 1);
    assert.equal(monthsToSettle(100, 0.1, 1), null);
    assert.equal(requiredMonthly(10_000, 0, 4), 2_500);
  });

  it("payoffProjection_withQuantity_usesTheContribution", () => {
    const monthlyRate = 0.01;
    const hourlyRate = monthlyRate / (24 * 30.44);
    const projection = payoffProjection({
      debtQty: 10_000,
      debtUsd: 10_000,
      hourlyRate,
      contribution: 500,
      targetDate: "2027-10-09",
      currency: "USD",
      fx: 18,
      now: new Date("2026-10-09T12:00:00.000Z"),
    });
    assert.equal(projection.available, true);
    if (!projection.available) return;
    assert.equal(projection.months, monthsToSettle(10_000, monthlyRate, 500));
    assert.equal(projection.requiredForDate != null, true);
  });
});

describe("loan annotations", () => {
  it("parseAnnotationDrafts_acceptsCommaDecimalsAndDerivesTheSellRate", () => {
    const parsed = parseAnnotationDrafts(
      {
        ...draftsFromAnnotation({}),
        borrowedValueZar: "1 650,50",
        sellRate: "",
      },
      { totalBorrowedQty: 100, planPrincipal: null },
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.annotation.borrowedValueZar, 1650.5);
    assert.equal(parsed.annotation.sellRate, 16.505);
  });

  it("writeLoanAnnotation_keepsUnknownKeysAndOtherLoans", () => {
    const written = writeLoanAnnotation(
      {
        "loan-1": { sellRate: 1, noteFromPhone: "keep" },
        "loan-2": { monthlyContribution: 20 },
      },
      "loan-1",
      { ...draftsFromAnnotation({ sellRate: 2 }), sellRate: "2" },
      { totalBorrowedQty: null, planPrincipal: null },
    );
    assert.equal(written.ok, true);
    if (!written.ok) return;
    assert.equal(written.map["loan-1"]?.noteFromPhone, "keep");
    assert.equal(written.map["loan-1"]?.sellRate, 2);
    assert.equal(written.map["loan-2"]?.monthlyContribution, 20);
  });
});

describe("lunoFundingForAsset", () => {
  it("lunoFundingForAsset_pairsZarOutflowWithAssetInflow", () => {
    const funding = lunoFundingForAsset(
      [
        tx("luno-1", "XBT", 0.5, "2026-01-01T00:00:00.000Z"),
        tx("luno-1", "ZAR", -500_000, "2026-01-01T00:00:00.000Z"),
      ],
      "BTC",
    );
    assert.equal(funding.buys.length, 1);
    assert.equal(funding.buys[0]?.assetQty, 0.5);
    assert.equal(funding.buys[0]?.rate, 1_000_000);
    assert.equal(funding.moves.length, 0);
  });
});

function tx(accountId: string, asset: string, amount: number, ts: string): LunoTransaction {
  return {
    accountId,
    accountName: "Personal",
    walletId: "w1",
    asset,
    rowIndex: 0,
    ts,
    amount,
    balance: 0,
    description: amount < 0 && asset !== "ZAR" ? "Send" : "",
  };
}
