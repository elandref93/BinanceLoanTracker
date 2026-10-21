import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isBrowserOriginAllowed } from "./browserOrigin";

const listed = ["https://ledger.example", "http://localhost:5173"];

describe("isBrowserOriginAllowed", () => {
  it("isBrowserOriginAllowed_missingOrigin_allowsNonBrowserClients", () => {
    assert.equal(isBrowserOriginAllowed(undefined, listed, "production"), true);
  });

  it("isBrowserOriginAllowed_listedOrigin_allowsInProduction", () => {
    assert.equal(
      isBrowserOriginAllowed("https://ledger.example", listed, "production"),
      true,
    );
  });

  it("isBrowserOriginAllowed_lanHttps_allowsInDevelopment", () => {
    assert.equal(
      isBrowserOriginAllowed("https://192.168.211.63:5173", listed, "development"),
      true,
    );
    assert.equal(
      isBrowserOriginAllowed("https://10.0.0.129:5173", listed, "development"),
      true,
    );
    assert.equal(
      isBrowserOriginAllowed("http://172.16.4.2:5173", listed, "development"),
      true,
    );
  });

  it("isBrowserOriginAllowed_lanHttps_rejectsInProduction", () => {
    assert.equal(
      isBrowserOriginAllowed("https://192.168.211.63:5173", listed, "production"),
      false,
    );
    assert.equal(
      isBrowserOriginAllowed("https://192.168.211.63:5173", listed, undefined),
      false,
    );
  });

  it("isBrowserOriginAllowed_publicHost_rejects", () => {
    assert.equal(
      isBrowserOriginAllowed("https://evil.example", listed, "development"),
      false,
    );
    assert.equal(
      isBrowserOriginAllowed("https://8.8.8.8", listed, "development"),
      false,
    );
    assert.equal(
      isBrowserOriginAllowed("https://192.168.211.63.evil.example", listed, "development"),
      false,
    );
    assert.equal(
      isBrowserOriginAllowed("https://user:pass@192.168.211.63:5173", listed, "development"),
      false,
    );
  });
});
