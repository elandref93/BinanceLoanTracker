import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { areaPath, indexAt, linePath, originalIndex, paddedExtent, project, resample } from "./geometry";

describe("chart geometry", () => {
  it("resample_keepsEndpointsAndLength", () => {
    const out = resample([0, 10, 20], 5);
    assert.deepEqual(out, [0, 5, 10, 15, 20]);
    assert.equal(resample([7], 4).length, 4);
    assert.deepEqual(resample([], 3), [0, 0, 0]);
  });

  it("paddedExtent_flatSeries_getsBand", () => {
    const [min, max] = paddedExtent([100, 100, 100]);
    assert.ok(min < 100 && max > 100);
    const [lo, hi] = paddedExtent([0, 100], 0.1);
    assert.equal(lo, -10);
    assert.equal(hi, 110);
  });

  it("project_mapsMinToBottomAndMaxToTop", () => {
    const points = project([0, 50, 100], { width: 200, height: 100 }, [0, 100]);
    assert.deepEqual(points, [
      { x: 0, y: 100 },
      { x: 100, y: 50 },
      { x: 200, y: 0 },
    ]);
  });

  it("linePath_monotone_doesNotOvershootFlatRun", () => {
    const d = linePath([
      { x: 0, y: 10 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    ]);
    assert.ok(d.startsWith("M0,10C"));
    const numbers = [...d.matchAll(/-?[\d.]+/g)].map((match) => Number(match[0]));
    const ys = numbers.filter((_, index) => index % 2 === 1);
    assert.ok(ys.every((y) => y >= 0 && y <= 10));
    assert.ok(areaPath([{ x: 0, y: 1 }, { x: 1, y: 2 }], 5).endsWith("Z"));
  });

  it("indexAt_andOriginalIndex_clampAndRound", () => {
    assert.equal(indexAt(-5, 100, 11), 0);
    assert.equal(indexAt(51, 100, 11), 5);
    assert.equal(indexAt(500, 100, 11), 10);
    assert.equal(originalIndex(159, 160, 40), 39);
    assert.equal(originalIndex(0, 160, 40), 0);
  });
});
