import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { AssetPosition, LedgerEventView, PortfolioAsset } from "@workspace/api-client-react";

import { fmtQty } from "../domain/format";
import { collapseRecurring, debtProfileLabel, describeHeldPosition, displayHoldingTitle, eventsByMonth, groupPlacesByProfile, holdingMovePct, holdingTitle, listHoldings, lunoUsdcZarMid, matchesQuery, owedWarningText, partitionDust, profileBlocks, profileDebts, sliceRange, sourcePlaces, statementDayPct, statementQuoteParts, unrealizedPct, usdcDebtAtLuno, usdcOwedLineText, usdcOwedSplit, whereLabel } from "./holdings";

const position = (partial: Partial<AssetPosition>): AssetPosition => ({
  exchange: "binance",
  linkId: "link-a",
  linkName: "Binance",
  containerId: "acct_personal",
  wallet: "spot",
  qty: 1,
  usd: 100,
  ...partial,
});

const asset = (partial: Partial<PortfolioAsset>): PortfolioAsset => ({
  asset: "BTC",
  qty: 0,
  usd: 0,
  priceUsd: 100,
  pct: 0,
  change24hPct: null,
  debtQty: 0,
  debtUsd: 0,
  costBasisUsd: null,
  unrealizedUsd: null,
  positions: [],
  ...partial,
});

const assets: PortfolioAsset[] = [
  asset({
    asset: "BTC",
    qty: 1.5,
    usd: 90_000,
    priceUsd: 60_000,
    positions: [
      position({ wallet: "collateral", qty: 1, usd: 60_000 }),
      position({ wallet: "spot", qty: 0.3, usd: 18_000 }),
      position({ exchange: "luno", linkId: "link-luno", wallet: "wallet", qty: 0.2, usd: 12_000 }),
    ],
  }),
  asset({
    asset: "USDT",
    qty: 2_000,
    usd: 2_000,
    priceUsd: 1,
    debtQty: 40_000,
    debtUsd: 40_000,
    positions: [position({ wallet: "earn", containerId: "acct_trust", linkId: "link-t", qty: 2_000, usd: 2_000 })],
  }),
  asset({ asset: "PEPE", qty: 10, usd: 0.4, priceUsd: 0.04, positions: [position({ qty: 10, usd: 0.4 })] }),
];

const labels = { profile: (id: string) => (id === "acct_trust" ? "Family Trust" : "Personal") };

