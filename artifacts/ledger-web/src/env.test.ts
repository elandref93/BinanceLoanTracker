import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readWebEnv } from "./env";

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
});
