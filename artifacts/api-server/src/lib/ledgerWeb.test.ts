import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  injectLedgerPublicConfig,
  isApiPath,
  ledgerPublicConfig,
  ledgerPublicConfigScript,
  shouldServeLedgerIndex,
} from "./ledgerWeb";

describe("ledgerPublicConfig", () => {
  it("ledgerPublicConfig_alwaysSameOrigin_ignoresOtherHosts", () => {
    const config = ledgerPublicConfig({
      VITE_API_BASE_URL: "https://evil.example",
      CLERK_PUBLISHABLE_KEY: " pk_test_public ",
    });
    assert.deepEqual(config, { apiBaseUrl: "", clerkPublishableKey: "pk_test_public" });
    assert.equal(config.apiBaseUrl, "");
  });

  it("ledgerPublicConfigScript_escapesMarkupInTheKey", () => {
    const script = ledgerPublicConfigScript({
      apiBaseUrl: "",
      clerkPublishableKey: "</script><script>alert(1)",
    });
    assert.equal(script.includes("</script>"), false);
    assert.match(script, /\\u003c\/script>/);
    assert.match(script, /"apiBaseUrl":""/);
  });

  it("injectLedgerPublicConfig_insertsScriptBeforeHeadClose", () => {
    const html = injectLedgerPublicConfig("<head><title>Ledger</title></head>", {
      apiBaseUrl: "",
      clerkPublishableKey: "",
    });
    assert.match(html, /<script>window\.__LEDGER_PUBLIC__=\{"apiBaseUrl":"","clerkPublishableKey":""\};<\/script><\/head>/);
  });
});

describe("shouldServeLedgerIndex", () => {
  it("shouldServeLedgerIndex_routesFallBack_apiAndAssetsDoNot", () => {
    assert.equal(shouldServeLedgerIndex("/", "GET"), true);
    assert.equal(shouldServeLedgerIndex("/index.html", "GET"), true);
    assert.equal(shouldServeLedgerIndex("/portfolio/btc", "HEAD"), true);
    assert.equal(shouldServeLedgerIndex("/sign-in/sso-callback", "GET"), true);
    assert.equal(shouldServeLedgerIndex("/api", "GET"), false);
    assert.equal(shouldServeLedgerIndex("/api/healthz", "GET"), false);
    assert.equal(shouldServeLedgerIndex("/api/auth/session", "GET"), false);
    assert.equal(shouldServeLedgerIndex("/assets/app.js", "GET"), false);
    assert.equal(shouldServeLedgerIndex("/", "POST"), false);
    assert.equal(isApiPath("/api/healthz"), true);
  });
});
