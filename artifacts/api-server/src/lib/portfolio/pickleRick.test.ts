import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { scopeSet } from "./derived";
import { carriedStatementUsd, mergeStatementHistory, pointTotals } from "./history";
import { applyPickleRick, investmentLayers, loadPickleRick, mapPickleRickHoldings, separateChildHoldings, PICKLE_RICK_EXCHANGE, PICKLE_RICK_PLACE } from "./pickleRick";
import { portfolioAssetParam } from "./types";
import { buildAssetDetail, buildAssets, scopedTotals } from "./views";
import type { Derived } from "./derived";
import type { PriceBook } from "./prices";
import { jhbDay } from "./time";
import type { ContainerInfo, PortfolioState, Position } from "./types";

const PERSONAL_ID = "acct_1779800548554_4uegtn";
const WLDD_ID = "acct_1780457812374_zts0d3";

const profiles: ContainerInfo[] = [
  { id: PERSONAL_ID, name: "Personal", type: "personal", linkIds: [], targetLtv: null },
  { id: WLDD_ID, name: "Trust · WLDD", type: "trust", linkIds: [], targetLtv: null },
];

function state(positions: Position[], prices: Record<string, number> = {}, errors: string[] = [], containers: ContainerInfo[] = []): PortfolioState {
  return {
    asOf: 1,
    positions,
    debts: [],
    prices,
    change24h: {},
    fx: 20,
    fxSource: "luno",
    containers,
    errors,
  };
}

function row(partial: Record<string, unknown>): Record<string, unknown> {
  return {
    key: "account:1",
    source: "pickle_rick",
    place: PICKLE_RICK_PLACE,
    kind: "account",
    name: "Cheque",
    account_type: "brokerage",
    institution: "Example Bank",
    currency: "USD",
    balance: 100,
    balance_known: true,
    quantity: null,
    as_of: null,
    trust_owned: false,
    isin: null,
    rolls_up_into: null,
    ...partial,
  };
}

const binance: Position = {
  exchange: "binance",
  linkId: "L1",
  linkName: "Main",
  containerId: null,
  wallet: "spot",
  asset: "BTC",
  qty: 2,
};

