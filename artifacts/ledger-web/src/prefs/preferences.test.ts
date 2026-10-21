import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyPreferenceEdit,
  personChoices,
  personLabel,
  readStoredPerson,
  readStoredScope,
  resolvePerson,
  resolveScope,
  scopeChoices,
  scopeLabel,
  selectPerson,
  shortProfileName,
  userPersonTitle,
  viewScope,
} from "./preferences";

describe("display preferences", () => {
  it("applyPreferenceEdit_keepsOtherSettingsFields", () => {
    const settings = { alertRules: [{ id: "r1" }], targetLtv: 60, currency: "USD" };
    const next = applyPreferenceEdit(settings, { currency: "ZAR", scope: "acct_1" });
    assert.deepEqual(next, { alertRules: [{ id: "r1" }], targetLtv: 60, currency: "ZAR", webScope: "acct_1" });
    assert.deepEqual(settings.currency, "USD");
  });

  it("readStoredScope_rejectsMissingOrOddValues", () => {
    assert.equal(readStoredScope({ webScope: "acct_1" }), "acct_1");
    assert.equal(readStoredScope({ webScope: 4 }), null);
    assert.equal(readStoredScope(null), null);
  });

  it("resolveScope_unknownProfile_fallsBackToAll", () => {
    const containers = [{ id: "acct_1" }];
    assert.equal(resolveScope("acct_1", containers), "acct_1");
    assert.equal(resolveScope("acct_gone", containers), "all");
    assert.equal(resolveScope(null, containers), "all");
  });

  it("profileNames_dropTheRepeatedTypePrefix", () => {
    assert.equal(shortProfileName({ name: "Trust · Family Trust", type: "trust" }), "Family Trust");
    assert.equal(shortProfileName({ name: "Personal", type: "personal" }), "Personal");
    assert.equal(scopeLabel("all", []), "All profiles");
    assert.equal(shortProfileName({ name: "Laden", type: "child" }), "Laden");
  });

  it("resolveScope_childId_isNotAProfile", () => {
    const containers = [{ id: "acct_1", name: "Personal" }];
    assert.equal(resolveScope("child:greyson", containers), "all");
    assert.equal(resolveScope("child:ivelle", containers), "all");
    assert.equal(resolveScope("child:laden", containers), "all");
    assert.equal(scopeLabel("child:greyson", containers), "All profiles");
  });

  it("scopeChoices_listsOnlyTheUsersProfiles", () => {
    const choices = scopeChoices([
      { id: "acct_personal", name: "Personal", type: "personal" },
      { id: "acct_trust", name: "Trust · WLDD", type: "trust", label: "WLDD" },
    ]);
    assert.deepEqual(
      choices.map((choice) => choice.title),
      ["All profiles", "Personal", "WLDD"],
    );
    assert.equal(choices[0]?.caption, "Trust and your investments");
    assert.equal(choices.some((choice) => choice.title === "Greyson"), false);
  });

  it("personChoices_areSeparateFromProfiles", () => {
    const people = personChoices("Elandre");
    assert.deepEqual(
      people.map((person) => person.title),
      ["Elandre", "Laden", "Ivelle", "Greyson"],
    );
    assert.equal(people[0]?.id, "user");
    assert.equal(people[0]?.caption, "Your investments and the trust");
    assert.equal(people.some((person) => person.title === "Personal" || person.title === "WLDD"), false);
    assert.equal(personLabel("child:greyson"), "Greyson");
    assert.equal(personLabel("user", "Elandre"), "Elandre");
  });

  it("userPersonTitle_usesTheFirstName", () => {
    assert.equal(userPersonTitle("Elandre Fourie"), "Elandre");
    assert.equal(userPersonTitle("  "), "You");
    assert.equal(userPersonTitle("person@example.com"), "You");
    assert.equal(userPersonTitle(null), "You");
  });

  it("resolvePerson_legacyChildScope_selectsThatChild", () => {
    assert.equal(resolvePerson(null, "child:greyson"), "child:greyson");
    assert.equal(resolvePerson("user", "child:laden"), "user");
    assert.equal(resolvePerson(null, "acct_1"), "user");
    assert.equal(readStoredPerson({ webPerson: "child:ivelle" }), "child:ivelle");
    assert.equal(readStoredPerson({ webPerson: "acct_1" }), null);
  });

  it("selectPerson_backToTheUser_restoresTheCombinedView", () => {
    assert.deepEqual(selectPerson({ person: "child:greyson", scope: "acct_trust" }, "user"), { person: "user", scope: "all" });
    assert.deepEqual(selectPerson({ person: "user", scope: "acct_personal" }, "child:laden"), {
      person: "child:laden",
      scope: "acct_personal",
    });
    assert.deepEqual(selectPerson({ person: "user", scope: "acct_personal" }, "user"), { person: "user", scope: "acct_personal" });
  });

  it("viewScope_childReplacesTheProfileCut", () => {
    assert.equal(viewScope("user", "all"), "all");
    assert.equal(viewScope("user", "acct_trust"), "acct_trust");
    assert.equal(viewScope("child:greyson", "all"), "child:greyson");
    assert.equal(viewScope("child:ivelle", "acct_trust"), "child:ivelle");
  });

  it("applyPreferenceEdit_storesDiscreetWithoutDroppingOtherFields", () => {
    const settings = { alertRules: [{ id: "r1" }], currency: "ZAR", webDiscreet: false };
    const next = applyPreferenceEdit(settings, { discreet: true });
    assert.equal(next.webDiscreet, true);
    assert.equal(next.currency, "ZAR");
    assert.deepEqual(next.alertRules, [{ id: "r1" }]);
    const currencyOnly = applyPreferenceEdit(next, { currency: "USD" });
    assert.equal(currencyOnly.webDiscreet, true);
    assert.equal(currencyOnly.currency, "USD");
    assert.equal(applyPreferenceEdit(currencyOnly, { discreet: false }).webDiscreet, false);
  });

  it("applyPreferenceEdit_storesPersonApartFromProfileScope", () => {
    const settings = { alertRules: [{ id: "r1" }], webScope: "child:greyson" };
    const next = applyPreferenceEdit(settings, { person: "child:laden" });
    assert.equal(next.webPerson, "child:laden");
    assert.equal(next.webScope, "all");
    assert.deepEqual(next.alertRules, [{ id: "r1" }]);
    const back = applyPreferenceEdit(next, { person: "user", scope: "all" });
    assert.equal(back.webPerson, "user");
    assert.equal(back.webScope, "all");
  });
});
