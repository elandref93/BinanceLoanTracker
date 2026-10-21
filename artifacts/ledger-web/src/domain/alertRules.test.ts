import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ALERT_DELIVERY_UNAVAILABLE,
  chooseAlertLoans,
  deleteStoredRule,
  describeScope,
  evaluateAlertTriggers,
  makeRuleId,
  parseLtvInput,
  ruleAppliesTo,
  rulesFromSettings,
  scopeFromKey,
  scopeKey,
  upsertStoredRule,
  type AlertLoan,
  type AlertRule,
} from "./alertRules";

const loan = (id: string, accountId: string, ltv: number): AlertLoan => ({
  id,
  accountId,
  ltv,
  asset: "USDT",
  collateralAsset: "BTC",
});

describe("rulesFromSettings", () => {
  it("rulesFromSettings_missingOrEmpty_returnsNoRules", () => {
    assert.deepEqual(rulesFromSettings({}), []);
    assert.deepEqual(rulesFromSettings({ currency: "ZAR" }), []);
    assert.deepEqual(rulesFromSettings({ alertRules: [] }), []);
    assert.deepEqual(rulesFromSettings(null), []);
  });

  it("rulesFromSettings_mixedEntries_keepsValidScopesAndSkipsJunk", () => {
    const rules = rulesFromSettings({
      alertRules: [
        { id: "loan", ltv: 80, scope: { loanId: "loan-1" }, label: " Margin " },
        { id: "bad", ltv: 0, scope: "any" },
        { id: "account", ltv: 60, scope: { containerId: "acct-1", note: "kept-on-raw" } },
        { id: "any", ltv: 70, scope: "any" },
        "nope",
      ],
    });
    assert.deepEqual(
      rules.map((rule) => rule.id),
      ["account", "any", "loan"],
    );
    assert.equal(rules[2]?.label, "Margin");
    assert.equal(rules[0]?.scope && typeof rules[0].scope === "object" && "containerId" in rules[0].scope, true);
  });
});

describe("upsertStoredRule", () => {
  it("upsertStoredRule_preservesPhoneFieldsAndSortsByLtv", () => {
    const next = upsertStoredRule(
      {
        currency: "ZAR",
        targetLtv: 65,
        targetOverrides: { "acct-1": 55 },
        phoneOnly: { keep: true },
        alertRules: [
          { id: "bad", ltv: 0, scope: "any" },
          { id: "warn", ltv: 78, scope: "any", haptic: true },
        ],
      },
      { id: "fresh", ltv: 72, scope: { containerId: "acct-1" }, label: "Warning" },
    );
    assert.equal(next.currency, "ZAR");
    assert.equal(next.targetLtv, 65);
    assert.deepEqual(next.targetOverrides, { "acct-1": 55 });
    assert.deepEqual(next.phoneOnly, { keep: true });
    assert.equal("updatedAt" in next, false);
    const rules = next.alertRules as Record<string, unknown>[];
    assert.deepEqual(
      rules.map((rule) => rule.id),
      ["bad", "fresh", "warn"],
    );
    assert.equal(rules[2]?.haptic, true);
    assert.equal(rules[1]?.label, "Warning");
  });

  it("upsertStoredRule_edit_keepsUnknownKeysAndClearsBlankLabel", () => {
    const next = upsertStoredRule(
      { alertRules: [{ id: "warn", ltv: 72, scope: "any", label: "Warning", haptic: true }] },
      { id: "warn", ltv: 73, scope: { loanId: "loan-1" } },
    );
    const rules = next.alertRules as Record<string, unknown>[];
    assert.equal(rules.length, 1);
    assert.equal(rules[0]?.ltv, 73);
    assert.deepEqual(rules[0]?.scope, { loanId: "loan-1" });
    assert.equal(rules[0]?.haptic, true);
    assert.equal("label" in (rules[0] ?? {}), false);
  });

  it("upsertStoredRule_duplicateId_collapsesToOne", () => {
    const next = upsertStoredRule(
      {
        alertRules: [
          { id: "warn", ltv: 70, scope: "any", haptic: true },
          { id: "warn", ltv: 71, scope: "any" },
        ],
      },
      { id: "warn", ltv: 69, scope: "any" },
    );
    const rules = next.alertRules as Record<string, unknown>[];
    assert.equal(rules.length, 1);
    assert.equal(rules[0]?.ltv, 69);
    assert.equal(rules[0]?.haptic, true);
  });
});

describe("deleteStoredRule", () => {
  it("deleteStoredRule_lastRule_leavesEmptyArrayAndOtherSettings", () => {
    const next = deleteStoredRule({ currency: "USD", alertRules: [{ id: "warn", ltv: 72, scope: "any" }] }, "warn");
    assert.deepEqual(next.alertRules, []);
    assert.equal(next.currency, "USD");
    assert.equal("updatedAt" in next, false);
  });

  it("deleteStoredRule_unknownId_keepsStoredRules", () => {
    const next = deleteStoredRule({ alertRules: [{ id: "warn", ltv: 72, scope: "any", extra: 1 }] }, "missing");
    const rules = next.alertRules as Record<string, unknown>[];
    assert.equal(rules.length, 1);
    assert.equal(rules[0]?.extra, 1);
  });
});