describe("portfolio holdings", () => {
  it("listHoldings_sortsByValueAndKeepsEveryPlace", () => {
    const rows = listHoldings(assets, labels);
    assert.deepEqual(rows.map((row) => row.asset), ["BTC", "USDT", "PEPE"]);
    assert.equal(Math.round((rows[0]?.pctOfTotal ?? 0) * 10) / 10, 97.8);
    assert.equal(rows[1]?.debtUsd, 40_000);
    assert.equal(rows[1]?.debtQty, 40_000);
    assert.deepEqual(
      rows[0]?.places.map((place) => [place.exchange, place.wallet, place.profile]),
      [
        ["binance", "collateral", "Personal"],
        ["binance", "spot", "Personal"],
        ["luno", "wallet", "Personal"],
      ],
    );
    assert.deepEqual(rows[1]?.places.map((place) => [place.exchange, place.wallet, place.profile]), [["binance", "earn", "Family Trust"]]);
    assert.equal(rows[2]?.places.length, 1);
  });

  it("listHoldings_skipsLinesAlreadyInsideTheParentTotal", () => {
    const rows = listHoldings(
      [
        asset({
          asset: "Anchor / Peresec",
          qty: 2,
          usd: 20,
          priceUsd: 1,
          positions: [
            position({ exchange: "pickle_rick", linkId: "investment:1", linkName: "Anchor / Peresec", wallet: "Peresec", qty: 2, usd: 20 }),
            position({ exchange: "pickle_rick", linkId: "investment:9", linkName: "Inner fund", wallet: "Peresec", qty: 1, usd: 9, includeInTotal: false }),
          ],
        }),
      ],
      labels,
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.asset, "Anchor / Peresec");
    assert.equal(rows[0]?.places.length, 1);
    assert.equal(rows[0]?.places[0]?.usd, 20);
  });

  it("lunoUsdcZarMid_usesBidAskMidAndRejectsAMissingQuote", () => {
    assert.equal(lunoUsdcZarMid({ bid: 10, ask: 12, lastTrade: 99 }), 11);
    assert.equal(lunoUsdcZarMid({ bid: 0, ask: 12, lastTrade: 10 }), 10);
    assert.equal(lunoUsdcZarMid({ bid: 1, ask: 1, lastTrade: 10 }), null);
    assert.equal(lunoUsdcZarMid({ bid: 0, ask: 0, lastTrade: 0 }), null);
    assert.equal(lunoUsdcZarMid(null), null);
  });

  it("usdcDebtAtLuno_pricesUsdcQuantityAndLeavesOtherDebtsAlone", () => {
    const quote = { bid: 10, ask: 10, lastTrade: 10 };
    assert.deepEqual(usdcDebtAtLuno({ asset: "USDC", debtQty: 2 }, "ZAR", quote), { zar: 20, price: 10 });
    assert.equal(usdcDebtAtLuno({ asset: "USDT", debtQty: 2 }, "ZAR", quote), null);
    assert.equal(usdcDebtAtLuno({ asset: "USDC", debtQty: 2 }, "USD", quote), null);
    assert.equal(usdcDebtAtLuno({ asset: "USDC", debtQty: 2 }, "ZAR", null), null);
    assert.equal(usdcDebtAtLuno({ asset: "USDC", debtQty: 0 }, "ZAR", quote), null);
    assert.equal(owedWarningText({ asset: "USDC", debtQty: 2 }, "ZAR", quote, "fallback"), `Owed ${fmtQty(2, "USDC")} · R20 · Luno USDC R10,00`);
    assert.equal(owedWarningText({ asset: "USDC", debtQty: 2 }, "ZAR", null, "fallback"), `Owed ${fmtQty(2, "USDC")} · fallback`);
    assert.equal(owedWarningText({ asset: "USDT", debtQty: 2 }, "ZAR", quote, "fallback"), "Owed fallback");
  });

  it("usdcOwedSplit_putsPersonalBeforeTrustAndDropsChildren", () => {
    const quote = { bid: 10, ask: 10, lastTrade: 10 };
    const names = new Map([
      ["acct_personal", "Personal"],
      ["acct_trust", "WLDD"],
    ]);
    const nameFor = (id: string) => names.get(id) ?? "Profile";
    const personal = debtProfileLabel("acct_personal", "Personal", nameFor);
    const trust = debtProfileLabel("acct_trust", "Trust · WLDD", nameFor);
    const unnamedTrust = debtProfileLabel("missing", "Trust · WLDD", nameFor);
    assert.equal(personal, "Personal");
    assert.equal(trust, "WLDD");
    assert.equal(unnamedTrust, "WLDD");
    assert.equal(debtProfileLabel("child:laden", "Laden", nameFor), null);
    assert.equal(debtProfileLabel("acct_x", "Ivelle", nameFor), null);
    assert.equal(debtProfileLabel("child:greyson", "Side account", nameFor), null);

    const split = usdcOwedSplit(
      [
        { profile: trust, debtQty: 4, containerId: "acct_trust" },
        { profile: personal, debtQty: 1, containerId: "acct_personal" },
        { profile: personal, debtQty: 1, containerId: "acct_personal" },
        { profile: "Greyson", debtQty: 9, containerId: "child:greyson" },
        { profile: "Laden", debtQty: 8 },
      ],
      quote,
    );
    assert.deepEqual(
      split?.lines.map((line) => [line.profile, line.qtyLabel, line.amount]),
      [
        ["Personal", fmtQty(2, "USDC"), "R20"],
        ["WLDD", fmtQty(4, "USDC"), "R40"],
      ],
    );
    assert.equal(split?.lines.length, 2);
    assert.equal(split ? usdcOwedLineText(split.lines[0]!) : "", `Owed ${fmtQty(2, "USDC")} · R20 · Personal`);
    assert.equal(split?.priceLabel.startsWith("Luno USDC R"), true);
    assert.equal(profileDebts([{ profile: "Personal", debtQty: 2 }]).length, 1);
    assert.equal(usdcOwedSplit([{ profile: "Personal", debtQty: 2 }], null), null);
    assert.equal(usdcOwedSplit([{ profile: "Ivelle", debtQty: 2 }], quote), null);

    const blocks = profileBlocks(
      [
        { wallet: "wallet", profile: "WLDD" },
        { wallet: "wallet", profile: "Personal" },
      ],
      split?.lines,
    );
    assert.deepEqual(
      blocks.map((block) => ({
        profile: block.profile,
        wallets: block.places.map((place) => place.profile),
        owed: block.owed ? usdcOwedLineText(block.owed) : null,
      })),
      [
        { profile: "Personal", wallets: ["Personal"], owed: `Owed ${fmtQty(2, "USDC")} · R20 · Personal` },
        { profile: "WLDD", wallets: ["WLDD"], owed: `Owed ${fmtQty(4, "USDC")} · R40 · WLDD` },
      ],
    );
    assert.equal(blocks.some((block) => block.owed && usdcOwedLineText(block.owed).includes(split?.priceLabel ?? "Luno")), false);
  });

  it("partitionDust_keepsOwedAssets", () => {
    const rows = listHoldings([...assets, asset({ asset: "USDC", debtUsd: 5, debtQty: 5 })], labels);
    const { visible, dust } = partitionDust(rows);
    assert.deepEqual(dust.map((row) => row.asset), ["PEPE"]);
    assert.ok(visible.some((row) => row.asset === "USDC"));
  });

  it("displayHoldingTitle_dropsPeresecNoise", () => {
    assert.equal(displayHoldingTitle("Anchor Capital / Peresec Consolidated Portfolio (0433383)"), "Peresec Consolidated Portfolio");
    assert.equal(displayHoldingTitle("Peresec Prime Brokers — Structured Note (personal)"), "Peresec Prime Brokers — Structured Note");
    assert.equal(displayHoldingTitle("Peresec Prime Brokers — Structured Note (personal, 0454918)"), "Peresec Prime Brokers — Structured Note");
    assert.equal(displayHoldingTitle("Peresec Prime Brokers — Structured Note (personal,)"), "Peresec Prime Brokers — Structured Note");
    assert.equal(displayHoldingTitle("Peresec Prime Brokers — Structured Note acc 0454918"), "Peresec Prime Brokers — Structured Note");
    assert.equal(displayHoldingTitle("Peresec / Anchor Capital Asset Swap (Personal)"), "Peresec / Asset Swap");
    assert.equal(displayHoldingTitle("Binance"), "Binance");
    assert.equal(displayHoldingTitle("Luno"), "Luno");
    assert.equal(displayHoldingTitle("Ninety One"), "Ninety One");
    assert.equal(displayHoldingTitle("Interactive Brokers"), "Interactive Brokers");
    assert.equal(displayHoldingTitle("Laden"), "Laden");
    assert.equal(displayHoldingTitle("Ivelle"), "Ivelle");
    assert.equal(displayHoldingTitle("Greyson"), "Greyson");
  });

  it("groupPlacesByProfile_putsPersonalBeforeTrustAndKeepsWalletOrder", () => {
    const groups = groupPlacesByProfile([
      { wallet: "collateral", profile: "Personal" },
      { wallet: "collateral", profile: "WLDD" },
      { wallet: "spot", profile: "WLDD" },
      { wallet: "spot", profile: "Personal" },
    ]);
    assert.deepEqual(
      groups.map((group) => group.map((place) => [place.wallet, place.profile])),
      [
        [
          ["collateral", "Personal"],
          ["spot", "Personal"],
        ],
        [
          ["collateral", "WLDD"],
          ["spot", "WLDD"],
        ],
      ],
    );
    assert.equal(groupPlacesByProfile([{ wallet: "spot", profile: "Personal" }]).length, 1);
  });

  it("holdingTitle_shortensNinetyOneAndDropsPickleRickSource", () => {
    assert.equal(holdingTitle("Ninety One Retirement Annuity Fund — Elandre (545124/493768-INVRA) (545124-493768-INVRA)"), "RA");
    assert.equal(holdingTitle("Ninety One TFSA — Elandre (530491-TFSA) (545124-530491-TFSA)"), "TFSA");
    assert.equal(holdingTitle("Ninety One tfsa — Mr Landen George Fourie (742328-611506-TFSA)"), "TFSA");
    assert.equal(holdingTitle("Ninety One IP investment_portfolio — Mr Landen George Fourie (742328-751148-INVIB)"), "Investment Portfolio");
    assert.equal(holdingTitle("Ninety One Investment Platform tfsa — Miss Ivelle Fourie (796726-665314-TFSA)"), "TFSA");
    assert.equal(
      holdingTitle("Ivelle Fourie — Investment Portfolio (INVIB)", [{ exchange: "pickle_rick", wallet: "Ninety One Investment Platform" }]),
      "Investment Portfolio",
    );
    assert.equal(holdingTitle("Ninety One"), "Ninety One");
    assert.equal(
      holdingTitle("Ivelle Fourie — Investec Private Banking", [{ exchange: "pickle_rick", wallet: "Investec Private Banking" }]),
      "Ivelle Fourie — Investec Private Banking",
    );
    assert.equal(
      holdingTitle("Anchor Capital / Peresec Consolidated Portfolio (0433383)", [{ exchange: "pickle_rick", wallet: "Peresec" }]),
      "Peresec Consolidated Portfolio",
    );
    assert.equal(holdingTitle("Peresec Prime Brokers — Structured Note (personal, acc 0454918)"), "Peresec Prime Brokers — Structured Note");
    assert.deepEqual(sourcePlaces("Ninety One TFSA — Elandre", [{ exchange: "pickle_rick", wallet: "Ninety One" }]), []);
    assert.equal(sourcePlaces("Peresec Consolidated Portfolio", [{ exchange: "pickle_rick", wallet: "Peresec" }]).length, 1);
    assert.equal(whereLabel("pickle_rick", "Interactive Brokers", "Personal"), "Interactive Brokers · Personal");
    assert.equal(whereLabel("pickle_rick", "Peresec", "WLDD"), "Peresec · WLDD");
    assert.equal(whereLabel("pickle_rick", "Pickle Rick", "Personal"), "Personal");
    assert.equal(whereLabel("binance", "spot", "Personal"), "Binance · Spot · Personal");
    assert.equal(whereLabel("luno", "wallet", null), "Luno · Wallet");
  });

  it("statementDayPct_upWhenThePreviousPointIsLower_andHiddenWithoutOne", () => {
    const up = statementDayPct(100, 80);
    assert.equal(up, 25);
    assert.ok(up != null && up > 0);
    const down = statementDayPct(80, 100);
    assert.ok(down != null && down < 0);
    assert.equal(statementDayPct(100, null), null);
    assert.equal(statementDayPct(100, undefined), null);
    assert.equal(holdingMovePct({ qty: 100, change24hPct: 2.4, priorValue: 80 }), null);
    assert.equal(holdingMovePct({ qty: 100, change24hPct: null, priorValue: 80 }), 25);
    assert.equal(holdingMovePct({ qty: 100, change24hPct: null }), null);
    const rows = listHoldings([asset({ asset: "Peresec note", qty: 100, priorValue: 80 })], labels);
    assert.equal(rows[0]?.priorValue, 80);
    assert.equal(holdingMovePct(rows[0]!), 25);
  });

  it("statementQuoteParts_needsAPortalDay", () => {
    assert.equal(statementQuoteParts({ quoteDate: null, quoteCurrency: "USD", qty: 1, places: [{ balanceKnown: true }] }), null);
    const quote = statementQuoteParts({ quoteDate: "2026-10-13", quoteCurrency: "USD", qty: 1, places: [{ balanceKnown: true }] });
    assert.equal(quote?.date, "13 Oct 2026");
    assert.equal(quote?.amount.startsWith("$"), true);
  });

  it("matchesQuery_symbolOrName", () => {
    assert.equal(matchesQuery("BTC", "bit"), true);
    assert.equal(matchesQuery("ETH", "ether"), true);
    assert.equal(matchesQuery("ETH", "sol"), false);
    assert.equal(matchesQuery("ETH", "  "), true);
  });

  it("sliceRange_keepsOnePointBeforeTheRange", () => {
    const now = Date.parse("2026-10-11T10:00:00Z");
    const points = [40, 20, 10, 5, 1].map((days) => ({ t: new Date(now - days * 86_400_000).toISOString() }));
    assert.equal(sliceRange(points, "1W", now).length, 3);
    assert.equal(sliceRange(points, "1M", now).length, 5);
    assert.equal(sliceRange(points, "1Y", now).length, 5);
    assert.equal(sliceRange(points.slice(0, 2), "1W", now).length, 2);
  });

  it("unrealizedPct_nullWithoutBasis", () => {
    assert.equal(unrealizedPct({ costBasisUsd: 1_000, unrealizedUsd: 250 }), 25);
    assert.equal(unrealizedPct({ costBasisUsd: null, unrealizedUsd: null }), null);
    assert.equal(unrealizedPct({ costBasisUsd: 0, unrealizedUsd: 5 }), null);
  });

  it("eventsByMonth_johannesburgMonths", () => {
    const months = eventsByMonth([event("2026-10-01T08:00:00Z"), event("2026-09-30T22:30:00Z"), event("2026-09-30T21:00:00Z")]);
    assert.deepEqual(months.map((month) => month.events.length), [2, 1]);
  });

  it("collapseRecurring_mergesDailyRewardsAndInterestPerSide", () => {
    const rows = collapseRecurring([
      event("2026-10-03T03:00:00Z", { qty: 0.4, usd: 0.4 }),
      event("2026-10-03T04:00:00Z", { type: "interest", debt: true, qty: -3, usd: -3 }),
      event("2026-10-02T10:00:00Z", { type: "deposit", qty: 500, usd: 500 }),
      event("2026-10-02T03:00:00Z", { qty: 0.4, usd: 0.4 }),
      event("2026-10-01T03:00:00Z", { qty: 0.5, usd: null }),
      event("2026-10-01T04:00:00Z", { type: "interest", qty: 1, usd: 1 }),
    ]);
    assert.deepEqual(
      rows.map((row) => (row.kind === "summary" ? `${row.type}x${row.count}` : row.event.type)),
      ["incomex3", "interest", "deposit", "interest"],
    );
    const income = rows[0];
    assert.ok(income?.kind === "summary");
    assert.equal(Math.round(income.qty * 10) / 10, 1.3);
    assert.equal(income.usd, null);
    assert.equal(income.from, "2026-10-01T03:00:00Z");
  });

  it("describeHeldPosition_optionAndStock_renderAsTwoRowsInsideTheAccount", () => {
    const account = position({
      exchange: "pickle_rick",
      linkId: "ibkr:sample",
      linkName: "Interactive Brokers",
      wallet: "Interactive Brokers",
      qty: 100,
      usd: 100,
    });
    const stock = position({
      exchange: "pickle_rick",
      linkId: "ibkr:sample|pos:stk",
      linkName: "Interactive Brokers · 4 shares",
      wallet: "Interactive Brokers",
      qty: 20,
      usd: 20,
      includeInTotal: false,
    });
    const option = position({
      exchange: "pickle_rick",
      linkId: "ibkr:sample|pos:opt",
      linkName: "IBKR · 11 contracts · expires 30 October 2026",
      wallet: "Interactive Brokers",
      qty: 30,
      usd: 30,
      includeInTotal: false,
    });
    const lines = [account, option, stock].flatMap((item) => {
      const copy = describeHeldPosition(item, {
        instrument: item.linkName,
        profile: "Personal",
        where: "Interactive Brokers",
        hideSource: false,
        symbol: "Interactive Brokers",
      });
      return copy ? [{ ...copy, usd: item.usd }] : [];
    });
    const html = renderToStaticMarkup(
      createElement(
        "section",
        { "aria-labelledby": "asset-held-title" },
        createElement("h2", { id: "asset-held-title" }, "Where it's held"),
        createElement(
          "ul",
          null,
          lines.map((line) =>
            createElement(
              "li",
              { key: line.title },
              createElement("span", null, line.title),
              line.caption ? createElement("span", null, line.caption) : null,
            ),
          ),
        ),
      ),
    );
    assert.equal(lines.length, 2);
    assert.equal((html.match(/<li/g) ?? []).length, 2);
    assert.equal(html.includes("11 contracts"), true);
    assert.equal(html.includes("30 October"), true);
    assert.equal(html.includes("shares"), true);
    assert.equal(html.includes("Included in the total"), false);
    assert.equal(html.includes("Personal"), false);
    assert.equal(lines.some((line) => line.caption === "11 contracts · expires 30 October 2026"), true);
    assert.equal(lines.some((line) => line.caption === "4 shares" && line.title === "Interactive Brokers"), true);
    assert.equal(lines.every((line) => line.repeatAccountQuantity === false), true);
    const listedValue = lines.reduce((sum, line) => sum + line.usd, 0);
    assert.equal(listedValue === account.usd, false);
    assert.equal(account.usd, 100);

    const nested = describeHeldPosition(
      position({ exchange: "pickle_rick", linkId: "investment:9", linkName: "Inner fund", wallet: "Peresec", includeInTotal: false }),
      { instrument: "Inner fund", profile: "Personal", where: "Peresec", hideSource: false, symbol: "Peresec" },
    );
    assert.equal(nested?.caption.includes("Included in the total"), false);
    const binance = describeHeldPosition(position({ exchange: "binance", wallet: "spot", linkName: "Binance" }), {
      instrument: "Binance",
      profile: null,
      where: "Binance · Spot",
      hideSource: false,
      symbol: "BTC",
    });
    const luno = describeHeldPosition(position({ exchange: "luno", wallet: "wallet", linkName: "Luno" }), {
      instrument: "Luno",
      profile: null,
      where: "Luno · Wallet",
      hideSource: false,
      symbol: "BTC",
    });
    assert.equal(binance?.markOn, "title");
    assert.equal(luno?.markOn, "title");
  });
});

function event(t: string, partial: Partial<LedgerEventView> = {}): LedgerEventView {
  return {
    id: `${t}-${partial.type ?? "income"}`,
    t,
    type: "income",
    asset: "USDT",
    qty: 1,
    usd: 1,
    debt: false,
    exchange: "binance",
    linkId: "link-a",
    containerId: null,
    note: "",
    ...partial,
  };
}
