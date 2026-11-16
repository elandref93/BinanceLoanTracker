import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fmtDate, fmtDisplayMoney, fmtNum, fmtPct } from "../domain/format";
import { costIndicationClass, costVersusMarket, investmentBook, investmentPath, layerForStep, lookthroughColumnMasked, lookthroughColumns, lookthroughGroups, lookthroughLines, lookthroughSnapshotTotals, optionHealth, parseDrillStep, parseOptionContract, portalLineText, readInvestmentLayer, type CostVersusMarket, type InvestmentLayer, type LookthroughLine } from "./perecDrill";

function sampleLine(overrides: Partial<LookthroughLine> & Pick<LookthroughLine, "kind" | "name">): LookthroughLine {
  return {
    quantity: 1,
    value: 1,
    currency: "USD",
    costPrice: null,
    marketPrice: null,
    pnl: null,
    settledBalance: null,
    accruals: null,
    zarValue: null,
    zarExposure: null,
    expNav: null,
    ...overrides,
  };
}

function withSpot(option: LookthroughLine, ticker: string, spot: number): LookthroughLine[] {
  return [
    option,
    sampleLine({
      kind: "equity",
      name: `${ticker} US`,
      instrumentCode: ticker,
      quantity: 8,
      marketPrice: spot,
    }),
  ];
}

/** Percent, then the portal P&L when the portal sent one. Matches the chip beside market value. */
function renderedCostIndication(gap: CostVersusMarket): string {
  return gap.pnlText == null ? gap.label : `${gap.label} · ${gap.pnlText}`;
}

function assertCostIndication(gap: CostVersusMarket, percentText: string): string {
  const text = renderedCostIndication(gap);
  assert.equal(text.includes(percentText), true);
  assert.equal(/\babove\b/i.test(text), false);
  assert.equal(/\bbelow\b/i.test(text), false);
  return text;
}

const eib: InvestmentLayer = {
  kind: "eib",
  name: "EIB",
  value: null,
  currency: "USD",
  points: [{ date: "2026-10-13", value: null, currency: "USD", change: null, product: "perec-eib" }],
  inside: null,
};

const weib: InvestmentLayer = {
  kind: "weib",
  name: "WEIB",
  value: 4,
  currency: "USD",
  points: [{ date: "2026-10-13", value: 4, currency: "USD", change: 1, product: "perec-weib" }],
  inside: eib,
};

