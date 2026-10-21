import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "ledger-creds-"));
process.env.ACCOUNT_SYNC_DIR = dataDir;
process.env.CREDENTIAL_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");

const store = await import("./credentialStore");

const userId = "user-credential-links";

function credsPath(): string {
  const hash = crypto.createHash("sha256").update(userId).digest("hex");
  return path.join(dataDir, `${hash}.creds.json`);
}

async function readRaw(): Promise<{
  binance: unknown[];
  luno: unknown[];
}> {
  const raw = await readFile(credsPath(), "utf8");
  return JSON.parse(raw) as { binance: unknown[]; luno: unknown[] };
}

after(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("credentialStore per-link writes", { concurrency: 1 }, () => {
  it("upsertCredentialLink_oneLink_leavesTheOtherExchangeSealed", async () => {
    await store.upsertCredentialLink(userId, "binance", {
      id: "binance-1",
      name: "Binance",
      apiKey: "binance-key-one",
      apiSecret: "binance-secret-one",
    });
    await store.upsertCredentialLink(userId, "luno", {
      id: "luno-1",
      name: "Luno",
      apiKey: "luno-key-one",
      apiSecret: "luno-secret-one",
    });
    const before = await readRaw();

    const replaced = await store.upsertCredentialLink(userId, "binance", {
      id: "binance-1",
      name: "Binance renamed",
      apiKey: "binance-key-two",
      apiSecret: "binance-secret-two",
    });

    const after = await readRaw();
    assert.deepEqual(after.luno, before.luno);
    assert.equal(replaced.account.exchange, "binance");
    assert.equal(replaced.account.name, "Binance renamed");
    assert.equal("apiKey" in replaced.account, false);
    assert.equal("apiSecret" in replaced.account, false);

    const decrypted = await store.loadDecryptedExchange(userId, "luno");
    assert.equal(decrypted?.[0]?.apiSecret, "luno-secret-one");
    const binance = await store.loadDecryptedExchange(userId, "binance");
    assert.equal(binance?.[0]?.apiSecret, "binance-secret-two");

    const meta = await store.getCredentialMeta(userId);
    const encoded = JSON.stringify(meta);
    assert.equal(encoded.includes("binance-secret-two"), false);
    assert.equal(encoded.includes("luno-secret-one"), false);
    assert.equal(encoded.includes("binance-key-two"), false);
    assert.equal(meta.accounts.length, 2);
  });

  it("deleteCredentialLink_oneLink_keepsTheOtherSecret", async () => {
    await store.deleteCredentialLink(userId, "luno", "luno-1");
    const binance = await store.loadDecryptedExchange(userId, "binance");
    const luno = await store.loadDecryptedExchange(userId, "luno");
    assert.equal(binance?.[0]?.apiKey, "binance-key-two");
    assert.equal(luno, null);

    await store.deleteCredentialLink(userId, "luno", "luno-1");
    const still = await store.loadDecryptedExchange(userId, "binance");
    assert.equal(still?.[0]?.apiKey, "binance-key-two");
  });

  it("upsertCredentialLink_eleventhLink_rejectsWithoutDroppingExisting", async () => {
    for (let index = 2; index <= 10; index += 1) {
      await store.upsertCredentialLink(userId, "binance", {
        id: `binance-${index}`,
        name: `Binance ${index}`,
        apiKey: `key-${index}`,
        apiSecret: `secret-${index}`,
      });
    }
    await assert.rejects(
      () =>
        store.upsertCredentialLink(userId, "binance", {
          id: "binance-11",
          name: "Too many",
          apiKey: "key-11",
          apiSecret: "secret-11",
        }),
      (err: unknown) => (err as { status?: number }).status === 400,
    );
    const binance = await store.loadDecryptedExchange(userId, "binance");
    assert.equal(binance?.length, 10);
    assert.equal(binance?.some((account) => account.id === "binance-11"), false);
  });

  it("putCredentials_omittedExchange_clearsThatExchangeOnly", async () => {
    await store.putCredentials(userId, {
      binance: [
        {
          id: "binance-only",
          name: "Only",
          apiKey: "only-key",
          apiSecret: "only-secret",
        },
      ],
    });
    const binance = await store.loadDecryptedExchange(userId, "binance");
    const luno = await store.loadDecryptedExchange(userId, "luno");
    assert.equal(binance?.length, 1);
    assert.equal(binance?.[0]?.id, "binance-only");
    assert.equal(luno, null);
    const meta = await store.getCredentialMeta(userId);
    assert.equal(JSON.stringify(meta).includes("only-secret"), false);
  });
});
