import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { stripAccountSyncSecrets } from "./stripAccountSecrets";

describe("stripAccountSyncSecrets", () => {
  it("stripAccountSyncSecrets_nestedCredentials_removesSecretsAndKeepsMetadata", () => {
    const payload = [
      {
        id: "acct_1",
        type: "personal",
        label: "Family",
        name: "Personal · Family",
        createdAt: "2026-01-01T00:00:00.000Z",
        links: [
          {
            id: "link_1",
            exchange: "binance",
            label: "Main",
            createdAt: "2026-01-02T00:00:00.000Z",
            credentials: {
              apiKey: "plain-key",
              apiSecret: "plain-secret",
              apiKeyMasked: "plai…cret",
            },
          },
        ],
      },
    ];

    const stripped = stripAccountSyncSecrets(payload);

    assert.deepEqual(stripped, [
      {
        id: "acct_1",
        type: "personal",
        label: "Family",
        name: "Personal · Family",
        createdAt: "2026-01-01T00:00:00.000Z",
        links: [
          {
            id: "link_1",
            exchange: "binance",
            label: "Main",
            createdAt: "2026-01-02T00:00:00.000Z",
            credentials: {
              apiKeyMasked: "plai…cret",
            },
          },
        ],
      },
    ]);
    assert.equal(payload[0]?.links[0]?.credentials.apiSecret, "plain-secret");
  });

  it("stripAccountSyncSecrets_legacyTopLevelKeys_removed", () => {
    const stripped = stripAccountSyncSecrets({
      id: "legacy",
      name: "Trust",
      apiKey: "k",
      apiSecret: "s",
    });
    assert.deepEqual(stripped, { id: "legacy", name: "Trust" });
  });
});
