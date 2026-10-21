import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  evaluateProductionStartup,
  hasExplicitAllowedOrigins,
} from "./productionStartup";

const here = path.dirname(fileURLToPath(import.meta.url));

function decision(overrides: Partial<Parameters<typeof evaluateProductionStartup>[0]> = {}) {
  return evaluateProductionStartup({
    nodeEnv: "production",
    azureHost: false,
    appServiceStorageEnabled: false,
    encryptionKeyConfigured: true,
    allowedOrigins: "https://ledger.example",
    dataDirIsEphemeralFallback: false,
    ...overrides,
  });
}

describe("evaluateProductionStartup", () => {
  it("evaluateProductionStartup_productionMissingAll_enforcesEveryCheck", () => {
    const result = decision({
      azureHost: true,
      appServiceStorageEnabled: false,
      encryptionKeyConfigured: false,
      allowedOrigins: "  , ",
      dataDirIsEphemeralFallback: true,
    });
    assert.equal(result.enforce, true);
    assert.deepEqual(result.missing, [
      "CREDENTIAL_ENCRYPTION_KEY",
      "persistent data directory",
      "ALLOWED_ORIGINS",
    ]);
  });

  it("evaluateProductionStartup_azureWithoutPersistentStorage_requiresDataDirectory", () => {
    const result = decision({
      azureHost: true,
      appServiceStorageEnabled: false,
      dataDirIsEphemeralFallback: false,
    });
    assert.deepEqual(result.missing, ["persistent data directory"]);
  });

  it("evaluateProductionStartup_ephemeralFallback_requiresDataDirectory", () => {
    const result = decision({ dataDirIsEphemeralFallback: true });
    assert.deepEqual(result.missing, ["persistent data directory"]);
  });

  it("evaluateProductionStartup_productionReady_missingNone", () => {
    const result = decision({
      azureHost: true,
      appServiceStorageEnabled: true,
      dataDirIsEphemeralFallback: false,
    });
    assert.equal(result.enforce, true);
    assert.deepEqual(result.missing, []);
  });

  it("evaluateProductionStartup_developmentMissingConfig_doesNotEnforce", () => {
    const result = decision({
      nodeEnv: "development",
      encryptionKeyConfigured: false,
      allowedOrigins: undefined,
      dataDirIsEphemeralFallback: true,
    });
    assert.equal(result.enforce, false);
    assert.equal(result.missing.includes("CREDENTIAL_ENCRYPTION_KEY"), true);
    assert.equal(result.missing.includes("ALLOWED_ORIGINS"), true);
  });

  it("hasExplicitAllowedOrigins_blankList_false", () => {
    assert.equal(hasExplicitAllowedOrigins(undefined), false);
    assert.equal(hasExplicitAllowedOrigins(""), false);
    assert.equal(hasExplicitAllowedOrigins(" , "), false);
    assert.equal(hasExplicitAllowedOrigins("https://ledger.example"), true);
  });
});

describe("azure liveness probe", () => {
  it("healthz_staysLivenessOnly_andIsStillTheAzureProbe", () => {
    const health = readFileSync(path.join(here, "../routes/health.ts"), "utf8");
    const healthz = health.slice(
      health.indexOf('router.get("/healthz"'),
      health.indexOf('router.get("/readyz"'),
    );
    assert.equal(healthz.includes("CREDENTIAL_ENCRYPTION_KEY"), false);
    assert.equal(healthz.includes("ALLOWED_ORIGINS"), false);
    assert.equal(healthz.includes("readyz"), false);

    const probe = JSON.parse(
      readFileSync(path.join(here, "../../../../scripts/health-check.json"), "utf8"),
    ) as { healthCheckPath: string };
    assert.equal(probe.healthCheckPath, "/api/healthz");

    const easyAuth = readFileSync(path.join(here, "../../azure-auth.json"), "utf8");
    assert.equal(easyAuth.includes("/api/healthz"), true);
    assert.equal(easyAuth.includes("/api/readyz"), false);
  });
});
