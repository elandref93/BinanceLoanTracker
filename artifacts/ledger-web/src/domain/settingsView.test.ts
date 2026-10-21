import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applySettingsEdits,
  classifyAccountSync,
  classifySettingsWrite,
  diagnosticsReport,
  FX_NOT_RETURNED,
  keyHealthRows,
  redactDiagnostics,
  serverRateText,
  settingsSyncBody,
  SETTINGS_CONFLICT,
  SYNC_CONFLICT,
  SYNC_EMPTY,
} from "./settingsView";

describe("applySettingsEdits", () => {
  it("applySettingsEdits_phoneFields_keepsUnknownKeysAndOmitsClientClock", () => {
    const next = applySettingsEdits(
      {
        currency: "USD",
        alertRules: [{ id: "warn", ltv: 70, scope: "any", haptic: true }],
        phoneOnly: { keep: true },
        targetOverrides: { "acct-old": 40, "acct-1": 55, note: "phone" },
        updatedAt: "kept-inside-the-blob",
      },
      {
        currency: "ZAR",
        globalTarget: 60,
        clearGlobal: false,
        profiles: [{ id: "acct-1", target: 50, clear: false }],
      },
    );
    const body = settingsSyncBody(next);
    assert.deepEqual(Object.keys(body), ["settings"]);
    assert.equal("updatedAt" in body, false);
    assert.equal(body.settings.currency, "ZAR");
    assert.equal(body.settings.targetLtv, 60);
    assert.equal(body.settings.updatedAt, "kept-inside-the-blob");
    assert.deepEqual(body.settings.phoneOnly, { keep: true });
    assert.deepEqual(body.settings.alertRules, [{ id: "warn", ltv: 70, scope: "any", haptic: true }]);
    assert.deepEqual(body.settings.targetOverrides, { "acct-old": 40, "acct-1": 50, note: "phone" });
  });
});

describe("classifySettingsWrite", () => {
  it("classifySettingsWrite_409_isAVisibleConflict", () => {
    const conflict = classifySettingsWrite(409);
    assert.equal(conflict.ok, false);
    if (conflict.ok) return;
    assert.equal(conflict.conflict, true);
    assert.equal(conflict.message, SETTINGS_CONFLICT);
    assert.match(conflict.message, /409/);
    assert.equal(classifySettingsWrite(200).ok, true);
    assert.equal(classifySettingsWrite(500).ok, false);
    const failed = classifySettingsWrite(500);
    assert.equal(failed.ok, false);
    if (!failed.ok) assert.equal(failed.conflict, false);
  });
});

describe("classifyAccountSync", () => {
  it("classifyAccountSync_409_isAVisibleConflict", () => {
    const conflict = classifyAccountSync(true, 409);
    assert.equal(conflict.ok, false);
    if (conflict.ok) return;
    assert.equal(conflict.empty, false);
    assert.equal(conflict.conflict, true);
    assert.equal(conflict.message, SYNC_CONFLICT);
    assert.match(conflict.message, /409/);
    const empty = classifyAccountSync(false, 200);
    assert.equal(empty.ok, false);
    assert.equal(empty.message, SYNC_EMPTY);
    assert.equal(classifyAccountSync(true, 200).ok, true);
  });
});

describe("serverRateText", () => {
  it("serverRateText_missingRate_doesNotInventOne", () => {
    assert.equal(serverRateText(null), FX_NOT_RETURNED);
    assert.equal(serverRateText({}), FX_NOT_RETURNED);
    assert.equal(serverRateText({ fxUsdToZar: null }), FX_NOT_RETURNED);
    assert.equal(serverRateText({ fxUsdToZar: 0 }), FX_NOT_RETURNED);
    assert.equal(serverRateText({ fxUsdToZar: 18.25 }), "R18,25 per USD");
  });
});

describe("redactDiagnostics", () => {
  it("redactDiagnostics_secrets_areRemovedFromObjectsAndText", () => {
    const clean = redactDiagnostics({
      apiKey: "binance-key-value",
      apiSecret: "binance-secret-value",
      cookie: "session=abc",
      authorization: "Bearer super-token",
      nested: { token: "nested-token", note: "safe note" },
      lastError: "apiKey=binance-key-value cookie=session=abc Bearer super-token",
      name: "Personal",
    }) as Record<string, unknown>;
    const text = JSON.stringify(clean);
    assert.equal(text.includes("binance-key-value"), false);
    assert.equal(text.includes("binance-secret-value"), false);
    assert.equal(text.includes("super-token"), false);
    assert.equal(text.includes("session=abc"), false);
    assert.equal(text.includes("nested-token"), false);
    assert.equal(clean.name, "Personal");
    assert.match(String(clean.lastError), /\[redacted\]/);
    const report = diagnosticsReport([
      "cookie=session=abc",
      "authorization: Bearer super-token",
      "status: present",
    ]);
    assert.equal(report.includes("session=abc"), false);
    assert.equal(report.includes("super-token"), false);
    assert.match(report, /status: present/);
  });
});

describe("keyHealthRows", () => {
  it("keyHealthRows_metadata_reportsPresenceWithoutSecrets", () => {
    const health = keyHealthRows({
      containers: [
        {
          name: "Personal",
          links: [
            { id: "link-1", exchange: "binance" },
            { id: "link-2", exchange: "luno" },
          ],
        },
      ],
      credentials: {
        accounts: [
          {
            id: "link-1",
            name: "Personal",
            exchange: "binance",
            apiKey: "SECRETKEY",
            apiSecret: "SECRETVALUE",
            lastError: "clock skew",
          },
        ],
      },
    });
    assert.equal(health.rows[0]?.presence, "present");
    assert.equal(health.rows[0]?.lastError, "clock skew");
    assert.equal(health.rows[1]?.presence, "missing");
    assert.equal(health.rows[1]?.lastError, null);
    assert.equal(JSON.stringify(health).includes("SECRETKEY"), false);
    assert.equal(JSON.stringify(health).includes("SECRETVALUE"), false);
    assert.equal(keyHealthRows({ containers: [], credentials: null }).rows.length, 0);
  });
});