describe("parseLtvInput", () => {
  it("parseLtvInput_commaAndDot_roundsToOneDecimalInsideRange", () => {
    assert.equal(parseLtvInput("72,5"), 72.5);
    assert.equal(parseLtvInput("72,5"), 72.5);
    assert.equal(parseLtvInput(" 70 "), 70);
    assert.equal(parseLtvInput("0"), null);
    assert.equal(parseLtvInput("100"), null);
    assert.equal(parseLtvInput("100,0"), null);
    assert.equal(parseLtvInput("-1"), null);
    assert.equal(parseLtvInput(""), null);
    assert.equal(parseLtvInput("nope"), null);
  });
});

describe("ruleAppliesTo", () => {
  const anyRule: AlertRule = { id: "any", ltv: 70, scope: "any" };
  const accountRule: AlertRule = { id: "acct", ltv: 70, scope: { containerId: "acct-1" } };
  const loanRule: AlertRule = { id: "loan", ltv: 70, scope: { loanId: "loan-1" } };

  it("ruleAppliesTo_scopes_matchAnyContainerOrLoan", () => {
    assert.equal(ruleAppliesTo(anyRule, "loan-2", null), true);
    assert.equal(ruleAppliesTo(accountRule, "loan-1", "acct-1"), true);
    assert.equal(ruleAppliesTo(accountRule, "loan-1", "acct-2"), false);
    assert.equal(ruleAppliesTo(accountRule, "loan-1", null), false);
    assert.equal(ruleAppliesTo(loanRule, "loan-1", "acct-9"), true);
    assert.equal(ruleAppliesTo(loanRule, "loan-2", "acct-1"), false);
  });
});

describe("evaluateAlertTriggers", () => {
  const containers = new Map<string, string>([["link-1", "acct-1"]]);
  const loans = [loan("loan-1", "link-1", 74), loan("loan-2", "link-2", 80)];

  it("evaluateAlertTriggers_threshold_includesEqualityAndSkipsBelow", () => {
    const matches = evaluateAlertTriggers(
      [
        { id: "low", ltv: 70, scope: "any" },
        { id: "exact", ltv: 74, scope: { loanId: "loan-1" } },
        { id: "high", ltv: 79, scope: "any" },
        { id: "account", ltv: 70, scope: { containerId: "acct-1" } },
      ],
      loans,
      containers,
    );
    const keys = matches.map((match) => `${match.ruleId}:${match.loanId}`);
    assert.deepEqual(keys, [
      "low:loan-1",
      "exact:loan-1",
      "account:loan-1",
      "low:loan-2",
      "high:loan-2",
    ]);
    assert.equal(matches[0]?.pair, "BTC/USDT");
    assert.equal("delivered" in (matches[0] ?? {}), false);
  });
});

describe("chooseAlertLoans", () => {
  const live = [loan("live", "link-1", 50)];
  const snapshot = [loan("snap", "link-1", 60)];

  it("chooseAlertLoans_prefersLiveThenSnapshot", () => {
    assert.deepEqual(
      chooseAlertLoans({
        livePending: true,
        liveFailed: false,
        liveLoans: null,
        snapshotPending: false,
        snapshotFailed: false,
        snapshotLoans: snapshot,
      }),
      { status: "pending" },
    );
    assert.equal(
      chooseAlertLoans({
        livePending: false,
        liveFailed: false,
        liveLoans: live,
        snapshotPending: true,
        snapshotFailed: false,
        snapshotLoans: null,
      }).status,
      "ready",
    );
    const fromSnapshot = chooseAlertLoans({
      livePending: false,
      liveFailed: false,
      liveLoans: [],
      snapshotPending: false,
      snapshotFailed: false,
      snapshotLoans: snapshot,
    });
    assert.deepEqual(fromSnapshot, { status: "ready", source: "snapshot", loans: snapshot });
    const failed = chooseAlertLoans({
      livePending: false,
      liveFailed: true,
      liveLoans: null,
      snapshotPending: false,
      snapshotFailed: true,
      snapshotLoans: null,
    });
    assert.deepEqual(failed, { status: "unavailable" });
  });
});

describe("describeScope", () => {
  it("describeScope_knownAndMissingLabels", () => {
    assert.equal(
      describeScope({ id: "a", ltv: 1, scope: "any" }, () => null, () => null),
      "Any loan",
    );
    assert.equal(
      describeScope({ id: "a", ltv: 1, scope: { containerId: "acct-1" } }, () => null, () => "Personal"),
      "Personal",
    );
    assert.equal(
      describeScope({ id: "a", ltv: 1, scope: { containerId: "missing" } }, () => null, () => null),
      "1 account",
    );
    assert.equal(
      describeScope({ id: "a", ltv: 1, scope: { loanId: "loan-1" } }, () => "BTC/USDT", () => null),
      "BTC/USDT",
    );
    assert.equal(
      describeScope({ id: "a", ltv: 1, scope: { loanId: "missing" } }, () => null, () => null),
      "1 loan",
    );
  });
});

describe("scope keys", () => {
  it("scopeKey_roundTrip_preservesScope", () => {
    const scopes = ["any", { containerId: "acct:1" }, { loanId: "loan-1" }] as const;
    for (const scope of scopes) {
      assert.deepEqual(scopeFromKey(scopeKey(scope)), scope);
    }
    assert.equal(makeRuleId(1_700_000_000_000, "abcd").startsWith("r_"), true);
  });
});

describe("delivery", () => {
  it("ALERT_DELIVERY_UNAVAILABLE_statesWebCannotDeliver", () => {
    assert.match(ALERT_DELIVERY_UNAVAILABLE, /not available on web/);
  });
});
