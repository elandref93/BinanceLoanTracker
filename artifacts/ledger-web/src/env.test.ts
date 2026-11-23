import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readWebEnv, resolveClerkPublishableKey, resolveWebEnv } from "./env";

describe("readWebEnv", () => {
  it("readWebEnv_emptyValue_usesSameOrigin", () => {
    assert.deepEqual(readWebEnv({}), { apiBaseUrl: "" });
    assert.deepEqual(readWebEnv({ VITE_API_BASE_URL: "  " }), { apiBaseUrl: "" });
  });

  it("readWebEnv_httpsOrigin_stripsTrailingSlash", () => {
    assert.deepEqual(readWebEnv({ VITE_API_BASE_URL: "https://ledger.example.com/" }), {
      apiBaseUrl: "https://ledger.example.com",
    });
  });

  it("readWebEnv_embeddedCredentials_rejected", () => {
    assert.throws(() =>
      readWebEnv({ VITE_API_BASE_URL: "https://user:secret@ledger.example.com" }),
    );
  });

  it("readWebEnv_nonHttpUrl_rejected", () => {
    assert.throws(() => readWebEnv({ VITE_API_BASE_URL: "file:///tmp/ledger" }));
  });

  it("resolveWebEnv_runtimeEmptyBase_staysSameOrigin", () => {
    assert.deepEqual(
      resolveWebEnv(
        { VITE_API_BASE_URL: "https://other.example" },
        { apiBaseUrl: "", clerkPublishableKey: "pk_test_public" },
      ),
      { apiBaseUrl: "" },
    );
    assert.equal(
      resolveClerkPublishableKey("pk_build", { apiBaseUrl: "", clerkPublishableKey: "pk_test_public" }),
      "pk_test_public",
    );
  });

  it("resolveWebEnv_withoutRuntime_usesBuildValue", () => {
    assert.deepEqual(resolveWebEnv({}), { apiBaseUrl: "" });
    assert.equal(resolveClerkPublishableKey(" pk_build ", undefined), "pk_build");
  });
});
