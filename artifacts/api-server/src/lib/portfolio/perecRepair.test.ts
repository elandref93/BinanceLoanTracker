import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deriveFrom } from "./derived";
import type { PriceBook } from "./prices";
import { repairPeresecHistory } from "./perecRepair";
import { jhbDayStart } from "./time";
import type { HistoryPoint, PortfolioState, StatementSeries } from "./types";
import { buildPerformance } from "./views";

const TRUST = "Anchor Capital / Peresec Consolidated Portfolio (0433383)";
const TRUST_ALIAS = "Anchor Capital / Peresec Consolidated Portfolio";
const PERSONAL = "Peresec Prime Brokers — Structured Note (personal, acc 0454918)";
const PERSONAL_ALIAS = "Peresec / Anchor Capital Asset Swap (Personal)";
const NINETY = "Ninety One TFSA";

function series(partial: Partial<StatementSeries> & Pick<StatementSeries, "key" | "accountNumber" | "asset">, points: Array<{ date: string; value: number | null }>): StatementSeries {
  return {
    kind: "as",
    product: "perec-as",
    containerId: null,
    currency: "USD",
    points: points.map((point) => ({ date: point.date, value: point.value, currency: "USD", change: null, product: "perec-as" })),
    ...partial,
  };
}

function bothSeries(trust = 10, personal = 4, day = "2026-10-12"): StatementSeries[] {
  return [
    series({ key: "investment:1", accountNumber: "0433383", asset: TRUST }, [{ date: day, value: trust }]),
    series({ key: "investment:3", accountNumber: "0454918", asset: PERSONAL }, [{ date: day, value: personal }]),
  ];
}

function point(holdings: Record<string, number>, extras: Partial<HistoryPoint> = {}): HistoryPoint {
  let assets = 0;
  const prices: Record<string, number> = { BTC: 10, [NINETY]: 1 };
  for (const [asset, qty] of Object.entries(holdings)) {
    const px = asset === "BTC" ? 10 : 1;
    prices[asset] = px;
    if (qty > 0) assets += qty * px;
  }
  return {
    t: jhbDayStart("2026-10-12") + 12 * 60 * 60 * 1000,
    a: assets,
    d: 0,
    h: { none: { ...holdings } },
    c: { none: [assets, 0] },
    p: prices,
    fx: 20,
    ...extras,
  };
}

function qty(point: HistoryPoint, asset: string): number {
  let total = 0;
  for (const bucket of Object.values(point.h)) total += bucket[asset] ?? 0;
  return total;
}

