import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { ledgerColors } from "./ledgerColors";

describe("ledgerColors", () => {
  it("ledgerColors_cssTheme_includesMobilePalette", () => {
    const css = readFileSync(new URL("../index.css", import.meta.url), "utf8").toLowerCase();
    const hexValues = Object.values(ledgerColors).flatMap((value) =>
      typeof value === "string" && value.startsWith("#") ? [value] : [],
    );
    for (const hex of hexValues) {
      assert.equal(css.includes(hex.toLowerCase()), true, hex);
    }
    assert.equal(css.includes(`${ledgerColors.radiusPx}px`), true);
  });
});
