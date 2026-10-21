import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deriveFrom, synthesiseFlexibleInterest, type Derived } from "./derived";
import { emptyLedger, type LedgerFile, type SourceCursor } from "./ledgerStore";
import { classifyLunoRow } from "./lunoImport";
import type { PriceBook } from "./prices";
import { jhbDay, jhbDayStart } from "./time";
import type { DebtPosition, HistoryPoint, LedgerEvent, PortfolioState, Position, StatementSeries } from "./types";
import { buildAnalytics, buildAssetDetail, buildAssets, buildImportStatus, buildOverview, buildPerformance, downsampleKeepingDays, perecStatementQuote, statementPriorValue } from "./views";

const noon = (day: string) => jhbDayStart(day) + 12 * 60 * 60 * 1000;
const AS_OF = noon("2026-10-11");

function book(closes: (asset: string, day: string) => number): PriceBook {
  return {
    close: closes,
    fx: () => 18,
    fxIsReference: () => false,
    hourly: () => [],
    daily: () => ({}),
  };
}

const btcClose = (asset: string, day: string) => {
  if (asset === "USDT") return 1;
  if (asset !== "BTC") return 0;
  if (day >= "2026-10-11") return 60_000;
  if (day >= "2026-10-05") return 55_000;
  return 50_000;
};

function completeLedger(events: LedgerEvent[]): LedgerFile {
  const cursor: SourceCursor = {
    key: "L1:deposits",
    exchange: "binance",
    linkId: "L1",
    linkName: "Main",
    source: "deposits",
    state: "complete",
    rows: events.length,
    coveredFrom: Date.parse("2019-01-01T00:00:00Z"),
    coveredTo: AS_OF,
    backfillDone: true,
    error: null,
    updatedAt: AS_OF,
  };
  return { ...emptyLedger(), revision: 1, events, cursors: { [cursor.key]: cursor } };
}

function state(partial: Partial<PortfolioState> = {}): PortfolioState {
  return {
    asOf: AS_OF,
    positions: [{ exchange: "binance", linkId: "L1", linkName: "Main", containerId: null, wallet: "spot", asset: "BTC", qty: 1 }],
    debts: [],
    prices: { BTC: 60_000, USDT: 1 },
    change24h: { BTC: 9.0909 },
    fx: 18,
    fxSource: "luno",
    containers: [],
    errors: [],
    ...partial,
  };
}

const deposit: LedgerEvent = {
  id: "bn:L1:dep:1",
  t: noon("2026-10-01"),
  exchange: "binance",
  linkId: "L1",
  type: "deposit",
  asset: "BTC",
  qty: 1,
  external: true,
};

describe("luno import classification", () => {
  it("classifyLunoRow_kinds_mapToLedgerTypes", () => {
    assert.deepEqual(classifyLunoRow("FEE", "Trading fee", -0.1), { type: "fee", external: false });
    assert.deepEqual(classifyLunoRow("INTEREST", "Savings interest", 0.2), { type: "income", external: false });
    assert.deepEqual(classifyLunoRow("EXCHANGE", "Bought BTC", 1), { type: "buy", external: false });
    assert.deepEqual(classifyLunoRow("EXCHANGE", "Sold BTC", -1), { type: "sell", external: false });
    assert.deepEqual(classifyLunoRow("TRANSFER", "Received", 1), { type: "deposit", external: true });
    assert.deepEqual(classifyLunoRow("TRANSFER", "Sent", -1), { type: "withdrawal", external: true });
  });

  it("classifyLunoRow_missingKind_fallsBackToDescription", () => {
    assert.equal(classifyLunoRow(undefined, "Instant buy of BTC", 1).type, "buy");
    assert.equal(classifyLunoRow(undefined, "Staking reward", 1).type, "income");
    assert.equal(classifyLunoRow(undefined, "Withdrawal to bank", -100).type, "withdrawal");
  });
});