describe("peresec snapshot repair", () => {
  it("repairPeresecHistory_missingLines_usesStatementValue", () => {
    const original = point({ BTC: 2, [NINETY]: 3 });
    const result = repairPeresecHistory([original], bothSeries());
    const repaired = result.points[0];
    assert.deepEqual(result.days, ["2026-10-12"]);
    assert.equal(qty(repaired!, "BTC"), 2);
    assert.equal(qty(repaired!, NINETY), 3);
    assert.equal(qty(repaired!, TRUST), 10);
    assert.equal(qty(repaired!, PERSONAL), 4);
    assert.equal(repaired?.a, 2 * 10 + 3 + 10 + 4);
  });

  it("repairPeresecHistory_negativeQuantity_usesStatementNotDebt", () => {
    const original = point({ BTC: 2, [TRUST]: -8, [PERSONAL]: 4 });
    const result = repairPeresecHistory([original], bothSeries());
    const repaired = result.points[0];
    assert.equal(qty(repaired!, TRUST), 10);
    assert.equal(qty(repaired!, PERSONAL), 4);
    assert.equal(repaired?.d, 0);
    assert.equal(repaired?.a, 20 + 10 + 4);
  });

  it("repairPeresecHistory_grossUnderRecord_usesStatementValue", () => {
    const original = point({ BTC: 2, [TRUST]: 10, [PERSONAL]: 1 });
    const result = repairPeresecHistory([original], bothSeries(10, 10));
    const repaired = result.points[0];
    assert.equal(qty(repaired!, PERSONAL), 10);
    assert.equal(qty(repaired!, TRUST), 10);
    assert.equal(qty(repaired!, "BTC"), 2);
  });

  it("repairPeresecHistory_unpricedMatchingQuantity_isLeftAlone", () => {
    const original = point({ BTC: 2, [TRUST]: 10, [PERSONAL]: 4 });
    delete original.p[TRUST];
    delete original.p[PERSONAL];
    const result = repairPeresecHistory([original], bothSeries());
    assert.equal(result.points[0], original);
    assert.equal(result.points[0]?.a, 2 * 10 + 10 + 4);
  });

  it("repairPeresecHistory_nearStatement_keepsSnapshotQuantity", () => {
    const original = point({ BTC: 2, [TRUST]: 8, [PERSONAL]: 4 });
    const result = repairPeresecHistory([original], bothSeries(10, 4));
    assert.equal(result.points[0], original);
    assert.deepEqual(result.days, []);
  });

  it("repairPeresecHistory_duplicateLabels_countsEachAccountOnce", () => {
    const original = point({
      BTC: 2,
      [TRUST]: 10,
      [TRUST_ALIAS]: 10,
      [PERSONAL]: 4,
      [PERSONAL_ALIAS]: 4,
    });
    const result = repairPeresecHistory([original], bothSeries());
    const repaired = result.points[0];
    assert.equal(qty(repaired!, TRUST), 10);
    assert.equal(qty(repaired!, TRUST_ALIAS), 0);
    assert.equal(qty(repaired!, PERSONAL), 4);
    assert.equal(qty(repaired!, PERSONAL_ALIAS), 0);
    assert.equal(qty(repaired!, "BTC"), 2);
    assert.equal(repaired?.a, 2 * 10 + 10 + 4);
  });

  it("repairPeresecHistory_noSeriesPoint_doesNotInvent", () => {
    const original = point({ BTC: 2 });
    const result = repairPeresecHistory([original], bothSeries(10, 4, "2026-10-13"));
    assert.equal(result.points[0], original);
    assert.equal(qty(result.points[0]!, TRUST), 0);
  });

  it("repairPeresecHistory_missingDay_carriesLastStatement", () => {
    const original = point({ BTC: 1 });
    const statements = [
      series({ key: "investment:1", accountNumber: "0433383", asset: TRUST }, [
        { date: "2026-10-11", value: 6 },
        { date: "2026-10-12", value: null },
      ]),
      series({ key: "investment:3", accountNumber: "0454918", asset: PERSONAL }, [{ date: "2026-10-11", value: 3 }]),
    ];
    const repaired = repairPeresecHistory([original], statements).points[0];
    assert.equal(qty(repaired!, TRUST), 6);
    assert.equal(qty(repaired!, PERSONAL), 3);
    assert.equal(qty(repaired!, "BTC"), 1);
  });

  it("repairPeresecHistory_secondPass_changesNothing", () => {
    const once = repairPeresecHistory([point({ BTC: 2, [TRUST_ALIAS]: 10, [PERSONAL_ALIAS]: 4, [PERSONAL]: 4 })], bothSeries());
    const twice = repairPeresecHistory(once.points, bothSeries());
    assert.deepEqual(twice.days, []);
    assert.equal(twice.points[0], once.points[0]);
    assert.equal(qty(twice.points[0]!, TRUST_ALIAS), 10);
    assert.equal(qty(twice.points[0]!, PERSONAL), 4);
    assert.equal(qty(twice.points[0]!, PERSONAL_ALIAS), 0);
  });

  it("buildPerformance_badPeresecSnapshot_doesNotDip", () => {
    const asOf = jhbDayStart("2026-10-13") + 12 * 60 * 60 * 1000;
    const bad = point({ BTC: 1 });
    const book: PriceBook = { close: () => 10, fx: () => 20, fxIsReference: () => false, hourly: () => [], daily: () => ({}) };
    const state: PortfolioState = {
      asOf,
      positions: [{ exchange: "binance", linkId: "L1", linkName: "Main", containerId: null, wallet: "spot", asset: "BTC", qty: 1 }],
      debts: [],
      prices: { BTC: 10 },
      change24h: {},
      fx: 20,
      fxSource: "luno",
      containers: [],
      errors: [],
      statementSeries: bothSeries(),
    };
    const derived = deriveFrom({ state, points: [bad], ledger: null, book });
    const performance = buildPerformance(derived, "ALL", undefined);
    const historical = performance.points.find((row) => row.t === new Date(bad.t).toISOString());
    assert.equal(historical?.netUsd, 10 + 10 + 4);
    assert.equal(derived.points[0]?.h.none?.BTC, 1);
  });
});
