import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { investmentPath, layerForStep, lookthroughLines, parseDrillStep, readInvestmentLayer, type InvestmentLayer } from "./perecDrill";

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

  it("investmentPath_encodesTheNameAndAddsTheLayer", () => {
    assert.equal(investmentPath("Anchor / Peresec"), "/portfolio/Anchor%20%2F%20Peresec");
    assert.equal(investmentPath("Anchor / Peresec", "weib"), "/portfolio/Anchor%20%2F%20Peresec?inside=weib");
    assert.equal(investmentPath("Anchor / Peresec", "eib"), "/portfolio/Anchor%20%2F%20Peresec?inside=eib");
  });
});
