import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_INPUTS } from "./leverageSim";
import {
  deleteScenarioFromList,
  formInputsFromStored,
  saveScenarioInList,
} from "./leverageScenarios";

describe("saveScenarioInList", () => {
  it("saveScenarioInList_update_preservesUnknownFieldsAndSiblings", () => {
    const existing = [
      {
        id: "scn_1",
        name: "Old",
        inputs: { ...DEFAULT_INPUTS, deskNote: "keep-input" },
        createdAt: "t0",
        updatedAt: "t0",
        note: "keep-scenario",
      },
      "untouched-sibling",
      { id: "scn_2", name: "Other", inputs: { ...DEFAULT_INPUTS } },
    ];
    const { scenarios, saved } = saveScenarioInList(existing, {
      id: "scn_1",
      name: "Renamed",
      inputs: { ...DEFAULT_INPUTS, startingCapital: 25_000 },
      now: "t1",
    });
    assert.equal(saved.id, "scn_1");
    assert.equal(saved.name, "Renamed");
    assert.equal(scenarios.length, 3);
    assert.equal(scenarios[1], "untouched-sibling");
    const updated = scenarios[0] as Record<string, unknown>;
    assert.equal(updated.note, "keep-scenario");
    assert.equal(updated.createdAt, "t0");
    assert.equal(updated.updatedAt, "t1");
    const inputs = updated.inputs as Record<string, unknown>;
    assert.equal(inputs.deskNote, "keep-input");
    assert.equal(inputs.startingCapital, 25_000);
    const other = scenarios[2] as Record<string, unknown>;
    assert.equal(other.name, "Other");
  });

  it("deleteScenarioFromList_oneId_leavesTheRest", () => {
    const next = deleteScenarioFromList(
      [{ id: "scn_1", name: "A" }, { leftover: true }, { id: "scn_2", name: "B" }],
      "scn_1",
    );
    assert.deepEqual(next, [{ leftover: true }, { id: "scn_2", name: "B" }]);
  });

  it("formInputsFromStored_knownNumbers_ignoresJunk", () => {
    const inputs = formInputsFromStored({
      btcGrowth: 12,
      taxMode: "trust",
      years: "10",
      deskNote: "ignored-by-form",
    });
    assert.equal(inputs.btcGrowth, 12);
    assert.equal(inputs.taxMode, "trust");
    assert.equal(inputs.years, DEFAULT_INPUTS.years);
    assert.equal("deskNote" in inputs, false);
  });
});
