import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { fmtCompact, fmtQty } from "../domain/format";
import { applyPreferenceEdit } from "./preferences";
import { Balance, DiscreetProvider } from "./DiscreetMode";
import {
  DISCREET_PLACEHOLDER,
  foldHover,
  maskAmountsInText,
  readStoredDiscreet,
} from "./discreet";

function render(enabled: boolean, revealed: boolean, node: ReactNode): string {
  return renderToStaticMarkup(createElement(DiscreetProvider, { enabled, revealed, children: node }));
}

describe("discreet mode", () => {
  it("readStoredDiscreet_defaultsOff", () => {
    assert.equal(readStoredDiscreet(null), false);
    assert.equal(readStoredDiscreet({}), false);
    assert.equal(readStoredDiscreet({ webDiscreet: false }), false);
    assert.equal(readStoredDiscreet({ webDiscreet: "true" }), false);
    assert.equal(readStoredDiscreet({ webDiscreet: true }), true);
    assert.equal(applyPreferenceEdit({}, {}).webDiscreet, undefined);
  });

  it("maskAmountsInText_usesOnePlaceholderForEverySize", () => {
    assert.equal(maskAmountsInText("R1", true), DISCREET_PLACEHOLDER);
    assert.equal(maskAmountsInText("R100000", true), DISCREET_PLACEHOLDER);
    assert.equal(maskAmountsInText("$2", true), DISCREET_PLACEHOLDER);
    assert.equal(maskAmountsInText("R1", false), "R1");
  });

  it("maskAmountsInText_keepsLabelsDatesAndPercents", () => {
    const qty = fmtQty(2, "USDC");
    const amount = fmtCompact(20, "R");
    const line = `Owed ${qty} · ${amount} · Personal`;
    const hidden = maskAmountsInText(line, true);
    assert.equal(hidden.includes("Owed"), true);
    assert.equal(hidden.includes("Personal"), true);
    assert.equal(hidden.includes(qty), false);
    assert.equal(hidden.includes(amount), false);
    assert.equal(maskAmountsInText("Luno USDC R10,00", true).startsWith("Luno USDC "), true);
    assert.equal(maskAmountsInText("Snapshot 10 Oct 2026", true), "Snapshot 10 Oct 2026");
    assert.equal(maskAmountsInText("LTV 45,0%", true), "LTV 45,0%");
    assert.equal(maskAmountsInText("—", true), "—");
  });

  it("foldHover_oneDepthShowsEveryFigure", () => {
    assert.equal(foldHover(["enter", "leave", "enter"]), true);
    assert.equal(foldHover(["enter", "leave"]), false);
    assert.equal(foldHover(["enter", "enter", "leave"]), true);
    assert.equal(foldHover([]), false);
  });

  it("Balance_hidesEveryFigureUntilReveal", () => {
    const first = "R1";
    const second = fmtQty(2, "BTC");
    const hidden = render(
      true,
      false,
      createElement("div", null, createElement(Balance, { text: first }), createElement(Balance, { text: second })),
    );
    assert.equal(hidden.includes(first), false);
    assert.equal(hidden.includes(second), false);
    assert.equal(hidden.split(DISCREET_PLACEHOLDER).length - 1, 2);
    const shown = render(
      true,
      true,
      createElement("div", null, createElement(Balance, { text: first }), createElement(Balance, { text: `Held ${second} · Personal` })),
    );
    assert.equal(shown.includes(first), true);
    assert.equal(shown.includes(second), true);
    assert.equal(shown.includes("Personal"), true);
    assert.equal(shown.includes("Held"), true);
    const off = render(false, true, createElement(Balance, { text: first }));
    assert.equal(off.includes(first), true);
    assert.equal(off.includes("data-balance"), false);
  });
});