describe("pickle rick holdings", () => {
  it("mapPickleRickHoldings_lunoBinanceInstitution_isSkipped", () => {
    const mapped = mapPickleRickHoldings(
      {
        holdings: [
          row({ key: "investment:16", kind: "investment", name: "Bitcoin", institution: "Luno / Binance", currency: "ZAR", balance: 5 }),
          row({ key: "investment:4", kind: "investment", name: "Retirement annuity", institution: "Luno", currency: "USD", balance: 8 }),
          row({ key: "account:9", name: "Cash", institution: "", currency: "USD", balance: 3 }),
        ],
      },
      20,
    );
    assert.deepEqual(
      mapped.positions.map((position) => position.linkId),
      ["account:9"],
    );
    assert.equal(
      mapped.positions.every((position) => position.exchange === PICKLE_RICK_EXCHANGE && position.wallet !== "Luno / Binance"),
      true,
    );
  });

  it("mapPickleRickHoldings_dropsExchangeRowsAndAssignsPeresecProfiles", () => {
    const mapped = mapPickleRickHoldings(
      {
        holdings: [
          row({ key: "exchange:binance", name: "Spot", institution: "Binance", source: "pickle_rick" }),
          row({ key: "exchange:luno-name", name: "Luno wallet", institution: "Example Bank", source: "pickle_rick" }),
          row({ key: "exchange:source", name: "Cash", institution: "Example Bank", source: "binance" }),
          row({ key: "exchange:asset", name: "Fund", institution: "Example Bank", asset: "Binance BTC", source: "pickle_rick" }),
          row({ key: "investment:2", kind: "investment", name: "Peresec / Anchor Capital Asset Swap (Personal)", institution: "" }),
          row({
            key: "investment:3",
            kind: "investment",
            name: "Peresec Prime Brokers — Structured Note (personal)",
            institution: "",
          }),
          row({
            key: "investment:1",
            kind: "investment",
            name: "Anchor Capital / Peresec Consolidated Portfolio",
            institution: "Peresec / Anchor Capital",
            trust_owned: true,
          }),
          row({
            key: "investment:wldd",
            kind: "investment",
            name: "Peresec WLDD brokerage",
            institution: "Peresec",
          }),
          row({
            key: "investment:9",
            kind: "investment",
            name: "Inner fund",
            institution: "Peresec",
            rolls_up_into: "investment:2",
          }),
          row({ key: "account:9", name: "Cash", institution: "Example Bank" }),
        ],
      },
      20,
      profiles,
    );
    assert.deepEqual(
      mapped.positions.map((position) => position.linkId),
      ["investment:2", "investment:3", "investment:1", "investment:wldd", "investment:9", "account:9"],
    );
    assert.equal(mapped.positions.find((position) => position.linkId === "investment:2")?.containerId, null);
    assert.equal(mapped.positions.find((position) => position.linkId === "investment:3")?.containerId, PERSONAL_ID);
    assert.equal(mapped.positions.find((position) => position.linkId === "investment:1")?.containerId, WLDD_ID);
    assert.equal(mapped.positions.find((position) => position.linkId === "investment:wldd")?.containerId, null);
    const rolled = mapped.positions.find((position) => position.linkId === "investment:9");
    assert.equal(rolled?.includeInTotal, false);
    assert.equal(rolled?.containerId, null);
    assert.equal(mapped.positions.find((position) => position.linkId === "account:9")?.containerId, null);
    assert.equal(mapped.positions.find((position) => position.linkId === "investment:2")?.includeInTotal, true);
  });

  it("mapPickleRickHoldings_rollsUpInto_isListedButNotAddedToParentTotal", () => {
    const mapped = mapPickleRickHoldings(
      {
        holdings: [
          row({ key: "account:1", name: "Brokerage", institution: "Example Bank", balance: 100 }),
          row({
            key: "investment:9",
            kind: "investment",
            name: "Inner fund",
            institution: "Example Bank",
            balance: 40,
            rolls_up_into: "account:1",
          }),
          row({
            key: "account:2",
            name: "Interactive Brokers (IBKR) USD",
            institution: "Interactive Brokers LLC",
            balance: null,
            balance_known: false,
          }),
        ],
      },
      20,
    );
    const parent = mapped.positions.find((position) => position.linkId === "account:1");
    const line = mapped.positions.find((position) => position.linkId === "investment:9");
    const broker = mapped.positions.find((position) => position.linkId === "account:2");
    assert.ok(parent);
    assert.ok(line);
    assert.ok(broker);
    assert.equal(parent.includeInTotal, true);
    assert.equal(parent.qty, 100);
    assert.equal(line.includeInTotal, false);
    assert.equal(line.qty, 40);
    assert.equal(line.wallet, "Example Bank");
    assert.equal(broker.balanceKnown, false);
    assert.equal(broker.qty, 0);
    assert.equal(broker.wallet, "Interactive Brokers LLC");
    const counted = mapped.positions
      .filter((position) => position.includeInTotal !== false)
      .reduce((sum, position) => sum + position.qty * (mapped.prices[position.asset] ?? 0), 0);
    assert.equal(counted, 100);
    assert.equal(
      mapped.positions.every((position) => position.exchange === PICKLE_RICK_EXCHANGE),
      true,
    );
  });

  it("applyPickleRick_unauthorizedOrUnavailable_keepsPriorRowsAndSetsSourceError", () => {
    const priorPickle: Position = {
      exchange: PICKLE_RICK_EXCHANGE,
      linkId: "account:1",
      linkName: "Brokerage",
      containerId: null,
      wallet: "Example Bank",
      asset: "Brokerage",
      qty: 5,
      includeInTotal: true,
      balanceKnown: true,
    };
    const priorExchange: Position = {
      exchange: PICKLE_RICK_EXCHANGE,
      linkId: "exchange:luno",
      linkName: "Luno wallet",
      containerId: null,
      wallet: "Example Bank",
      asset: "Luno wallet",
      qty: 4,
    };
    const previous = state([{ ...binance, qty: 9 }, priorPickle, priorExchange], { BTC: 99, Brokerage: 1, "Luno wallet": 1 }, [], profiles);
    previous.statementSeries = [
      {
        key: "investment:1",
        kind: "as",
        accountNumber: "0433383",
        product: "",
        containerId: WLDD_ID,
        asset: "Brokerage",
        currency: "USD",
        points: [{ date: "2026-09-30", value: 5, currency: "USD", change: null, product: "brokerage" }],
      },
    ];
    for (const code of [401, 503] as const) {
      const fresh = state([{ ...binance }], { BTC: 3 }, ["binance:L1:holdings"], profiles);
      applyPickleRick(fresh, previous, { status: "error", code });
      assert.equal(fresh.positions.find((position) => position.exchange === "binance")?.qty, 2);
      assert.equal(fresh.prices.BTC, 3);
      assert.equal(fresh.positions.find((position) => position.exchange === PICKLE_RICK_EXCHANGE)?.linkId, "account:1");
      assert.equal(fresh.positions.some((position) => position.linkId === "exchange:luno"), false);
      assert.equal(fresh.prices["Luno wallet"], undefined);
      assert.equal(fresh.prices.Brokerage, 1);
      assert.ok(fresh.errors.includes(`pickle_rick:${code}`));
      assert.ok(fresh.errors.includes("binance:L1:holdings"));
      assert.equal(fresh.statementSeries?.[0]?.points[0]?.product, "brokerage");
      assert.equal(fresh.statementSeries?.[0]?.points[0]?.date, "2026-09-30");
    }

    const incoming = state([{ ...binance }], { BTC: 3 }, [], profiles);
    applyPickleRick(incoming, null, {
      status: "ok",
      positions: [
        {
          exchange: PICKLE_RICK_EXCHANGE,
          linkId: "exchange:binance",
          linkName: "Spot",
          containerId: null,
          wallet: "Binance",
          asset: "Spot",
          qty: 7,
        },
        {
          exchange: PICKLE_RICK_EXCHANGE,
          linkId: "investment:3",
          linkName: "Peresec Prime Brokers — Structured Note",
          containerId: null,
          wallet: "Peresec",
          asset: "Peresec Prime Brokers — Structured Note",
          qty: 1,
          includeInTotal: true,
          balanceKnown: true,
        },
        {
          exchange: PICKLE_RICK_EXCHANGE,
          linkId: "investment:2",
          linkName: "Peresec personal trust WLDD",
          containerId: null,
          wallet: "Peresec",
          asset: "Peresec personal trust WLDD",
          qty: 1,
          includeInTotal: true,
          balanceKnown: true,
        },
      ],
      prices: { Spot: 2, "Peresec Prime Brokers — Structured Note": 1, "Peresec personal trust WLDD": 1 },
      series: [],
    });
    assert.equal(incoming.positions.some((position) => position.linkId === "exchange:binance"), false);
    assert.equal(incoming.prices.Spot, undefined);
    assert.equal(incoming.positions.find((position) => position.linkId === "investment:3")?.containerId, PERSONAL_ID);
    assert.equal(incoming.positions.find((position) => position.linkId === "investment:2")?.containerId, null);
    assert.equal(incoming.positions.find((position) => position.exchange === "binance")?.qty, 2);
    assert.deepEqual(incoming.statementSeries, []);
  });

  it("mapPickleRickHoldings_keysAssignProfilesAndKeepBrokerageBesideSideSeries", () => {
    const mapped = mapPickleRickHoldings(
      {
        holdings: [
          row({
            key: "investment:1",
            account_number: "0433383",
            kind: "investment",
            name: "Anchor Capital / Peresec Consolidated Portfolio",
            institution: "Peresec",
            currency: "USD",
            balance: 100,
            as_of: "2026-10-13",
            history: [
              { date: "2026-09-30", value: 80, currency: "USD", change: null, product: "brokerage" },
              { date: "2026-10-13", value: 90, currency: "USD", change: 10, product: "perec-as" },
            ],
          }),
          row({
            key: "investment:3",
            account_number: "0454918",
            kind: "investment",
            name: "Peresec Prime Brokers — Structured Note",
            institution: "Peresec",
            currency: "USD",
            balance: 50,
            as_of: "2026-10-13",
            history: [
              { date: "2026-09-30", value: 40, currency: "USD", change: null, product: "brokerage" },
              { date: "2026-10-13", value: 45, currency: "USD", change: 5, product: "perec-as" },
            ],
          }),
          row({ key: "investment:16", kind: "investment", name: "Bitcoin", institution: "Luno / Binance", currency: "ZAR", balance: 5 }),
          row({
            key: "investment:9",
            kind: "investment",
            name: "Inner fund",
            institution: "Peresec",
            balance: 40,
            rolls_up_into: "investment:1",
          }),
        ],
        history: [
          {
            key: "investment:1",
            account_number: "0433383",
            history: [
              { date: "2026-09-30", value: 80, currency: "USD", change: null, product: "brokerage" },
              { date: "2026-10-01", value: 81, currency: "USD", change: 1, product: "perec-as" },
            ],
          },
          {
            key: "0433383|perec-weib",
            account_number: "0433383",
            product: "perec-weib",
            currency: "USD",
            history: [{ date: "2026-10-13", value: 7, currency: "USD", change: 1, product: "perec-weib" }],
          },
          {
            key: "0433383|perec-eib",
            account_number: "0433383",
            product: "perec-eib",
            currency: "USD",
            history: [{ date: "2026-10-13", value: 3, currency: "USD", change: null, product: "perec-eib" }],
          },
          {
            key: "0454918|perec-weib",
            account_number: "0454918",
            product: "perec-weib",
            currency: "USD",
            history: [{ date: "2026-10-13", value: 9, currency: "USD", change: 1, product: "perec-weib" }],
          },
          {
            key: "0454918|perec-eib",
            account_number: "0454918",
            product: "perec-eib",
            currency: "USD",
            history: [
              { date: "2026-10-12", value: null, currency: "USD", change: null, product: "perec-eib" },
              { date: "2026-10-13", value: null, currency: "USD", change: null, product: "perec-eib" },
            ],
          },
        ],
      },
      20,
      profiles,
    );

    const trust = mapped.positions.find((position) => position.linkId === "investment:1");
    const personal = mapped.positions.find((position) => position.linkId === "investment:3");
    assert.equal(trust?.containerId, WLDD_ID);
    assert.equal(personal?.containerId, PERSONAL_ID);
    assert.equal(trust?.qty, 100);
    assert.equal(personal?.qty, 50);
    assert.equal(mapped.positions.some((position) => position.linkId === "investment:16"), false);
    assert.equal(mapped.positions.some((position) => position.linkId.endsWith("|perec-weib") || position.linkId.endsWith("|perec-eib")), false);
    assert.equal(mapped.positions.some((position) => /weib|eib/i.test(position.asset)), false);

    const trustSeries = mapped.series.find((item) => item.key === "investment:1");
    assert.ok(trustSeries);
    assert.equal(trustSeries.points.filter((point) => point.date === "2026-09-30" && point.product === "brokerage").length, 1);
    assert.equal(trustSeries.points.some((point) => point.date === "2026-10-01" && point.product === "perec-as"), true);
    assert.equal(trustSeries.points.some((point) => point.product === "perec-as"), true);
    assert.equal(trustSeries.points.some((point) => point.product === "perec-weib"), false);

    const trustWeib = mapped.series.find((item) => item.accountNumber === "0433383" && item.kind === "weib");
    const personalEib = mapped.series.find((item) => item.accountNumber === "0454918" && item.kind === "eib");
    assert.equal(trustWeib?.asset, trust?.asset);
    assert.equal(trustWeib?.containerId, WLDD_ID);
    assert.equal(personalEib?.asset, personal?.asset);
    const counted = mapped.positions
      .filter((position) => position.includeInTotal !== false && position.balanceKnown !== false)
      .reduce((sum, position) => sum + position.qty * (mapped.prices[position.asset] ?? 0), 0);
    assert.equal(counted, 150);

    const personalEibSeries = mapped.series.find((item) => item.accountNumber === "0454918" && item.kind === "eib");
    assert.ok(personalEibSeries);
    assert.equal(personalEibSeries.points.length, 2);
    assert.equal(personalEibSeries.points.every((point) => point.value === null && point.currency === "USD"), true);
    assert.equal(personalEibSeries.points.some((point) => point.value === 0), false);
    assert.equal(personalEib?.containerId, PERSONAL_ID);
    assert.equal(mapped.series.filter((item) => item.kind === "weib" || item.kind === "eib").length, 4);
    const trustLayers = investmentLayers(mapped.series, trust?.asset ?? "");
    assert.equal(trustLayers?.name, "WEIB");
    assert.equal(trustLayers?.inside?.name, "EIB");
    assert.equal(trustLayers?.inside?.currency, "USD");
    const personalLayers = investmentLayers(mapped.series, personal?.asset ?? "");
    assert.equal(personalLayers?.inside?.value, null);
    assert.equal(personalLayers?.inside?.points.some((point) => point.value === 0), false);
    const detached = mapped.series.map((item) => (item.kind === "as" ? item : { ...item, asset: `${item.kind}-detached` }));
    assert.equal(investmentLayers(detached, trust?.asset ?? "")?.inside?.name, "EIB");

    assert.equal(carriedStatementUsd(mapped.series, new Set([WLDD_ID]), "2026-10-13", 20), 90);
    const merged = mergeStatementHistory([], {
      ...state(mapped.positions, mapped.prices, [], profiles),
      statementSeries: mapped.series,
    });
    const september = merged.find((point) => jhbDay(point.t) === "2026-09-30");
    assert.ok(september);
    assert.equal(september.h[WLDD_ID]?.[trust?.asset ?? ""], 80);
    assert.equal(Object.keys(september.h[WLDD_ID] ?? {}).some((key) => /weib|eib/i.test(key)), false);
    assert.equal(Object.keys(september.h).some((key) => JSON.stringify(september.h[key]).includes("perec-weib")), false);

    const book: PriceBook = { close: () => 0, fx: () => 20, fxIsReference: () => false, hourly: () => [], daily: () => ({}) };
    const derived: Derived = {
      state: { ...state(mapped.positions, mapped.prices, [], profiles), statementSeries: mapped.series, asOf: Date.parse("2026-10-13T12:00:00+02:00") },
      points: [],
      ledger: null,
      events: [],
      linkContainer: new Map(),
      book,
      recon: null,
      series: null,
      reconciliation: [],
      containerTypes: new Map(),
    };
    const list = buildAssets(derived, undefined);
    assert.deepEqual(
      list.assets.map((item) => item.asset).sort(),
      [personal?.asset ?? "", trust?.asset ?? ""].sort(),
    );
    const trustRow = list.assets.find((item) => item.asset === trust?.asset);
    assert.equal(trustRow?.positions.some((position) => position.linkId === "investment:9"), true);
    assert.equal(trustRow?.qty, 100);
    const detail = buildAssetDetail(derived, trust?.asset ?? "");
    assert.equal(detail.inside?.name, "WEIB");
    assert.equal(detail.inside?.inside?.name, "EIB");
    assert.equal(detail.asset.asset, trust?.asset);
    const qtys = detail.holdingHistory.map((point) => point.qty);
    assert.equal(qtys.includes(80), true);
    assert.equal(qtys.includes(81), true);
    assert.equal(qtys.includes(7), false);
    assert.equal(detail.holdingHistory.some((point) => point.qty === 0 && point.usd === 0), false);
  });

  it("portfolioAssetParam_acceptsStatementNamesAndTickers", () => {
    assert.equal(portfolioAssetParam("btc"), "BTC");
    assert.equal(portfolioAssetParam("xbt"), "BTC");
    assert.equal(portfolioAssetParam("Anchor Capital / Peresec Consolidated Portfolio"), "Anchor Capital / Peresec Consolidated Portfolio");
    assert.equal(portfolioAssetParam("Anchor%20Capital%20%2F%20Peresec"), "Anchor Capital / Peresec");
    assert.equal(portfolioAssetParam(""), null);
    assert.equal(portfolioAssetParam("bad?name"), null);
  });

  it("loadPickleRick_unsetToken_skips", async () => {
    const previous = process.env.PICKLE_RICK_HOLDINGS_TOKEN;
    delete process.env.PICKLE_RICK_HOLDINGS_TOKEN;
    try {
      const outcome = await loadPickleRick(null, async () => {
        throw new Error("should not fetch");
      });
      assert.deepEqual(outcome, { status: "skipped" });
    } finally {
      if (previous === undefined) delete process.env.PICKLE_RICK_HOLDINGS_TOKEN;
      else process.env.PICKLE_RICK_HOLDINGS_TOKEN = previous;
    }
  });

  it("mapPickleRickHoldings_childNames_areSeparateFromTheUser", () => {
    const mapped = mapPickleRickHoldings(
      {
        holdings: [
          row({ key: "investment:1", name: "Anchor Capital / Peresec Consolidated Portfolio", institution: "Peresec", balance: 10 }),
          row({ key: "investment:3", name: "Peresec Prime Brokers — Structured Note", institution: "Peresec", balance: 20 }),
          row({ key: "investment:22", name: "Ninety One — Mr Greyson Fourie", institution: "Ninety One", balance: 4 }),
          row({ key: "investment:21", name: "Ninety One — Miss Ivelle Fourie", institution: "Ninety One IP", balance: 5 }),
          row({ key: "investment:23", name: "Ninety One — Mr Landen George Fourie", institution: "Ninety One", balance: 6 }),
          row({ key: "investment:4", name: "Retirement annuity — Elandre", institution: "Ninety One", balance: 7 }),
          row({ key: "account:2", name: "Interactive Brokers (IBKR) USD", institution: "Interactive Brokers LLC", balance: 8 }),
          row({ key: "investment:both", name: "Greyson and Ivelle joint", institution: "Example Bank", balance: 2 }),
          row({ key: "exchange:luno", name: "Luno wallet", institution: "Luno", balance: 9 }),
        ],
        history: [
          {
            key: "unmatched:Ivelle Fourie|Investec Private Banking||",
            holder: "Ivelle Fourie",
            institution: "Investec Private Banking",
            points: [
              { date: "2026-09-01", value: 1, currency: "USD", change: null, product: "" },
              { date: "2026-10-01", value: 3, currency: "USD", change: null, product: "" },
            ],
          },
          {
            key: "0454918|perec-eib",
            account_number: "0454918",
            product: "perec-eib",
            points: [{ date: "2026-10-13", value: null, currency: "USD", change: null, product: "perec-eib" }],
          },
        ],
      },
      20,
      profiles,
    );
    const container = (linkId: string) => mapped.positions.find((position) => position.linkId === linkId)?.containerId ?? null;
    assert.equal(container("investment:1"), WLDD_ID);
    assert.equal(container("investment:3"), PERSONAL_ID);
    assert.equal(container("investment:22"), "child:greyson");
    assert.equal(container("investment:21"), "child:ivelle");
    assert.equal(container("investment:23"), "child:laden");
    assert.equal(container("investment:4"), null);
    assert.equal(container("account:2"), null);
    assert.equal(container("investment:both"), null);
    assert.equal(mapped.positions.some((position) => position.linkId === "exchange:luno"), false);
    assert.equal(mapped.positions.some((position) => position.linkId.includes("perec-eib")), false);
    const investec = mapped.positions.find((position) => position.linkId.startsWith("unmatched:Ivelle"));
    assert.equal(investec?.containerId, "child:ivelle");
    assert.equal(investec?.qty, 3);
    assert.equal(investec?.balanceKnown, true);

    const held = separateChildHoldings(state([{ ...binance }, ...mapped.positions], { ...mapped.prices, BTC: 3 }, [], profiles));
    assert.equal(held.positions.find((position) => position.exchange === "binance")?.qty, 2);
    assert.equal(held.positions.find((position) => position.exchange === "luno"), undefined);
    const combined = scopeSet(held, undefined);
    const greyson = scopeSet(held, "child:greyson");
    const ivelle = scopeSet(held, "child:ivelle");
    const laden = scopeSet(held, "child:laden");
    assert.equal(combined.id, "all");
    assert.equal(scopedTotals(held, combined.set).netUsd, 10 + 20 + 7 + 8 + 2 + 2 * 3);
    assert.equal(scopedTotals(held, greyson.set).netUsd, 4);
    assert.equal(scopedTotals(held, ivelle.set).netUsd, 5 + 3);
    assert.equal(scopedTotals(held, laden.set).netUsd, 6);
    assert.deepEqual(
      held.positions.filter((position) => position.containerId === "child:greyson").map((position) => position.linkId),
      ["investment:22"],
    );
    assert.deepEqual(
      held.containers.filter((container) => container.type === "child").map((container) => container.name),
      ["Laden", "Ivelle", "Greyson"],
    );

    const remembered = {
      t: 1,
      a: 16,
      d: 0,
      fx: null,
      h: { none: { Cash: 5, "Retirement annuity — Elandre": 7, "tfsa — Mr Greyson Fourie": 4 } },
      c: { none: [16, 0] as [number, number] },
      p: { Cash: 1, "Retirement annuity — Elandre": 1, "tfsa — Mr Greyson Fourie": 1 },
    };
    assert.equal(pointTotals(remembered, combined.set).assets, 12);
    assert.equal(pointTotals(remembered, greyson.set).assets, 4);
  });

  it("mapPickleRickHoldings_interactiveBrokers_usesNavAndDoesNotAddPositionsOrEquity", () => {
    const street = "1 Secret Road";
    const email = "ada@example.com";
    const born = "1990-01-01";
    const mapped = mapPickleRickHoldings(
      {
        holdings: [
          row({ key: "account:2", name: "Interactive Brokers U1", institution: "Interactive Brokers", balance: 8 }),
          row({ key: "account:9", name: "Interactive Brokers (IBKR) USD", institution: "Interactive Brokers LLC", balance: null, balance_known: false }),
          row({
            key: "investment:50",
            kind: "investment",
            name: "Alpha",
            institution: "Interactive Brokers",
            balance: 40,
            rolls_up_into: "account:2",
          }),
          row({ key: "investment:luno", kind: "investment", name: "Luno wallet", institution: "Luno", balance: 9 }),
          row({ key: "investment:binance", kind: "investment", name: "Binance spot", institution: "Binance", balance: 4 }),
        ],
        interactive_brokers: {
          guide: "overview positions cash nav equity_history trades",
          accounts: [
            {
              section: "all",
              account_id: "U1",
              currency: "USD",
              report: {
                account: {
                  account_id: "U1",
                  name: "Ada",
                  currency: "USD",
                  account_type: "Individual",
                  street,
                  primaryEmail: email,
                  dateOfBirth: born,
                },
                nav_value: 100,
                nav: { ending_value: 100, starting_value: 80, deposits_withdrawals: 7, time_weighted_return: 0.1 },
                cash: [{ currency: "USD", ending_cash: 5, deposits: 7, withdrawals: 1, dividends: 2, broker_interest: 1, commissions: -1 }],
                positions: [
                  { conid: "1", symbol: "AAA", name: "Alpha", quantity: 2, value: 40, currency: "USD" },
                  { conid: "2", symbol: "BBB", name: "Beta", quantity: -3, value: -15, currency: "USD" },
                  { conid: "3", symbol: "LDN", name: "Landen note", quantity: 1, value: 6, currency: "USD" },
                  { conid: "4", symbol: "BNB", name: "Binance BTC", quantity: 1, value: 12, currency: "USD" },
                ],
                equity_history: [
                  { date: "2026-10-01", currency: "USD", total: 90, cash: 5, stock: 80, options: 5 },
                  { date: "2026-10-02", currency: "USD", total: 100, cash: 5, stock: 90, options: 5 },
                  { date: "2026-10-03", currency: "USD", cash: 4, stock: 5, options: 1 },
                ],
                trades: [{ symbol: "AAA", proceeds: 999, quantity: 2 }],
                commissions: [{ commission: 999 }],
              },
            },
          ],
        },
      },
      20,
      profiles,
    );
    const account = mapped.positions.find((position) => position.includeInTotal !== false && /interactive brokers|ibkr/i.test(`${position.wallet}\n${position.linkName}`));
    assert.ok(account);
    assert.equal(account.containerId, PERSONAL_ID);
    assert.equal(account.qty, 100);
    assert.equal(account.balanceKnown, true);
    assert.equal(account.linkId.startsWith("ibkr:"), true);
    assert.equal(account.linkId.includes("trust"), false);
    const lines = mapped.positions.filter((position) => position.parentLinkId === account.linkId);
    assert.equal(lines.every((position) => position.includeInTotal === false && position.containerId === PERSONAL_ID), true);
    assert.equal(lines.filter((position) => position.linkId.includes("|pos:")).length, 3);
    assert.equal(lines.some((position) => position.linkName === "Beta · short · 3 shares"), true);
    assert.equal(lines.some((position) => position.linkName === "Landen note · 1 share"), true);
    assert.equal(lines.find((position) => position.linkId.endsWith("|cash:USD"))?.qty, 5);
    assert.equal(mapped.positions.some((position) => position.linkId === "account:2" || position.linkId === "account:9" || position.linkId === "investment:50"), false);
    assert.equal(mapped.positions.some((position) => /binance|luno/i.test(`${position.linkName}\n${position.wallet}\n${position.asset}`)), false);
    const counted = mapped.positions
      .filter((position) => position.includeInTotal !== false)
      .reduce((sum, position) => sum + position.qty * (mapped.prices[position.asset] ?? 0), 0);
    assert.equal(counted, 100);
    const equity = mapped.series.find((item) => item.kind === "ibkr" && item.asset === account.asset);
    assert.ok(equity);
    assert.deepEqual(
      equity.points.map((point) => point.value),
      [90, 100, null],
    );
    assert.equal(equity.points.some((point) => point.value === 10 || point.value === 190), false);
    assert.equal(carriedStatementUsd(mapped.series, null, "2026-10-03", 20), 0);
    assert.equal(mergeStatementHistory([], { ...state(mapped.positions, mapped.prices, [], profiles), statementSeries: mapped.series }).length, 0);
    const dumped = JSON.stringify(mapped);
    assert.equal(dumped.includes(street), false);
    assert.equal(dumped.includes(email), false);
    assert.equal(dumped.includes(born), false);
    assert.equal(mapped.positions.some((position) => position.qty === 999 || position.qty === 7 || position.qty === 8 || position.qty === 9), false);

    const held = separateChildHoldings(state(mapped.positions, mapped.prices, [], profiles));
    held.statementSeries = mapped.series;
    assert.equal(held.positions.find((position) => position.linkName.startsWith("Landen"))?.containerId, PERSONAL_ID);
    const book: PriceBook = { close: () => 0, fx: () => 20, fxIsReference: () => false, hourly: () => [], daily: () => ({}) };
    const derived: Derived = {
      state: { ...held, statementSeries: mapped.series, asOf: Date.parse("2026-10-04T12:00:00+02:00") },
      points: [],
      ledger: null,
      events: [],
      linkContainer: new Map(),
      book,
      recon: null,
      series: null,
      reconciliation: [],
      containerTypes: new Map(),
    };
    const list = buildAssets(derived, undefined);
    const listed = list.assets.find((item) => item.asset === account.asset);
    assert.ok(listed);
    assert.equal(listed.qty, 100);
    assert.equal(listed.usd, 100);
    assert.equal(listed.positions.filter((position) => position.includeInTotal === false).length, 4);
    const detail = buildAssetDetail(derived, account.asset);
    assert.deepEqual(
      detail.holdingHistory.map((point) => point.qty),
      [90, 100],
    );
    assert.equal(detail.asset.qty, 100);
  });

  it("mapPickleRickHoldings_interactiveBrokers_optionAndStockStayInsideNav", () => {
    const mapped = mapPickleRickHoldings(
      {
        interactive_brokers: {
          accounts: [
            {
              section: "all",
              account_id: "U7",
              currency: "USD",
              report: {
                account: { account_id: "U7", currency: "USD", account_type: "Individual" },
                nav_value: 100,
                cash: [{ currency: "USD", ending_cash: 5 }],
                positions: [
                  { symbol: "IBKR", name: "Interactive Brokers", asset_category: "STK", asset_type: "STK", quantity: 4, value: 20, currency: "USD", side: "Long" },
                  {
                    symbol: "IBKR",
                    name: "IBKR",
                    asset_category: "OPT",
                    asset_type: "OPT",
                    put_call: "C",
                    expiry: "2026-10-30",
                    quantity: 11,
                    value: 30,
                    currency: "USD",
                    side: "Long",
                  },
                ],
                equity_history: [
                  { date: "2026-10-01", currency: "USD", total: 90 },
                  { date: "2026-10-02", currency: "USD", total: 110 },
                ],
              },
            },
          ],
        },
      },
      null,
      profiles,
    );
    const account = mapped.positions.find((position) => position.includeInTotal !== false);
    assert.ok(account);
    assert.equal(account.qty, 100);
    const lines = mapped.positions.filter((position) => position.parentLinkId === account.linkId);
    assert.equal(lines.length, 3);
    assert.equal(lines.every((position) => position.includeInTotal === false), true);
    const names = lines.map((position) => position.linkName);
    assert.equal(names.includes("Interactive Brokers · 4 shares"), true);
    assert.equal(names.includes("IBKR · 11 contracts · expires 30 October 2026"), true);
    assert.equal(names.filter((name) => name === "USD cash").length, 1);
    const counted = mapped.positions
      .filter((position) => position.includeInTotal !== false)
      .reduce((sum, position) => sum + position.qty * (mapped.prices[position.asset] ?? 0), 0);
    assert.equal(counted, 100);
    assert.equal(counted === 20 + 30 + 5 + 100, false);
    const equity = mapped.series.find((item) => item.kind === "ibkr");
    assert.deepEqual(
      equity?.points.map((point) => point.value),
      [90, 110],
    );
  });

  it("mapPickleRickHoldings_interactiveBrokersOverview_isTheAccountAndTrustWhenThePayloadSaysSo", () => {
    const personal = mapPickleRickHoldings(
      {
        interactive_brokers: {
          accounts: [
            {
              account: { account_id: "U2", currency: "USD", account_type: "Individual" },
              nav_value: 50,
              positions: [{ name: "Gamma", symbol: "G", quantity: 4, value: 20, currency: "USD" }],
              cash: [{ currency: "USD", amount: 4 }],
            },
          ],
        },
      },
      null,
      profiles,
    );
    const account = personal.positions.find((position) => position.includeInTotal !== false);
    assert.equal(account?.qty, 50);
    assert.equal(account?.containerId, PERSONAL_ID);
    assert.equal(personal.positions.filter((position) => position.includeInTotal === false).length, 2);
    assert.equal(personal.series.length, 0);
    const trust = mapPickleRickHoldings(
      {
        interactive_brokers: {
          accounts: [
            {
              section: "all",
              report: {
                account: { account_id: "U3", currency: "USD", account_type: "Trust" },
                nav_value: 10,
                positions: [],
                equity_history: [{ date: "2026-10-01", currency: "USD", total: 10 }],
              },
            },
          ],
        },
      },
      null,
      profiles,
    );
    const trustAccount = trust.positions.find((position) => position.includeInTotal !== false);
    assert.equal(trustAccount?.containerId, WLDD_ID);
    assert.equal(trustAccount?.linkId.startsWith("ibkr:trust:"), true);
    assert.equal(trust.series[0]?.kind, "ibkr");
    assert.equal(trustAccount?.qty, 10);
    assert.equal(trust.series[0]?.flows, undefined);
  });

  it("mapPickleRickHoldings_interactiveBrokers_depositsAreFlowsAndDividendsAreNot", () => {
    const mapped = mapPickleRickHoldings(
      {
        interactive_brokers: {
          accounts: [
            {
              section: "all",
              report: {
                account: { account_id: "U9", currency: "USD", account_type: "Individual" },
                nav_value: 210,
                equity_history: [
                  { date: "2026-07-21", currency: "USD", total: 100 },
                  { date: "2026-07-30", currency: "USD", total: 202 },
                  { date: "2026-08-20", currency: "USD", total: 210 },
                ],
                cash_transactions: [
                  { type: "Deposits/Withdrawals", amount: 102, currency: "USD", date_time: "20260730;120000", description: "Electronic Fund Transfer" },
                  { type: "Withdrawal", amount: -8, currency: "USD", date: "2026-08-10", description: "Wire" },
                  { type: "Dividends", amount: 2, currency: "USD", date_time: "2026-08-01;120000", description: "AAA dividend" },
                  { type: "Broker Interest Received", amount: 1, currency: "USD", settle_date: "2026-08-15", description: "USD credit interest" },
                  { type: "Other Fees", amount: -1, currency: "USD", date_time: "2026-08-18;120000", description: "Fee" },
                  { type: "Internal Transfer", amount: 50, currency: "USD", date_time: "2026-08-19;120000", description: "Internal Transfer" },
                ],
                funds: [{ date: "2026-07-30", activity: "Deposit", description: "same cash again", amount: 102, currency: "USD" }],
                positions: [{ name: "Cash line", symbol: "C", quantity: 1, value: 210, currency: "USD" }],
              },
            },
          ],
        },
      },
      null,
      profiles,
    );
    const account = mapped.positions.find((position) => position.includeInTotal !== false);
    assert.equal(account?.qty, 210);
    const counted = mapped.positions
      .filter((position) => position.includeInTotal !== false)
      .reduce((sum, position) => sum + position.qty * (mapped.prices[position.asset] ?? 0), 0);
    assert.equal(counted, 210);
    const equity = mapped.series.find((item) => item.kind === "ibkr");
    assert.deepEqual(equity?.flows, [
      { date: "2026-07-30", amount: 102, currency: "USD" },
      { date: "2026-08-10", amount: -8, currency: "USD" },
    ]);
    assert.equal(equity?.points.some((point) => point.value === 100 + 202 + 210), false);
    const book: PriceBook = { close: () => 0, fx: () => null, fxIsReference: () => false, hourly: () => [], daily: () => ({}) };
    const detail = buildAssetDetail(
      {
        state: { ...state(mapped.positions, mapped.prices, [], profiles), statementSeries: mapped.series, asOf: Date.parse("2026-08-21T10:00:00+02:00"), fx: null },
        points: [],
        ledger: null,
        events: [],
        linkContainer: new Map(),
        book,
        recon: null,
        series: null,
        reconciliation: [],
        containerTypes: new Map(),
      },
      account?.asset ?? "",
    );
    assert.deepEqual(
      detail.externalFlows.map((flow) => flow.usd),
      [102, -8],
    );
    assert.equal(detail.asset.qty, 210);

    const fundsOnly = mapPickleRickHoldings(
      {
        interactive_brokers: {
          accounts: [
            {
              section: "all",
              report: {
                account: { account_id: "U8", currency: "USD" },
                nav_value: 50,
                equity_history: [{ date: "2026-07-21", currency: "USD", total: 50 }],
                funds: [
                  { date: "2026-08-01", activity: "Deposit", description: "Wire in", amount: 20, currency: "USD" },
                  { date: "2026-08-02", activity: "Dividends", description: "Coupon", amount: 1, currency: "USD" },
                ],
              },
            },
          ],
        },
      },
      null,
      profiles,
    );
    assert.deepEqual(fundsOnly.series.find((item) => item.kind === "ibkr")?.flows, [{ date: "2026-08-01", amount: 20, currency: "USD" }]);
  });

  it("mapPickleRickHoldings_statementContributions_areExternalFlows", () => {
    const mapped = mapPickleRickHoldings(
      {
        holdings: [row({ key: "investment:1", kind: "investment", name: "Asset swap", institution: "Peresec", balance: 16, currency: "USD" })],
        history: [
          {
            key: "investment:1",
            account_number: "0433383",
            product: "perec-as",
            currency: "USD",
            points: [
              { date: "2026-07-21", value: 10, currency: "USD", product: "perec-as", contributions: 10, withdrawals: null },
              { date: "2026-08-20", value: 16, currency: "USD", product: "perec-as", contributions: 5, withdrawals: 1 },
            ],
          },
        ],
      },
      null,
      profiles,
    );
    const series = mapped.series.find((item) => item.kind === "as" && item.key === "investment:1");
    assert.deepEqual(series?.flows, [
      { date: "2026-07-21", amount: 10, currency: "USD" },
      { date: "2026-08-20", amount: 4, currency: "USD" },
    ]);
    assert.equal(series?.points.reduce((sum, point) => sum + (point.value ?? 0), 0), 26);
  });

  it("mapPickleRickHoldings_underlyingLines_showOnTheDeepestLayerAndStayOutOfNav", () => {
    const mapped = mapPickleRickHoldings(
      {
        holdings: [
          row({
            key: "investment:1",
            account_number: "0433383",
            kind: "investment",
            name: "Trust Peresec",
            institution: "Peresec",
            currency: "USD",
            balance: 100,
            as_of: "2026-10-13",
            history: [
              { date: "2026-10-12", value: 80, currency: "USD", change: null, product: "perec-as" },
              { date: "2026-10-13", value: 100, currency: "USD", change: 20, product: "perec-as" },
            ],
          }),
          row({
            key: "investment:3",
            account_number: "0454918",
            kind: "investment",
            name: "Personal Peresec",
            institution: "Peresec",
            currency: "USD",
            balance: 50,
            as_of: "2026-10-13",
            history: [{ date: "2026-10-13", value: 50, currency: "USD", change: 5, product: "perec-as" }],
          }),
        ],
        history: [
          {
            key: "0433383|perec-weib",
            account_number: "0433383",
            product: "perec-weib",
            currency: "USD",
            history: [{ date: "2026-10-13", value: 7, currency: "USD", change: 1, product: "perec-weib" }],
          },
          {
            key: "0433383|perec-eib",
            account_number: "0433383",
            product: "perec-eib",
            currency: "USD",
            history: [{ date: "2026-10-13", value: 3, currency: "USD", change: null, product: "perec-eib" }],
          },
          {
            key: "0454918|perec-weib",
            account_number: "0454918",
            product: "perec-weib",
            currency: "USD",
            history: [{ date: "2026-10-13", value: 9, currency: "USD", change: 1, product: "perec-weib" }],
          },
          {
            key: "0454918|perec-eib",
            account_number: "0454918",
            product: "perec-eib",
            currency: "USD",
            history: [{ date: "2026-10-13", value: null, currency: "USD", change: null, product: "perec-eib" }],
          },
        ],
        peresec_underlying: [
          {
            as_of: "2026-10-21",
            layer: "eib",
            fund_code: "EIB 1",
            deeper_eib: "EIB 1",
            lines_available: true,
            currency: "USD",
            net_asset_value: 9,
            cash_total: null,
            rolls_up_into: "investment:1",
            sleeve: null,
            assets: [
              { name: "Sample equity", instrument_code: "EQ1", asset_class: "equity", currency: "USD", quantity: 12, market_price: 1, market_value: 4, zar_value: 4 },
              { name: "Unpriced note", instrument_code: "NOTE", asset_class: "other", currency: "USD", quantity: null, market_price: null, market_value: null, zar_value: null },
            ],
            cash: [{ name: "Sample cash", currency: "USD", quantity: 3, settled_balance: 3, accruals: null, market_value: 3, zar_value: 3 }],
          },
          {
            as_of: "2026-10-21",
            layer: "eib",
            fund_code: "EIB 2",
            deeper_eib: "EIB 2",
            lines_available: false,
            currency: "USD",
            net_asset_value: null,
            cash_total: "",
            rolls_up_into: "investment:3",
            sleeve: { name: "Parent wrapper", currency: "USD", quantity: 1, market_value: 6 },
            assets: [{ name: "Hidden equity", instrument_code: "HID", asset_class: "equity", currency: "USD", quantity: 4, market_value: 4 }],
            cash: [{ name: "Wrapper cash", currency: "USD", quantity: 8, settled_balance: 8, accruals: 0, market_value: 8, zar_value: 8 }],
          },
        ],
      },
      20,
      profiles,
    );

    const trust = mapped.positions.find((position) => position.linkId === "investment:1");
    const personal = mapped.positions.find((position) => position.linkId === "investment:3");
    assert.equal(trust?.qty, 100);
    assert.equal(personal?.qty, 50);
    assert.equal(mapped.positions.length, 2);
    const counted = mapped.positions
      .filter((position) => position.includeInTotal !== false && position.balanceKnown !== false)
      .reduce((sum, position) => sum + position.qty * (mapped.prices[position.asset] ?? 0), 0);
    assert.equal(counted, 150);

    const trustAs = mapped.series.find((item) => item.key === "investment:1");
    const personalAs = mapped.series.find((item) => item.key === "investment:3");
    assert.equal(trustAs?.points.some((point) => point.product === "perec-as" && point.value === 100), true);
    assert.equal(trustAs?.points.some((point) => point.product === "perec-weib" || point.product === "perec-eib"), false);
    assert.equal(trustAs?.underlying?.depth, "eib");
    assert.equal(trustAs?.underlying?.cashTotal, null);
    assert.equal(trustAs?.underlying?.lines.some((line) => line.name === "Sample equity" && line.quantity === 12), true);
    assert.equal(personalAs?.underlying?.depth, "unavailable");
    assert.equal(personalAs?.underlying?.netAssetValue, null);
    assert.equal(personalAs?.underlying?.cashTotal, null);
    assert.deepEqual(personalAs?.underlying?.lines, []);
    assert.equal(JSON.stringify(personalAs?.underlying).includes("Wrapper cash"), false);
    assert.equal(JSON.stringify(personalAs?.underlying).includes("Parent wrapper"), false);
    assert.equal(JSON.stringify(mapped.series).includes("Wrapper cash"), false);

    const trustEib = mapped.series.find((item) => item.accountNumber === "0433383" && item.kind === "eib");
    assert.equal(trustEib?.points.length, 1);
    assert.equal(trustEib?.points[0]?.value, 3);
    assert.equal(trustEib?.points[0]?.change, null);
    assert.equal(trustEib?.underlying, undefined);

    const trustLayers = investmentLayers(mapped.series, trust?.asset ?? "");
    const personalLayers = investmentLayers(mapped.series, personal?.asset ?? "");
    assert.equal(trustLayers?.name, "WEIB");
    assert.equal(trustLayers?.value, 7);
    assert.equal(trustLayers?.lines, undefined);
    assert.equal(trustLayers?.inside?.name, "EIB");
    assert.equal(trustLayers?.inside?.value, 3);
    assert.equal(trustLayers?.inside?.linesAvailable, true);
    assert.equal(trustLayers?.inside?.linesAsOf, "2026-10-21");
    assert.equal(trustLayers?.inside?.cashTotal, null);
    assert.equal(trustLayers?.inside?.lines?.find((line) => line.name === "Sample equity")?.quantity, 12);
    assert.equal(trustLayers?.inside?.lines?.find((line) => line.name === "Sample cash")?.quantity, 3);
    assert.equal(trustLayers?.inside?.lines?.find((line) => line.name === "Unpriced note")?.quantity, null);
    assert.equal(trustLayers?.inside?.lines?.find((line) => line.name === "Unpriced note")?.value, null);
    assert.equal(trustLayers?.inside?.lines?.some((line) => line.quantity === 0 || line.value === 0), false);
    assert.equal(personalLayers?.lines, undefined);
    assert.equal(personalLayers?.inside?.linesAvailable, false);
    assert.equal(personalLayers?.inside?.value, null);
    assert.equal(personalLayers?.inside?.netAssetValue, null);
    assert.equal(personalLayers?.inside?.cashTotal, null);
    assert.deepEqual(personalLayers?.inside?.lines, []);
    assert.equal(JSON.stringify(personalLayers).includes("Wrapper cash"), false);
    assert.equal(JSON.stringify(personalLayers).includes("Hidden equity"), false);

    const book: PriceBook = { close: () => 0, fx: () => 20, fxIsReference: () => false, hourly: () => [], daily: () => ({}) };
    const derived: Derived = {
      state: { ...state(mapped.positions, mapped.prices, [], profiles), statementSeries: mapped.series, asOf: Date.parse("2026-10-21T12:00:00+02:00") },
      points: [],
      ledger: null,
      events: [],
      linkContainer: new Map(),
      book,
      recon: null,
      series: null,
      reconciliation: [],
      containerTypes: new Map(),
    };
    const detail = buildAssetDetail(derived, trust?.asset ?? "");
    assert.equal(detail.asset.qty, 100);
    assert.equal(detail.asset.priorValue, 80);
    assert.equal(detail.inside?.inside?.lines?.some((line) => line.quantity === 12), true);
    assert.equal(detail.holdingHistory.some((point) => point.qty === 12 || point.qty === 3), false);
    assert.equal(detail.holdingHistory.some((point) => point.qty === 100), true);
    const merged = mergeStatementHistory([], { ...state(mapped.positions, mapped.prices, [], profiles), statementSeries: mapped.series });
    assert.equal(JSON.stringify(merged).includes("Sample equity"), false);
    assert.equal(JSON.stringify(merged).includes("Wrapper cash"), false);
  });

  it("mapPickleRickHoldings_weibDeepest_putsLinesOnWeibOnly", () => {
    const mapped = mapPickleRickHoldings(
      {
        holdings: [
          row({
            key: "investment:1",
            account_number: "0433383",
            kind: "investment",
            name: "Trust Peresec",
            institution: "Peresec",
            currency: "USD",
            balance: 40,
            as_of: "2026-10-13",
          }),
        ],
        history: [
          {
            key: "0433383|perec-weib",
            account_number: "0433383",
            product: "perec-weib",
            currency: "USD",
            history: [{ date: "2026-10-13", value: 4, currency: "USD", change: 1, product: "perec-weib" }],
          },
        ],
        peresec_underlying: [
          {
            as_of: "2026-10-21",
            layer: "weib",
            fund_code: "WEIB 1",
            deeper_eib: null,
            lines_available: true,
            currency: "USD",
            net_asset_value: null,
            cash_total: "",
            rolls_up_into: "investment:1",
            sleeve: null,
            assets: [{ name: "WEIB equity", instrument_code: "W1", asset_class: "equity", currency: "USD", quantity: 6, market_value: 5 }],
            cash: [{ name: "WEIB cash", currency: "USD", quantity: 2, market_value: 2 }],
          },
        ],
      },
      null,
      profiles,
    );
    const trust = mapped.positions.find((position) => position.linkId === "investment:1");
    assert.equal(trust?.qty, 40);
    const layers = investmentLayers(mapped.series, trust?.asset ?? "");
    assert.equal(layers?.kind, "weib");
    assert.equal(layers?.value, 4);
    assert.equal(layers?.netAssetValue, null);
    assert.equal(layers?.cashTotal, null);
    assert.equal(layers?.inside, null);
    assert.equal(layers?.lines?.find((line) => line.name === "WEIB equity")?.quantity, 6);
    assert.equal(layers?.lines?.find((line) => line.name === "WEIB cash")?.kind, "cash");
    assert.equal(mapped.series.find((item) => item.kind === "weib")?.points[0]?.value, 4);
    assert.equal(mapped.series.some((item) => item.kind === "eib"), false);
  });
});
