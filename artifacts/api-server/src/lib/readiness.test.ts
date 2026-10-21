import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { aggregateReadiness, microsoftConfigCheck } from "./readiness";

describe("microsoftConfigCheck", () => {
  it("microsoftConfigCheck_bothIds_ok", () => {
    assert.equal(
      microsoftConfigCheck({
        MICROSOFT_TENANT_ID: "tenant",
        MICROSOFT_CLIENT_ID: "client",
      }),
      "ok",
    );
  });

  it("microsoftConfigCheck_blank_missing", () => {
    assert.equal(
      microsoftConfigCheck({
        MICROSOFT_TENANT_ID: "  ",
        MICROSOFT_CLIENT_ID: "client",
      }),
      "missing",
    );
    assert.equal(microsoftConfigCheck({}), "missing");
  });
});

describe("aggregateReadiness", () => {
  it("aggregateReadiness_allOk_ready", () => {
    assert.equal(
      aggregateReadiness({
        encryptionKey: "ok",
        dataDir: "ok",
        microsoft: "ok",
      }),
      "ready",
    );
  });

  it("aggregateReadiness_anyFailure_notReady", () => {
    assert.equal(
      aggregateReadiness({
        encryptionKey: "missing",
        dataDir: "ok",
        microsoft: "ok",
      }),
      "not_ready",
    );
    assert.equal(
      aggregateReadiness({
        encryptionKey: "ok",
        dataDir: "unavailable",
        microsoft: "ok",
      }),
      "not_ready",
    );
  });

  it("aggregateReadiness_microsoftMissing_stillReady", () => {
    assert.equal(
      aggregateReadiness({
        encryptionKey: "ok",
        dataDir: "ok",
        microsoft: "missing",
      }),
      "ready",
    );
  });
});