describe("perec drill", () => {
  it("readInvestmentLayer_keepsNullEibValue", () => {
    const layer = readInvestmentLayer(weib);
    assert.equal(layer?.name, "WEIB");
    assert.equal(layer?.inside?.value, null);
    assert.equal(layer?.inside?.points[0]?.value, null);
    assert.equal(layer?.inside?.points.some((point) => point.value === 0), false);
  });

  it("layerForStep_opensWeibThenEib", () => {
    assert.equal(parseDrillStep(null), "investment");
    assert.equal(layerForStep(weib, "investment").current, null);
    assert.equal(layerForStep(weib, "investment").next?.kind, "weib");
    assert.equal(layerForStep(weib, "weib").current?.name, "WEIB");
    assert.equal(layerForStep(weib, "weib").next?.name, "EIB");
    assert.equal(layerForStep(weib, "eib").current?.value, null);
    assert.equal(layerForStep(weib, "eib").next, null);
  });

  it("readInvestmentLayer_keepsLookthroughQuantitiesAndNullTotals", () => {
    const layer = readInvestmentLayer({
      ...eib,
      linesAvailable: true,
      linesAsOf: "2026-10-21",
      netAssetValue: null,
      cashTotal: "",
      lines: [
        { kind: "asset", name: "Sample equity", quantity: 12, value: 4, currency: "USD" },
        { kind: "cash", name: "Sample cash", quantity: null, value: null, currency: "USD" },
      ],
    });
    assert.equal(layer?.value, null);
    assert.equal(layer?.netAssetValue, null);
    assert.equal(layer?.cashTotal, null);
    assert.equal(layer?.lines?.[0]?.quantity, 12);
    assert.equal(layer?.lines?.[1]?.quantity, null);
    assert.equal(layer?.lines?.[1]?.value, null);
    assert.equal(layer?.lines?.some((line) => line.quantity === 0 || line.value === 0), false);
    const shown = layer ? lookthroughLines(layer) : null;
    assert.notEqual(shown, "unavailable");
    assert.equal(shown && shown !== "unavailable" ? shown.assets.length : 0, 1);
    assert.equal(shown && shown !== "unavailable" ? shown.cash[0]?.quantity : 0, null);
  });

  it("lookthroughLines_unavailable_hidesCash", () => {
    const layer = readInvestmentLayer({
      ...weib,
      inside: {
        ...eib,
        linesAvailable: false,
        netAssetValue: null,
        cashTotal: null,
        lines: [{ kind: "cash", name: "Wrapper cash", quantity: 8, value: 8, currency: "USD" }],
      },
    });
    assert.equal(layer?.lines, undefined);
    assert.equal(layer?.inside?.linesAvailable, false);
    assert.deepEqual(layer?.inside?.lines, []);
    assert.equal(layer?.inside?.netAssetValue, null);
    assert.equal(layer?.inside?.cashTotal, null);
    assert.equal(layer?.inside ? lookthroughLines(layer.inside) : null, "unavailable");
    assert.equal(JSON.stringify(layer?.inside).includes("Wrapper cash"), false);
  });

  it("lookthroughGroups_keepsEquityDerivativeAndOtherClasses", () => {
    const layer = readInvestmentLayer({
      ...eib,
      linesAvailable: true,
      linesAsOf: "2026-11-16",
      lines: [
        { kind: "asset", name: "Hedge line", assetClass: "Hedge Fund", quantity: 1, value: 1, currency: "USD" },
        { kind: "asset", name: "Etp line", asset_class: "ETP", quantity: 2, value: 2, currency: "USD" },
        { kind: "asset", name: "Option line", assetClass: "Equity Option", quantity: 1, value: 1, currency: "USD" },
        { kind: "asset", name: "Share line", assetClass: "equities", quantity: 4, value: 4, currency: "USD" },
        { kind: "asset", name: "Plain line", quantity: 5, value: 5, currency: "USD" },
        { kind: "cash", name: "Cash line", quantity: null, value: 3, currency: "USD" },
      ],
    });
    const shown = layer ? lookthroughLines(layer) : null;
    assert.notEqual(shown, "unavailable");
    assert.notEqual(shown, null);
    if (!shown || shown === "unavailable") return;
    const groups = lookthroughGroups(shown);
    assert.deepEqual(
      groups.map((group) => group.title),
      ["Equities", "Derivatives", "Assets", "Cash"],
    );
    assert.deepEqual(
      groups.find((group) => group.title === "Equities")?.lines.map((line) => line.name),
      ["Hedge line", "Etp line", "Share line"],
    );
    assert.equal(groups.find((group) => group.title === "Derivatives")?.lines[0]?.assetClass, "Equity Option");
    assert.equal(groups.find((group) => group.title === "Assets")?.lines[0]?.assetClass, undefined);
    assert.equal(groups.find((group) => group.title === "Cash")?.lines[0]?.quantity, null);
    assert.equal(groups.some((group) => group.title === "Hedge Fund" || group.title === "ETP" || group.title === "Equity Option"), false);
  });

  it("lookthroughGroups_portalTables_skipAssetsAndEmptyDerivatives", () => {
    const layer = readInvestmentLayer({
      ...weib,
      inside: null,
      linesAvailable: true,
      linesAsOf: "2026-11-16",
      lines: [
        { kind: "equity", name: "Hedge line", assetClass: "Hedge Fund", quantity: 1, value: 1, currency: "USD" },
        { kind: "equity", name: "Sleeve line", assetClass: "Equity", quantity: 2, value: 2, currency: "USD", costPrice: null },
        { kind: "asset", name: "Duplicate sleeve", assetClass: "Equity", quantity: 9, value: 9, currency: "USD" },
        { kind: "cash", name: "USD cash", quantity: -1, value: -1, currency: "USD", settledBalance: -1, accruals: null, expNav: -1 },
      ],
    });
    const shown = layer ? lookthroughLines(layer) : null;
    assert.notEqual(shown, "unavailable");
    assert.notEqual(shown, null);
    if (!shown || shown === "unavailable") return;
    const groups = lookthroughGroups(shown);
    assert.deepEqual(
      groups.map((group) => group.title),
      ["Equities", "Cash"],
    );
    assert.equal(groups.some((group) => group.title === "Derivatives"), false);
    assert.equal(JSON.stringify(groups).includes("Duplicate sleeve"), false);
    const sleeve = groups[0]?.lines.find((line) => line.name === "Sleeve line");
    assert.equal(sleeve?.costPrice, null);
    assert.notEqual(sleeve?.costPrice, 0);
    const cash = groups[1]?.lines[0];
    assert.equal(cash?.quantity, -1);
    assert.equal(cash ? portalLineText(cash, "settledBalance") : null, fmtDisplayMoney(-1, "USD"));
    assert.equal(cash ? portalLineText(cash, "accruals") : "present", null);
    assert.equal(cash ? portalLineText(cash, "expNav") : null, fmtPct(-1, 2));
    assert.equal(groups[1] ? lookthroughColumns(groups[1]).includes("accruals") : true, false);
    assert.equal(sleeve ? portalLineText(sleeve, "quantity") : null, fmtNum(2, 0));
    assert.equal(sleeve ? portalLineText(sleeve, "costPrice") : "present", null);
  });

  it("portalLineText_keepsNegativeQuantityAndOmitsMissingCost", () => {
    const layer = readInvestmentLayer({
      ...eib,
      linesAvailable: true,
      lines: [
        {
          kind: "derivative",
          name: "Short option",
          assetClass: "Equity Option",
          quantity: -2,
          value: -1,
          currency: "USD",
          pnl: -1,
          expNav: 1,
        },
      ],
    });
    const line = layer?.lines?.[0];
    assert.equal(line?.quantity, -2);
    assert.equal(line?.costPrice, null);
    assert.notEqual(line?.costPrice, 0);
    assert.equal(line ? portalLineText(line, "quantity") : null, fmtNum(-2, 0));
    assert.equal(line ? portalLineText(line, "costPrice") : "present", null);
    assert.equal(line ? portalLineText(line, "pnl") : null, fmtDisplayMoney(-1, "USD"));
    assert.equal(line ? portalLineText(line, "expNav") : null, fmtPct(1, 2));
    assert.equal(lookthroughColumnMasked("quantity"), true);
    assert.equal(lookthroughColumnMasked("pnl"), true);
    assert.equal(lookthroughColumnMasked("expNav"), false);
    assert.equal(lookthroughColumnMasked("name"), false);
    const shown = layer ? lookthroughLines(layer) : null;
    if (!shown || shown === "unavailable") return;
    const columns = lookthroughColumns(lookthroughGroups(shown)[0] ?? { title: "Derivatives", lines: [] });
    assert.equal(columns.includes("costPrice"), false);
    assert.equal(columns.includes("expNav"), true);
  });

  it("investmentBook_trustPageUsesEibTablesAndLeavesParentAssetsOff", () => {
    const root = readInvestmentLayer({
      kind: "weib",
      name: "WEIB",
      value: 7,
      currency: "USD",
      points: [{ date: "2026-11-16", value: 7, currency: "USD", change: 1, product: "perec-weib" }],
      assets: [{ kind: "asset", name: "Parent asset", quantity: 9, value: 9, currency: "USD" }],
      inside: {
        kind: "eib",
        name: "EIB",
        value: 3,
        currency: "USD",
        points: [{ date: "2026-11-16", value: 3, currency: "USD", change: null, product: "perec-eib" }],
        linesAvailable: true,
        linesAsOf: "2026-11-16",
        lines: [
          { kind: "equity", name: "Hedge line", assetClass: "Hedge Fund", quantity: 1, value: 1, currency: "USD" },
          { kind: "equity", name: "Etp line", assetClass: "ETP", quantity: 2, value: 2, currency: "USD" },
          { kind: "derivative", name: "Short option", assetClass: "Equity Option", quantity: -2, value: -1, currency: "USD" },
          { kind: "asset", name: "Duplicate asset", quantity: 9, value: 9, currency: "USD" },
          { kind: "cash", name: "Cash line", quantity: null, value: 3, currency: "USD" },
        ],
      },
    });
    assert.equal(root?.kind, "weib");
    assert.equal(root?.lines, undefined);
    assert.equal(root != null && Object.hasOwn(root, "assets"), false);
    const book = investmentBook(root);
    assert.equal(book?.kind, "eib");
    assert.notEqual(book, root);
    assert.equal(root?.lines, undefined);
    assert.equal(root != null && Object.hasOwn(root, "assets"), false);
    const shown = book ? lookthroughLines(book) : null;
    assert.notEqual(shown, null);
    assert.notEqual(shown, "unavailable");
    if (!shown || shown === "unavailable") return;
    const groups = lookthroughGroups(shown);
    assert.deepEqual(
      groups.map((group) => group.title),
      ["Equities", "Derivatives", "Cash"],
    );
    assert.equal(JSON.stringify(groups).includes("Duplicate asset"), false);
    assert.equal(JSON.stringify(groups).includes("Parent asset"), false);
    assert.equal(groups.find((group) => group.title === "Derivatives")?.lines[0]?.quantity, -2);
  });

  it("investmentBook_personalPageUsesWeibLinesWithoutChildEib", () => {
    const root = readInvestmentLayer({
      kind: "weib",
      name: "WEIB",
      value: 6,
      currency: "USD",
      points: [{ date: "2026-11-16", value: 6, currency: "USD", change: 1, product: "perec-weib" }],
      inside: null,
      linesAvailable: true,
      linesAsOf: "2026-11-16",
      assets: [{ kind: "asset", name: "Not a child", quantity: 9, value: 9, currency: "USD" }],
      lines: [
        { kind: "equity", name: "Sleeve line", assetClass: "Equity", quantity: 2, value: 2, currency: "USD", costPrice: null },
        { kind: "asset", name: "Duplicate sleeve", assetClass: "Equity", quantity: 9, value: 9, currency: "USD" },
        { kind: "cash", name: "USD cash", quantity: -1, value: -1, currency: "USD", settledBalance: -1 },
      ],
    });
    assert.equal(root?.inside, null);
    assert.equal(root != null && Object.hasOwn(root, "assets"), false);
    const book = investmentBook(root);
    assert.equal(book?.kind, "weib");
    assert.equal(book, root);
    assert.equal(book?.inside, null);
    const shown = book ? lookthroughLines(book) : null;
    assert.notEqual(shown, null);
    assert.notEqual(shown, "unavailable");
    if (!shown || shown === "unavailable") return;
    const groups = lookthroughGroups(shown);
    assert.deepEqual(
      groups.map((group) => group.title),
      ["Equities", "Cash"],
    );
    assert.equal(groups.some((group) => group.title === "Derivatives"), false);
    assert.equal(JSON.stringify(groups).includes("Duplicate sleeve"), false);
    assert.equal(JSON.stringify(groups).includes("Not a child"), false);
    assert.equal(groups[0]?.lines[0]?.name, "Sleeve line");
    assert.equal(groups[1]?.lines[0]?.quantity, -1);
    assert.equal(book?.lines?.some((line) => line.name === "Not a child"), false);
    assert.equal(book?.inside, null);
  });

  it("lookthroughSnapshotTotals_keepsABookVisibleWithoutDailyPoints", () => {
    const root = readInvestmentLayer({
      kind: "weib",
      name: "WEIB",
      value: null,
      currency: "USD",
      points: [],
      inside: null,
      linesAvailable: true,
      linesAsOf: "2026-11-16",
      netAssetValue: 4,
      cashTotal: 1,
      lines: [
        { kind: "equity", name: "Sleeve line", assetClass: "Equity", quantity: 2, value: 2, currency: "USD" },
        { kind: "cash", name: "USD cash", quantity: 1, value: 1, currency: "USD" },
      ],
    });
    assert.equal(root?.value, null);
    assert.equal(root?.points.length, 0);
    const book = investmentBook(root);
    assert.equal(book?.kind, "weib");
    assert.equal(book, root);
    assert.equal(book?.inside, null);
    const totals = book ? lookthroughSnapshotTotals(book) : [];
    assert.deepEqual(
      totals.map((row) => row.label),
      ["Net asset value", "Cash total"],
    );
    assert.equal(totals[0]?.value, 4);
    assert.equal(totals[1]?.value, 1);
    assert.equal(totals[0]?.asOf, "2026-11-16");
    const shown = book ? lookthroughLines(book) : null;
    assert.notEqual(shown, null);
    assert.notEqual(shown, "unavailable");
    if (!shown || shown === "unavailable") return;
    assert.equal(lookthroughGroups(shown).some((group) => group.title === "Derivatives"), false);
    const blank = readInvestmentLayer({
      kind: "eib",
      name: "EIB",
      value: null,
      currency: "USD",
      points: [],
      inside: null,
      netAssetValue: 4,
      cashTotal: 1,
    });
    assert.equal(blank ? lookthroughSnapshotTotals(blank).length : 1, 0);
    assert.equal(investmentBook(blank), null);
  });

  it("investmentPath_encodesTheNameAndAddsTheLayer", () => {
    assert.equal(investmentPath("Anchor / Peresec"), "/portfolio/Anchor%20%2F%20Peresec");
    assert.equal(investmentPath("Anchor / Peresec", "weib"), "/portfolio/Anchor%20%2F%20Peresec?inside=weib");
    assert.equal(investmentPath("Anchor / Peresec", "eib"), "/portfolio/Anchor%20%2F%20Peresec?inside=eib");
  });

  it("costVersusMarket_percentOnlyLongGreenOrRedAndShortUsesPremium", () => {
    const above = costVersusMarket(
      sampleLine({
        kind: "equity",
        name: "Long ahead",
        quantity: 4,
        costPrice: 1000,
        marketPrice: 1042,
        pnl: 3,
      }),
    );
    assert.ok(above);
    assert.equal(above.favourable, true);
    assert.equal(costIndicationClass(above.favourable), "text-gain");
    assert.equal(above.percentText, "4,2%");
    assert.equal(above.pnlText, fmtDisplayMoney(3, "USD"));
    assertCostIndication(above, "4,2%");

    const below = costVersusMarket(
      sampleLine({
        kind: "equity",
        name: "Long behind",
        quantity: 2,
        costPrice: 1000,
        marketPrice: 591,
      }),
    );
    assert.ok(below);
    assert.equal(below.favourable, false);
    assert.equal(costIndicationClass(below.favourable), "text-loss");
    assert.equal(below.percentText, "40,9%");
    assert.equal(below.pnlText, null);
    assertCostIndication(below, "40,9%");

    const aheadShort = costVersusMarket(
      sampleLine({
        kind: "derivative",
        name: "Short ahead",
        quantity: -3,
        costPrice: 80,
        marketPrice: 100,
        value: -300,
        pnl: 2,
      }),
    );
    assert.ok(aheadShort);
    assert.equal(aheadShort.favourable, true);
    assert.equal(costIndicationClass(aheadShort.favourable), "text-gain");
    assert.equal(aheadShort.percentText, fmtPct((2 / (3 * 80)) * 100, 1));
    assert.equal(aheadShort.pnlText, fmtDisplayMoney(2, "USD"));
    assert.notEqual(aheadShort.percentText, fmtPct(((100 - 80) / 80) * 100, 1));
    const aheadText = assertCostIndication(aheadShort, aheadShort.percentText);
    assert.equal(aheadText.includes(fmtDisplayMoney(2, "USD")), true);
    assert.equal(aheadText.includes(fmtDisplayMoney(-300, "USD")), false);

    const flatShort = costVersusMarket(
      sampleLine({
        kind: "derivative",
        name: "Short flat",
        quantity: -2,
        costPrice: 10,
        marketPrice: 10,
        pnl: 0,
      }),
    );
    assert.equal(flatShort?.favourable, true);
    assert.equal(flatShort ? costIndicationClass(flatShort.favourable) : null, "text-gain");
    assert.equal(flatShort?.percentText, "0,0%");

    assert.equal(costVersusMarket(sampleLine({ kind: "equity", name: "No cost", marketPrice: 10 })), null);
    assert.equal(costVersusMarket(sampleLine({ kind: "equity", name: "No market", costPrice: 10 })), null);
    assert.equal(costVersusMarket(sampleLine({ kind: "equity", name: "Zero cost", costPrice: 0, marketPrice: 10 })), null);
    assert.equal(
      costVersusMarket(sampleLine({ kind: "derivative", name: "Short no pnl", quantity: -1, costPrice: 10, marketPrice: 8, value: -8 })),
      null,
    );
    assert.equal(costVersusMarket(sampleLine({ kind: "cash", name: "Cash", quantity: null, costPrice: 9, marketPrice: 9 })), null);

    const cash = readInvestmentLayer({
      ...eib,
      linesAvailable: true,
      lines: [{ kind: "cash", name: "USD", quantity: null, value: 1, currency: "USD", cost_price: 5, market_price: 5 }],
    });
    assert.equal(cash?.lines?.[0]?.costPrice, null);
    assert.equal(cash?.lines?.[0]?.marketPrice, null);
    assert.equal(cash?.lines?.[0] ? costVersusMarket(cash.lines[0]) : "missing", null);
  });

  it("costVersusMarket_soldPutShowsPremiumGivenBackNotMarketValue", () => {
    const quantity = -50;
    const costPrice = 225;
    const marketPrice = 238;
    const pnl = -156;
    const marketValue = quantity * marketPrice;
    const premium = Math.abs(quantity) * costPrice;
    const sold = sampleLine({
      kind: "derivative",
      name: "Sold put",
      instrumentCode: "QM US 06/15/27 P25",
      quantity,
      costPrice,
      marketPrice,
      value: marketValue,
      pnl,
    });
    const gap = costVersusMarket(sold);
    assert.ok(gap);
    assert.equal(gap.favourable, false);
    assert.equal(costIndicationClass(gap.favourable), "text-loss");
    const percentText = fmtPct((Math.abs(pnl) / premium) * 100, 1);
    assert.equal(gap.percentText, percentText);
    assert.notEqual(percentText, fmtPct((Math.abs(marketPrice - costPrice) / costPrice) * 100, 1));
    assert.notEqual(percentText, fmtPct((Math.abs(pnl) / Math.abs(marketValue)) * 100, 1));
    assert.equal(gap.pnlText, fmtDisplayMoney(pnl, "USD"));
    const text = assertCostIndication(gap, percentText);
    assert.equal(text.includes(fmtDisplayMoney(pnl, "USD")), true);
    assert.equal(text.includes(fmtDisplayMoney(marketValue, "USD")), false);
    assert.equal(text.includes(fmtDisplayMoney(Math.abs(marketValue), "USD")), false);
    const health = optionHealth(sold, withSpot(sold, "QM", 30), new Date("2026-11-16T12:00:00+02:00"));
    assert.equal(health?.position, "sold");
    assert.equal(health?.summary.includes("Put sold"), true);
    assert.equal(text.includes("Put sold"), false);
    assert.equal(text.includes("strike"), false);
  });

  it("parseOptionContract_readsPutAndCallAndLeavesOtherDerivatives", () => {
    const put = parseOptionContract(
      sampleLine({
        kind: "derivative",
        name: "Sleeve note",
        instrumentCode: "QM US 06/15/27 P25",
        quantity: -2,
      }),
    );
    assert.equal(put?.ticker, "QM");
    assert.equal(put?.right, "put");
    assert.equal(put?.strike, 25);
    assert.equal(put?.expiryText, fmtDate("2027-06-15T12:00:00+02:00"));

    const call = parseOptionContract(
      sampleLine({
        kind: "derivative",
        name: "BETA US 01/02/28 C10.5 (OPT)",
        quantity: 3,
      }),
    );
    assert.equal(call?.ticker, "BETA");
    assert.equal(call?.right, "call");
    assert.equal(call?.strike, 10.5);
    assert.equal(call?.expiryText, fmtDate("2028-01-02T12:00:00+02:00"));

    const plain = sampleLine({
      kind: "derivative",
      name: "Index future",
      instrumentCode: "FUT1",
      quantity: -1,
      costPrice: 10,
      marketPrice: 8,
      value: -8,
      pnl: 2,
    });
    assert.equal(parseOptionContract(plain), null);
    assert.equal(optionHealth(plain, [plain], new Date("2026-11-16T12:00:00+02:00")), null);
    const plainGap = costVersusMarket(plain);
    assert.ok(plainGap);
    assert.equal(plainGap.favourable, true);
    assert.equal(costIndicationClass(plainGap.favourable), "text-gain");
    assert.equal(plainGap.percentText, fmtPct((2 / 10) * 100, 1));
    assert.equal(plainGap.pnlText, fmtDisplayMoney(2, "USD"));
    assertCostIndication(plainGap, plainGap.percentText);
  });

  it("optionHealth_soldPutSpotAboveIsHealthyAndSpotBelowIsAtRisk", () => {
    const now = new Date("2026-11-16T12:00:00+02:00");
    const sold = sampleLine({
      kind: "derivative",
      name: "QM US 06/15/27 P25 (OPT)",
      instrumentCode: "QM US 06/15/27 P25",
      assetClass: "Equity Option",
      quantity: -2,
      marketPrice: 1,
      costPrice: 2,
    });
    const days = Math.round((Date.UTC(2027, 5, 15) - Date.UTC(2026, 10, 16)) / 86_400_000);
    const healthy = optionHealth(sold, withSpot(sold, "QM", 30), now);
    assert.equal(healthy?.position, "sold");
    assert.equal(healthy?.health, "healthy");
    assert.equal(healthy?.moneyness, "out of the money");
    assert.equal(healthy?.daysLeft, days);
    assert.equal(healthy?.cushionText, "spot 20,0% above strike");
    assert.equal(healthy?.summary.includes("Put sold"), true);
    assert.equal(healthy?.summary.includes("strike 25"), true);
    assert.equal(healthy?.summary.includes(`${days} days`), true);
    assert.equal(healthy?.summary.includes("out of the money"), true);
    assert.equal(healthy?.summary.endsWith(" · healthy"), true);

    const risk = optionHealth(sold, withSpot(sold, "QM", 20), now);
    assert.equal(risk?.health, "at risk");
    assert.equal(risk?.moneyness, "in the money");
    assert.equal(risk?.cushionText, "spot 20,0% below strike");
    assert.equal(risk?.summary.endsWith(" · at risk"), true);

    const near = optionHealth(sold, withSpot(sold, "QM", 25.5), now);
    assert.equal(near?.moneyness, "near");
    assert.equal(near?.health, "watch");
    assert.equal(near?.cushionText, "spot 2,0% above strike");
  });

  it("optionHealth_missingSpotSkipsMoneynessAndExpiredSaysExpired", () => {
    const now = new Date("2026-11-16T12:00:00+02:00");
    const open = sampleLine({
      kind: "derivative",
      name: "QM US 06/15/27 P25",
      quantity: -1,
    });
    const missing = optionHealth(open, [open], now);
    assert.equal(missing?.spot, null);
    assert.equal(missing?.moneyness, null);
    assert.equal(missing?.health, null);
    assert.equal(missing?.cushionText, null);
    assert.equal(missing?.summary.includes("spot is not in this book"), true);
    assert.equal(missing?.summary.includes("money"), false);
    assert.equal(missing?.summary.includes("near"), false);
    assert.equal(missing?.summary.includes("healthy"), false);

    const expiredLine = sampleLine({
      kind: "derivative",
      name: "QM US 01/10/26 P25",
      quantity: -1,
    });
    const expired = optionHealth(expiredLine, withSpot(expiredLine, "QM", 30), now);
    assert.equal(expired?.expired, true);
    assert.equal(expired?.daysLeft != null && expired.daysLeft < 0, true);
    assert.equal(expired?.summary.includes("expired"), true);
    assert.equal(expired?.summary.includes("days"), false);

    const bought = sampleLine({
      kind: "derivative",
      name: "BETA US 01/02/28 C10.5 (OPT)",
      quantity: 4,
    });
    const call = optionHealth(
      bought,
      [
        bought,
        sampleLine({
          kind: "equity",
          name: "BETA",
          instrumentCode: "BETA",
          marketPrice: 8,
        }),
      ],
      now,
    );
    assert.equal(call?.position, "bought");
    assert.equal(call?.summary.startsWith("Call bought"), true);
    assert.equal(call?.moneyness, "out of the money");
    assert.equal(call?.health, "at risk");
  });
});