describe("flexible loan interest", () => {
  it("synthesiseFlexibleInterest_openLoan_accruesDailyOnRunningDebt", () => {
    const borrow: LedgerEvent = {
      id: "bn:L1:flb:USDT:BTC:1:debt",
      t: noon("2026-10-09"),
      exchange: "binance",
      linkId: "L1",
      type: "borrow",
      asset: "USDT",
      qty: 1000,
      debt: true,
    };
    const loan: DebtPosition = {
      loanId: "L1_flex_USDT_BTC",
      exchange: "binance",
      linkId: "L1",
      containerId: null,
      asset: "USDT",
      qty: 1001,
      collateralAsset: "BTC",
      collateralQty: 0.1,
      ltv: 20,
      marginCallLtv: 85,
      liqLtv: 91,
      apr: 8.76,
      hourlyRate: 0.0001,
    };
    const synthetic = synthesiseFlexibleInterest([borrow], state({ debts: [loan] }), AS_OF);
    assert.equal(synthetic.length, 3);
    assert.ok(synthetic.every((event) => event.type === "interest" && event.debt === true));
    assert.ok(Math.abs((synthetic[0]?.qty ?? 0) - 2.4) < 1e-9);
    assert.ok((synthetic[1]?.qty ?? 0) > (synthetic[0]?.qty ?? 0));
  });
});

