import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AccountSaveError,
  ProfileAlreadyHasLinkError,
  accountLabelForLink,
  commitAddLink,
  commitRemove,
  createContainerId,
  deriveName,
  planAddLink,
  planRemoveContainer,
  planRemoveLink,
  planRename,
  readSyncContainers,
  safeClientMessage,
  soleOpenProfile,
  toAccountSyncBody,
  type AccountWriteApi,
  type SyncContainer,
} from "./accountModel";
import { validateExchangeCredentials } from "./credentialValidation";
import { parseBinanceQR } from "./parseBinanceQR";

const secret = "SUPERSECRETVALUE123456";
const apiKey = "A".repeat(64);
const nowIso = "2026-10-09T10:00:00.000Z";

function personal(): SyncContainer {
  return {
    id: "acct_1",
    type: "personal",
    name: "Personal",
    createdAt: nowIso,
    links: [],
  };
}

describe("profiles", () => {
  it("deriveName_joinsTypeAndLabel", () => {
    assert.equal(deriveName("trust", " Family "), "Trust · Family");
    assert.equal(deriveName("personal"), "Personal");
    assert.equal(createContainerId(5, "abc").startsWith("acct_5_"), true);
  });

  it("readSyncContainers_dropsSecretsAndUnknownProfiles", () => {
    const parsed = readSyncContainers([
      {
        id: "acct_1",
        type: "trust",
        label: "Family",
        name: "ignored",
        createdAt: nowIso,
        links: [
          {
            id: "link_1",
            exchange: "binance",
            createdAt: nowIso,
            apiKey,
            apiSecret: secret,
            credentials: { apiKey, apiSecret: secret },
          },
        ],
      },
      { id: "acct_2", name: "Mystery" },
    ]);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.name, "Trust · Family");
    const blob = JSON.stringify(parsed);
    assert.equal(blob.includes(secret), false);
    assert.equal(blob.includes("apiKey"), false);
    assert.equal(blob.includes(apiKey), false);
  });

  it("soleOpenProfile_skipsAProfileThatAlreadyHasTheExchange", () => {
    const open = [personal()];
    assert.equal(soleOpenProfile(open, "luno"), "acct_1");
    const blocked: SyncContainer[] = [
      {
        ...personal(),
        links: [{ id: "link_1", exchange: "luno", createdAt: nowIso }],
      },
    ];
    assert.equal(soleOpenProfile(blocked, "luno"), null);
    assert.equal(soleOpenProfile([personal(), personal()], "binance"), null);
  });
});

describe("planAddLink", () => {
  it("planAddLink_keepsTheSecretOutOfTheSyncBody", () => {
    const plan = planAddLink(
      [],
      { kind: "new", type: "personal", label: "Ada" },
      { exchange: "binance", label: "Spot", apiKey: `  ${apiKey}  `, apiSecret: ` ${secret} ` },
      { nowIso, linkId: "link_9", containerId: "acct_9" },
    );
    const body = toAccountSyncBody(plan.containers);
    const blob = JSON.stringify(body);
    assert.equal("updatedAt" in body, false);
    assert.equal(blob.includes(secret), false);
    assert.equal(blob.includes(apiKey), false);
    assert.equal(blob.includes("apiSecret"), false);
    assert.equal(plan.credential.apiKey, apiKey);
    assert.equal(plan.credential.apiSecret, secret);
    assert.equal(plan.credential.name, "Personal · Ada · Spot");
    assert.equal(plan.containers[0]?.name, "Personal · Ada");
    assert.equal(accountLabelForLink(plan.containers, "link_9"), "Personal · Ada · Spot");
  });

  it("planAddLink_rejectsASecondLinkForTheSameExchange", () => {
    const existing: SyncContainer[] = [
      {
        ...personal(),
        links: [{ id: "link_1", exchange: "binance", createdAt: nowIso }],
      },
    ];
    assert.throws(
      () =>
        planAddLink(
          existing,
          { kind: "existing", id: "acct_1" },
          { exchange: "binance", apiKey, apiSecret: secret },
          { nowIso, linkId: "link_2" },
        ),
      ProfileAlreadyHasLinkError,
    );
  });
});

describe("rename and remove", () => {
  it("planRename_changesTheLabelWithoutTouchingLinks", () => {
    const existing: SyncContainer[] = [
      {
        ...personal(),
        links: [{ id: "link_1", exchange: "luno", createdAt: nowIso }],
      },
    ];
    const renamed = planRename(existing, "acct_1", "Family");
    assert.equal(renamed[0]?.name, "Personal · Family");
    assert.equal(renamed[0]?.links.length, 1);
    const cleared = planRename(renamed, "acct_1", null);
    assert.equal(cleared[0]?.name, "Personal");
    assert.equal(cleared[0]?.label, undefined);
    const blob = JSON.stringify(toAccountSyncBody(cleared));
    assert.equal(blob.includes("apiKey"), false);
  });

  it("planRemoveContainer_deletesEveryLinkCredential", () => {
    const existing: SyncContainer[] = [
      {
        ...personal(),
        links: [
          { id: "link_b", exchange: "binance", createdAt: nowIso },
          { id: "link_l", exchange: "luno", createdAt: nowIso },
        ],
      },
    ];
    const plan = planRemoveContainer(existing, "acct_1");
    assert.deepEqual(plan.credentialDeletes, [
      { exchange: "binance", id: "link_b" },
      { exchange: "luno", id: "link_l" },
    ]);
    assert.equal(plan.containers.length, 0);
    const linkPlan = planRemoveLink(existing, "acct_1", "link_b");
    assert.deepEqual(linkPlan.credentialDeletes, [{ exchange: "binance", id: "link_b" }]);
    assert.equal(linkPlan.containers[0]?.links.length, 1);
  });
});

