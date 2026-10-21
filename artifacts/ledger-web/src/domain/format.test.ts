import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  fmtAge,
  fmtCompact,
  fmtDate,
  fmtDateTime,
  fmtDisplayMoney,
  fmtMoney,
  fmtNum,
  fmtPct,
  fmtQty,
  fmtSignedMoney,
  fmtSignedPct,
  fmtTime,
  fmtUsd,
  getUsdToZar,
  groupWithSpaces,
  MINUS,
  NBSP,
  setUsdToZar,
} from "./format";

const s = (text: string) => text.replace(/ /g, NBSP);

describe("groupWithSpaces", () => {
  it("groupWithSpaces_groupsThousandsWithNoBreakSpacesAndDecimalComma", () => {
    assert.equal(groupWithSpaces(1315000, 0), s("1 315 000"));
    assert.equal(groupWithSpaces(1234.5, 2), s("1 234,50"));
    assert.equal(groupWithSpaces(-1234.5, 2), `${MINUS}${s("1 234,50")}`);
  });

  it("groupWithSpaces_neverContainsABreakingSpace", () => {
    assert.equal(groupWithSpaces(66200, 2).includes(" "), false);
  });

  it("groupWithSpaces_negativeThatRoundsToZero_hasNoSign", () => {
    assert.equal(groupWithSpaces(-0.001, 2), "0,00");
  });
});

describe("money formatters", () => {
  it("fmtUsd_invalid_returnsDash", () => {
    assert.equal(fmtUsd(Number.NaN), "—");
    assert.equal(fmtUsd(Number.POSITIVE_INFINITY), "—");
    assert.equal(fmtNum(Number.NaN), "—");
  });

  it("fmtUsd_whole_dropsCents", () => {
    assert.equal(fmtUsd(1315.4, { whole: true }), s("$1 315"));
    assert.equal(fmtUsd(1315.4), s("$1 315,40"));
  });

  it("fmtUsd_negative_putsMinusBeforeSymbol", () => {
    assert.equal(fmtUsd(-12.5), `${MINUS}$12,50`);
  });

  it("fmtPct_and_fmtQty_useAssetPrecision", () => {
    assert.equal(fmtPct(65), "65,0%");
    assert.equal(fmtPct(Number.NaN), "—");
    assert.equal(fmtQty(1.23456, "BTC"), s("1,2346 BTC"));
    assert.equal(fmtQty(1.23456, "ETH"), s("1,235 ETH"));
    assert.equal(fmtQty(1.23456, "USDC"), s("1,23 USDC"));
    assert.equal(fmtQty(Number.NaN, "BTC"), s("— BTC"));
  });

  it("fmtSignedPct_signsNonZeroValues", () => {
    assert.equal(fmtSignedPct(1.6), "+1,6%");
    assert.equal(fmtSignedPct(-1.6), `${MINUS}1,6%`);
    assert.equal(fmtSignedPct(0.01), "0,0%");
  });

  it("fmtSignedMoney_signsNonZeroValues", () => {
    assert.equal(fmtSignedMoney(38210, "ZAR", { whole: true }), s("+R38 210"));
    assert.equal(fmtSignedMoney(-12400, "ZAR", { whole: true }), s(`${MINUS}R12 400`));
    assert.equal(fmtSignedMoney(0.2, "ZAR", { whole: true }), "R0");
  });

  it("fmtCompact_picksAUnitByMagnitude", () => {
    assert.equal(fmtCompact(38210, "R"), s("R38 210"));
    assert.equal(fmtCompact(412_300, "R"), s("R412,3 k"));
    assert.equal(fmtCompact(1_318_857, "R"), s("R1,32 m"));
    assert.equal(fmtCompact(725_693_156, "R"), s("R725,7 m"));
    assert.equal(fmtCompact(2_400_000_000, "R"), s("R2,40 bn"));
    assert.equal(fmtCompact(-1_318_857, "R"), s(`${MINUS}R1,32 m`));
  });

  it("fmtMoney_convertsWithTheStoredRate_fmtDisplayMoneyDoesNot", () => {
    const previous = getUsdToZar();
    setUsdToZar(2);
    try {
      assert.equal(fmtMoney(10, "ZAR", { whole: true }), "R20");
      assert.equal(fmtDisplayMoney(10, "ZAR", { whole: true }), "R10");
      assert.equal(fmtMoney(Number.NaN, "USD"), "—");
    } finally {
      setUsdToZar(previous);
    }
  });

  it("setUsdToZar_ignoresNonPositive", () => {
    const previous = getUsdToZar();
    setUsdToZar(0);
    setUsdToZar(Number.NaN);
    assert.equal(getUsdToZar(), previous);
  });
});

describe("fmtAge", () => {
  it("fmtAge_bucketsRelativeToNow", () => {
    const now = Date.parse("2026-10-09T12:00:00.000Z");
    assert.equal(fmtAge("2026-10-09T12:00:00.000Z", now), "just now");
    assert.equal(fmtAge("2026-10-09T11:30:00.000Z", now), "30m ago");
    assert.equal(fmtAge("2026-10-09T09:00:00.000Z", now), "3h ago");
    assert.equal(fmtAge("2026-10-07T12:00:00.000Z", now), "2d ago");
    assert.equal(fmtAge("not-a-date", now), "—");
  });
});

describe("Johannesburg dates", () => {
  it("fmtDate_lateUtc_usesJohannesburgCalendarDay", () => {
    const formatted = fmtDate("2026-10-09T22:30:00.000Z");
    assert.equal(formatted.includes("10"), true);
    assert.equal(formatted.includes("2026"), true);
    assert.equal(formatted.includes("9 Oct") || formatted.includes("09 Oct"), false);
  });

  it("fmtDateTime_lateUtc_isHalfPastMidnight", () => {
    const formatted = fmtDateTime("2026-10-09T22:30:00.000Z");
    assert.equal(formatted.includes("10"), true);
    assert.match(formatted, /00:30/);
    assert.equal(fmtTime("2026-10-09T22:30:00.000Z"), "00:30");
  });

  it("fmtDate_invalid_returnsDash", () => {
    assert.equal(fmtDate("not-a-date"), "—");
    assert.equal(fmtDateTime(Number.NaN), "—");
  });
});
