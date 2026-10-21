import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { investmentPath, layerForStep, parseDrillStep, readInvestmentLayer, type InvestmentLayer } from "./perecDrill";

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

  it("investmentPath_encodesTheNameAndAddsTheLayer", () => {
    assert.equal(investmentPath("Anchor / Peresec"), "/portfolio/Anchor%20%2F%20Peresec");
    assert.equal(investmentPath("Anchor / Peresec", "weib"), "/portfolio/Anchor%20%2F%20Peresec?inside=weib");
    assert.equal(investmentPath("Anchor / Peresec", "eib"), "/portfolio/Anchor%20%2F%20Peresec?inside=eib");
  });
});
