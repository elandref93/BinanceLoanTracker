import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeDecimalInput, parseDecimalInput } from "./decimalInput";

describe("normalizeDecimalInput", () => {
  it("normalizeDecimalInput_acceptsCommaAndDot", () => {
    assert.equal(normalizeDecimalInput("16.50"), "16.50");
    assert.equal(normalizeDecimalInput("16,50"), "16.50");
    assert.equal(normalizeDecimalInput("1,234"), "1.234");
    assert.equal(normalizeDecimalInput(",5"), "0.5");
    assert.equal(normalizeDecimalInput(".5"), "0.5");
  });

  it("normalizeDecimalInput_treatsTheOtherMarkAsThousands", () => {
    assert.equal(normalizeDecimalInput("1,234.56"), "1234.56");
    assert.equal(normalizeDecimalInput("1.234,56"), "1234.56");
    assert.equal(normalizeDecimalInput("1 234,50"), "1234.50");
    assert.equal(normalizeDecimalInput("1,234,567"), "1234567");
    assert.equal(normalizeDecimalInput("1.234.567"), "1234567");
  });

  it("normalizeDecimalInput_keepsALongFractionAsText", () => {
    const raw = "0.0000000000000000001";
    assert.equal(normalizeDecimalInput(raw), raw);
    assert.equal(String(Number(raw)), "1e-19");
  });

  it("normalizeDecimalInput_rejectsIncompleteOrGroupedGarbage", () => {
    assert.equal(normalizeDecimalInput(""), null);
    assert.equal(normalizeDecimalInput("  "), null);
    assert.equal(normalizeDecimalInput("16."), null);
    assert.equal(normalizeDecimalInput("1,2,3"), null);
    assert.equal(normalizeDecimalInput("abc"), null);
    assert.equal(normalizeDecimalInput("-"), null);
  });

  it("parseDecimalInput_returnsAFiniteNumber", () => {
    assert.equal(parseDecimalInput("1,5"), 1.5);
    assert.equal(parseDecimalInput("1.5"), 1.5);
    assert.equal(parseDecimalInput("nope"), null);
    assert.equal(parseDecimalInput("-2,25"), -2.25);
  });
});