describe("portfolio views", () => {
  const derived = deriveFrom({ state: state(), points: [], ledger: completeLedger([deposit]), book: book(btcClose) });

  it("buildOverview_ledgerHistory_periodPnlExcludesDeposits", () => {
    const overview = buildOverview(derived, undefined);
    assert.equal(overview.totals.netUsd, 60_000);
    assert.equal(overview.today.startUsd, 55_000);
    assert.equal(overview.today.pnlUsd, 5_000);
    assert.equal(overview.today.basis, "ledger");
    assert.equal(overview.week.from, new Date(jhbDayStart("2026-10-05")).toISOString());
    assert.equal(overview.week.pnlUsd, 10_000);
    assert.ok(Math.abs((overview.week.pct ?? 0) - 20) < 0.01);
    assert.equal(overview.month.startUsd, 0);
    assert.equal(overview.month.flowsUsd, 50_000);
    assert.equal(overview.month.pnlUsd, 10_000);
    assert.ok(Math.abs((overview.month.pct ?? 0) - 20) < 0.01);
    assert.equal(overview.month.attribution?.marketUsd, 10_000);
    assert.equal(overview.month.attribution?.otherUsd, 0);
    assert.deepEqual(overview.month.attribution?.byAsset, [{ asset: "BTC", marketUsd: 10_000 }]);
    assert.deepEqual(overview.week.byProfile, [{ containerId: "none", pnlUsd: 10_000 }]);
    assert.equal(overview.week.spark.at(0), 50_000);
    assert.equal(overview.week.spark.at(-1), 60_000);
    assert.equal(overview.allocation[0]?.asset, "BTC");
    assert.equal(overview.import.state, "complete");
  });

  it("buildPerformance_week_chainsReturnsAndEndsAtLiveValue", () => {
    const performance = buildPerformance(derived, "1W", undefined);
    assert.equal(performance.available, true);
    assert.equal(performance.basis, "ledger");
    assert.equal(performance.points.at(-1)?.netUsd, 60_000);
    assert.equal(performance.summary.pnlUsd, 10_000);
    assert.ok(Math.abs((performance.summary.twrPct ?? 0) - 20) < 0.01);
    assert.equal(performance.summary.maxDrawdownPct, 0);
  });

  it("buildOverview_snapshotsOnly_usesSnapshotBasisWithoutFlows", () => {
    const snapshotsOnly = deriveFrom({
      state: state(),
      points: [
        { t: jhbDayStart("2026-10-05") + 15 * 60_000, a: 50_000, d: 0, h: { none: { BTC: 1 } }, c: { none: [50_000, 0] }, p: { BTC: 50_000 }, fx: 18 },
        { t: jhbDayStart("2026-10-11") - 10 * 60_000, a: 55_000, d: 0, h: { none: { BTC: 1 } }, c: { none: [55_000, 0] }, p: { BTC: 55_000 }, fx: 18 },
      ],
      ledger: null,
      book: book(btcClose),
    });
    const overview = buildOverview(snapshotsOnly, undefined);
    assert.equal(overview.today.basis, "snapshots");
    assert.equal(overview.today.pnlUsd, 5_000);
    assert.equal(overview.week.startUsd, 50_000);
    assert.equal(overview.week.attribution, null);
    assert.equal(overview.month.basis, "none");
    assert.equal(overview.import.state, "unavailable");
  });

  it("buildAnalytics_depositOnly_contributionsAndConcentration", () => {
    const analytics = buildAnalytics(derived, undefined, "weighted");
    assert.equal(analytics.contributions.depositedUsd, 50_000);
    assert.equal(analytics.contributions.growthUsd, 10_000);
    assert.equal(analytics.concentration.topAsset, "BTC");
    assert.equal(analytics.concentration.effectiveAssets, 1);
    assert.equal(analytics.cgt.disposals, 0);
    assert.equal(analytics.cgt.unrealizedGainUsd, 10_000);
    assert.equal(analytics.risk.stablePct, 0);
    const monthly = analytics.contributions.monthly;
    assert.equal(monthly.reduce((sum, month) => sum + month.contributedUsd, 0), 50_000);
    assert.equal(monthly.at(-1)?.endUsd, analytics.contributions.netContributedUsd + monthly.reduce((sum, month) => sum + month.growthUsd, 0));
  });

  it("buildImportStatus_completeLedger_reportsSources", () => {
    const status = buildImportStatus(derived, derived.ledger);
    assert.equal(status.state, "complete");
    assert.equal(status.eventCount, 1);
    assert.equal(status.sources[0]?.source, "deposits");
    assert.deepEqual(status.reconciliation, []);
  });

  it("perecStatementQuote_usesPortalDayNotSideLayers", () => {
    const asset = "Anchor Capital / Peresec Consolidated Portfolio";
    const held: Position = {
      exchange: "pickle_rick",
      linkId: "investment:1",
      linkName: asset,
      containerId: null,
      wallet: "Peresec",
      asset,
      qty: 1,
      includeInTotal: true,
      balanceKnown: true,
    };
    const series: StatementSeries[] = [
      {
        key: "investment:1",
        kind: "as",
        accountNumber: "0433383",
        product: "",
        containerId: null,
        asset,
        currency: "USD",
        asOf: "2026-10-13",
        points: [
          { date: "2026-09-30", value: 1, currency: "USD", change: null, product: "brokerage" },
          { date: "2026-10-13", value: 1, currency: "USD", change: null, product: "perec-as" },
        ],
      },
      {
        key: "0433383|perec-eib",
        kind: "eib",
        accountNumber: "0433383",
        product: "perec-eib",
        containerId: null,
        asset,
        currency: "ZAR",
        points: [{ date: "2026-10-14", value: null, currency: "ZAR", change: null, product: "perec-eib" }],
      },
    ];
    assert.deepEqual(perecStatementQuote({ statementSeries: series, positions: [held] }, asset), { date: "2026-10-13", currency: "USD" });
    assert.equal(perecStatementQuote({ statementSeries: series, positions: [{ ...held, asset: "Ninety One", wallet: "Ninety One" }] }, "Ninety One"), null);
    assert.equal(perecStatementQuote({ statementSeries: series, positions: [{ ...held, asset: "Laden", wallet: "Pickle Rick" }] }, "Laden"), null);
  });

  it("buildAssetDetail_openedValue_isTheFirstRealPointNotTheChartWindow", () => {
    const oldDeposit: LedgerEvent = { ...deposit, id: "bn:L1:dep:old", t: noon("2024-06-01") };
    const opened = deriveFrom({
      state: state(),
      points: [],
      ledger: completeLedger([oldDeposit]),
      book: book(() => 8),
    });
    const detail = buildAssetDetail(opened, "BTC");
    assert.equal(jhbDay(Date.parse(detail.holdingOpened?.t ?? "")), "2024-06-01");
    const firstChart = detail.holdingHistory[0];
    assert.ok(firstChart);
    assert.ok(jhbDay(Date.parse(firstChart.t)) > "2024-06-01");

    const note = "Test Structured Note";
    const statementState = state({
      positions: [
        {
          exchange: "pickle_rick",
          linkId: "investment:1",
          linkName: note,
          containerId: null,
          wallet: "Peresec",
          asset: note,
          qty: 4,
        },
      ],
      prices: {},
      statementSeries: [
        {
          key: "investment:1",
          kind: "as",
          accountNumber: "1",
          product: "perec-as",
          containerId: null,
          asset: note,
          currency: "USD",
          points: [
            { date: "2024-06-01", value: 4, currency: "USD", change: null, product: "perec-as" },
            { date: "2026-10-01", value: 5, currency: "USD", change: null, product: "perec-as" },
          ],
        },
        {
          key: "investment:1|weib",
          kind: "weib",
          accountNumber: "1",
          product: "perec-weib",
          containerId: null,
          asset: note,
          currency: "USD",
          points: [{ date: "2024-01-01", value: 9, currency: "USD", change: null, product: "perec-weib" }],
        },
      ],
    });
    const statementDetail = buildAssetDetail(
      deriveFrom({ state: statementState, points: [], ledger: null, book: book(() => 0) }),
      note,
    );
    assert.equal(jhbDay(Date.parse(statementDetail.holdingOpened?.t ?? "")), "2024-06-01");
    assert.equal(statementDetail.holdingOpened?.usd, 4);
    assert.equal(statementDetail.holdingHistory.some((point) => point.usd === 9), false);

    const early = jhbDayStart("2024-06-01") + 60_000;
    const recent = jhbDayStart("2026-10-10") + 60_000;
    const point = (t: number): HistoryPoint => ({
      t,
      a: 8,
      d: 0,
      h: { none: { BTC: 1 } },
      c: { none: [8, 0] },
      p: { BTC: 8 },
      fx: 18,
    });
    const snapshots = deriveFrom({
      state: state(),
      points: [point(recent), point(early)],
      ledger: null,
      book: book(() => 8),
    });
    const snapshotDetail = buildAssetDetail(snapshots, "BTC");
    assert.equal(snapshotDetail.holdingOpened?.t, new Date(early).toISOString());
    assert.ok(snapshotDetail.holdingHistory.every((row) => Date.parse(row.t) !== early));
  });

  it("buildAssetDetail_externalFlows_listsDepositsAndSkipsIncome", () => {
    const income: LedgerEvent = {
      ...deposit,
      id: "bn:L1:inc:1",
      t: noon("2026-10-08"),
      type: "income",
      qty: 0.01,
      external: false,
    };
    const later: LedgerEvent = {
      ...deposit,
      id: "bn:L1:dep:2",
      t: noon("2026-10-09"),
      type: "deposit",
      qty: 0.25,
      usd: 40,
      external: true,
    };
    const detail = buildAssetDetail(
      deriveFrom({
        state: state(),
        points: [],
        ledger: completeLedger([deposit, income, later]),
        book: book(btcClose),
      }),
      "BTC",
    );
    assert.deepEqual(
      detail.externalFlows.map((flow) => flow.usd),
      [50_000, 40],
    );
    assert.equal(detail.externalFlows.some((flow) => flow.usd === 0.01 * 60_000), false);
  });
});