describe("commitAddLink", () => {
  it("commitAddLink_writesTheCredentialBeforeTheSecretFreeBlob", async () => {
    const calls: string[] = [];
    let syncBody = "";
    const api: AccountWriteApi = {
      async putCredentialLink(_exchange, _id, body) {
        calls.push("credential");
        assert.equal(body.apiSecret, secret);
      },
      async deleteCredentialLink() {
        calls.push("delete");
      },
      async putAccountSync(body) {
        calls.push("sync");
        syncBody = JSON.stringify(body);
      },
    };
    const plan = planAddLink(
      [],
      { kind: "new", type: "trust" },
      { exchange: "luno", apiKey, apiSecret: secret },
      { nowIso, linkId: "link_1", containerId: "acct_1" },
    );
    await commitAddLink(api, plan);
    assert.deepEqual(calls, ["credential", "sync"]);
    assert.equal(syncBody.includes(secret), false);
  });

  it("commitAddLink_removesTheCredentialWhenSyncFails", async () => {
    const calls: string[] = [];
    const api: AccountWriteApi = {
      async putCredentialLink() {
        calls.push("credential");
      },
      async deleteCredentialLink() {
        calls.push("delete");
      },
      async putAccountSync() {
        calls.push("sync");
        const error = new Error(`sync failed ${secret}`) as Error & { status?: number };
        error.status = 500;
        throw error;
      },
    };
    const plan = planAddLink(
      [],
      { kind: "new", type: "personal" },
      { exchange: "binance", apiKey, apiSecret: secret },
      { nowIso, linkId: "link_1", containerId: "acct_1" },
    );
    await assert.rejects(() => commitAddLink(api, plan), AccountSaveError);
    assert.deepEqual(calls, ["credential", "sync", "delete"]);
    try {
      await commitAddLink(api, plan);
    } catch (error) {
      assert.equal(safeClientMessage(error).includes(secret), false);
    }
  });

  it("commitRemove_doesNotRewriteTheBlobWhenCredentialDeleteFails", async () => {
    const calls: string[] = [];
    const api: AccountWriteApi = {
      async putCredentialLink() {
        calls.push("credential");
      },
      async deleteCredentialLink() {
        calls.push("delete");
        throw Object.assign(new Error("nope"), { status: 500 });
      },
      async putAccountSync() {
        calls.push("sync");
      },
    };
    const plan = planRemoveContainer(
      [
        {
          ...personal(),
          links: [{ id: "link_1", exchange: "binance", createdAt: nowIso }],
        },
      ],
      "acct_1",
    );
    await assert.rejects(() => commitRemove(api, plan));
    assert.deepEqual(calls, ["delete"]);
  });
});

describe("credential entry", () => {
  it("validateExchangeCredentials_matchesTheMobileMessages", () => {
    assert.equal(validateExchangeCredentials("binance", "", secret), "API key is required");
    assert.equal(validateExchangeCredentials("binance", "short", secret), "API key looks too short");
    assert.equal(validateExchangeCredentials("binance", apiKey, "not-a-valid-secret"), "API secret must be letters and numbers only");
    assert.equal(validateExchangeCredentials("binance", apiKey, secret), null);
    assert.equal(validateExchangeCredentials("luno", "abc", secret), "Key ID looks too short");
    assert.equal(validateExchangeCredentials("luno", "keyid123", "c2VjcmV0LXZhbHVlLQ=="), null);
  });

  it("parseBinanceQR_readsJsonAndBareTokens", () => {
    const parsed = parseBinanceQR(
      JSON.stringify({ apiKey, secretKey: secret }),
    );
    assert.equal(parsed.apiKey, apiKey);
    assert.equal(parsed.apiSecret, secret);
    const bare = parseBinanceQR(`${apiKey} ${"B".repeat(64)}`);
    assert.equal(bare.apiKey, apiKey);
    assert.equal(bare.apiSecret, "B".repeat(64));
    assert.deepEqual(parseBinanceQR("hello"), {});
  });

  it("safeClientMessage_doesNotRepeatALeakedSecret", () => {
    const message = safeClientMessage(new Error(`rejected ${secret}`));
    assert.equal(message.includes(secret), false);
    assert.equal(safeClientMessage(Object.assign(new Error("x"), { status: 401 })).includes("Sign in"), true);
  });
});