function point(day: string, asset: string, value: number, gapFill?: true): HistoryPoint {
  return {
    t: noon(day),
    a: 0,
    d: 0,
    h: { none: { [asset]: value } },
    c: {},
    p: {},
    fx: 18,
    ...(gapFill ? { gapFill: true as const } : {}),
  };
}

function bare(partial: Partial<PortfolioState>, points: HistoryPoint[] = []): Derived {
  return {
    state: state({ change24h: {}, prices: {}, positions: [], ...partial }),
    points,
    ledger: null,
    events: [],
    linkContainer: new Map(),
    book: book(() => 1),
    recon: null,
    series: null,
    reconciliation: [],
    containerTypes: new Map(),
  };
}

describe("statement prior value", () => {
  const note = "Peresec Prime Brokers — Structured Note";
  const held: Position = {
    exchange: "pickle_rick",
    linkId: "investment:3",
    linkName: note,
    containerId: null,
    wallet: "Peresec",
    asset: note,
    qty: 100,
    includeInTotal: true,
    balanceKnown: true,
  };

  it("statementPriorValue_previousPointLower_isAnUpMove_andASinglePointHasNoBadge", () => {
    const series: StatementSeries[] = [
      {
        key: "investment:3",
        kind: "as",
        accountNumber: "0454918",
        product: "",
        containerId: null,
        asset: note,
        currency: "USD",
        points: [
          { date: "2026-10-01", value: 80, currency: "USD", change: null, product: "brokerage" },
          { date: "2026-10-02", value: 100, currency: "USD", change: 20, product: "perec-as" },
        ],
      },
      {
        key: "0454918|perec-weib",
        kind: "weib",
        accountNumber: "0454918",
        product: "perec-weib",
        containerId: null,
        asset: note,
        currency: "USD",
        points: [{ date: "2026-10-03", value: 7, currency: "USD", change: 1, product: "perec-weib" }],
      },
    ];
    const prior = statementPriorValue(state({ positions: [held], statementSeries: series, change24h: {} }), [], note, null, 100);
    assert.equal(prior, 80);
    assert.equal(prior != null && (100 - prior) / prior > 0, true);
    assert.equal((100 - (prior ?? 0)) / (prior ?? 1), 20 / 80);
    const only = statementPriorValue(
      state({
        positions: [held],
        change24h: {},
        statementSeries: [{ ...series[0]!, points: [series[0]!.points[1]!] }],
      }),
      [],
      note,
      null,
      100,
    );
    assert.equal(only, null);
  });

  it("statementPriorValue_ibkrUsesThePreviousWeekdayEquityTotal", () => {
    const asset = "Interactive Brokers";
    const account: Position = {
      exchange: "pickle_rick",
      linkId: "ibkr:U1",
      linkName: "Interactive Brokers",
      containerId: null,
      wallet: "Interactive Brokers",
      asset,
      qty: 40,
      includeInTotal: true,
    };
    const prior = statementPriorValue(
      state({
        positions: [
          account,
          {
            exchange: "pickle_rick",
            linkId: "ibkr:U1|pos:1",
            linkName: "Alpha",
            containerId: null,
            wallet: "Interactive Brokers",
            asset: "Alpha",
            qty: 15,
            includeInTotal: false,
            parentLinkId: "ibkr:U1",
          },
        ],
        change24h: {},
        statementSeries: [
          {
            key: "ibkr:U1",
            kind: "ibkr",
            accountNumber: "U1",
            product: "equity",
            containerId: null,
            asset,
            currency: "USD",
            points: [
              { date: "2026-10-02", value: 50, currency: "USD", change: null, product: "equity" },
              { date: "2026-10-03", value: null, currency: "USD", change: null, product: "equity" },
              { date: "2026-10-05", value: 40, currency: "USD", change: null, product: "equity" },
            ],
          },
        ],
      }),
      [],
      asset,
      null,
      40,
    );
    assert.equal(prior, 50);
    assert.equal(prior != null && (40 - prior) / prior < 0, true);
    const listed = buildAssets(
      bare({
        positions: [
          account,
          {
            exchange: "pickle_rick",
            linkId: "ibkr:U1|pos:1",
            linkName: "Alpha",
            containerId: null,
            wallet: "Interactive Brokers",
            asset: "Alpha",
            qty: 15,
            includeInTotal: false,
            parentLinkId: "ibkr:U1",
          },
        ],
        statementSeries: [
          {
            key: "ibkr:U1",
            kind: "ibkr",
            accountNumber: "U1",
            product: "equity",
            containerId: null,
            asset,
            currency: "USD",
            points: [
              { date: "2026-10-02", value: 50, currency: "USD", change: null, product: "equity" },
              { date: "2026-10-05", value: 40, currency: "USD", change: null, product: "equity" },
            ],
          },
        ],
      }),
      undefined,
    );
    assert.equal(listed.assets.find((item) => item.asset === "Alpha"), undefined);
    assert.equal(listed.assets.find((item) => item.asset === asset)?.priorValue, 50);
  });

  it("statementPriorValue_ninetyOneUsesThePreviousSnapshot_andATickerCoinDoesNot", () => {
    const fund = "Ninety One Investment Portfolio";
    const position: Position = {
      exchange: "pickle_rick",
      linkId: "investment:4",
      linkName: fund,
      containerId: null,
      wallet: "Ninety One",
      asset: fund,
      qty: 5,
      includeInTotal: true,
    };
    const points = [point("2026-10-01", fund, 4), point("2026-10-02", fund, 4, true), point("2026-10-05", fund, 5)];
    const prior = statementPriorValue(state({ positions: [position], change24h: {}, statementSeries: [] }), points, fund, null, 5);
    assert.equal(prior, 4);
    const listed = buildAssets(bare({ positions: [position], statementSeries: [] }, points), undefined);
    assert.equal(listed.assets.find((item) => item.asset === fund)?.priorValue, 4);
    const coin = statementPriorValue(
      state({
        change24h: { BTC: 2.4 },
        positions: [{ exchange: "binance", linkId: "L1", linkName: "Main", containerId: null, wallet: "spot", asset: "BTC", qty: 1 }],
      }),
      [point("2026-10-01", "BTC", 1), point("2026-10-02", "BTC", 1.1)],
      "BTC",
      null,
      1.1,
    );
    assert.equal(coin, null);
  });
});

describe("performance downsample", () => {
  it("downsampleKeepingDays_keepsADayThatHasOnePoint", () => {
    const friday = Array.from({ length: 300 }, (_, index) => ({
      t: new Date(Date.parse("2026-10-16T04:00:00.000Z") + index * 60_000).toISOString(),
    }));
    const saturday = { t: "2026-10-17T21:59:59.999Z" };
    const kept = downsampleKeepingDays([...friday, saturday], 40);
    assert.equal(kept.some((item) => item.t === saturday.t), true);
    assert.ok(kept.length <= 40);
  });
});
