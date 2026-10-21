import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

delete process.env.CREDENTIAL_ENCRYPTION_KEY;

const dataDir = await mkdtemp(path.join(os.tmpdir(), "ledger-migrate-"));
process.env.ACCOUNT_SYNC_DIR = dataDir;
const encryptionKey = crypto.randomBytes(32).toString("base64");

const migration = await import("./migrateAccountSecrets");
const store = await import("./credentialStore");

function hashOf(sub: string): string {
  return crypto.createHash("sha256").update(sub).digest("hex");
}

function accountPath(sub: string): string {
  return path.join(dataDir, `${hashOf(sub)}.json`);
}

function credsPath(sub: string): string {
  return path.join(dataDir, `${hashOf(sub)}.creds.json`);
}

async function writeJson(target: string, value: unknown): Promise<void> {
  await writeFile(target, JSON.stringify(value), "utf8");
}

function hasSecretField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasSecretField);
  if (value === null || typeof value !== "object") return false;
  for (const [key, child] of Object.entries(value)) {
    if (key === "apiKey" || key === "apiSecret") return true;
    if (hasSecretField(child)) return true;
  }
  return false;
}

after(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("migratePlaintextAccountSecrets", { concurrency: 1 }, () => {
  it("migratePlaintextAccountSecrets_missingEncryptionKey_leavesPlaintextBlob", async () => {
    const sub = "migrate-no-key";
    const blob = {
      updatedAt: "2026-03-01T00:00:00.000Z",
      containers: [
        {
          id: "acct",
          name: "Personal",
          links: [
            {
              id: "link-1",
              exchange: "binance",
              credentials: { apiKey: "plain-key", apiSecret: "plain-secret" },
            },
          ],
        },
      ],
    };
    await writeJson(accountPath(sub), blob);
    const before = await readFile(accountPath(sub), "utf8");

    const summary = await migration.migratePlaintextAccountSecrets();

    assert.equal(summary.skipped >= 1, true);
    assert.equal(JSON.stringify(summary).includes("plain-secret"), false);
    assert.equal(await readFile(accountPath(sub), "utf8"), before);
    await assert.rejects(() => readFile(credsPath(sub), "utf8"));
  });

  it("migratePlaintextAccountSecrets_plaintextBlob_movesSecretsAndStripsBlob", async () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = encryptionKey;
    const sub = "migrate-move";
    const updatedAt = "2026-04-01T00:00:00.000Z";
    await writeJson(accountPath(sub), {
      updatedAt,
      containers: [
        {
          id: "acct_1",
          type: "personal",
          label: "Family",
          name: "Personal · Family",
          links: [
            {
              id: "binance-link",
              exchange: "binance",
              label: "Main",
              credentials: {
                apiKey: "binance-key",
                apiSecret: "binance-secret",
                apiKeyMasked: "bina…cret",
              },
            },
            {
              id: "luno-link",
              exchange: "luno",
              label: "Luno",
              credentials: { apiKey: "luno-key", apiSecret: "luno-secret" },
            },
          ],
        },
      ],
    });
    const hash = hashOf(sub);
    const settingsPath = path.join(dataDir, `${hash}.settings.json`);
    const ltvPath = path.join(dataDir, `${hash}.ltv.json`);
    const applePath = path.join(dataDir, "apple_identities.json");
    const microsoftPath = path.join(dataDir, "microsoft_identities.json");
    await writeFile(settingsPath, JSON.stringify({ apiKey: "settings-secret", apiSecret: "s" }));
    await writeFile(ltvPath, JSON.stringify({ apiSecret: "ltv-secret" }));
    await writeFile(applePath, JSON.stringify({ apiKey: "apple-secret" }));
    await writeFile(microsoftPath, JSON.stringify({ apiSecret: "ms-secret" }));

    const summary = await migration.migratePlaintextAccountSecrets();

    assert.equal(summary.migrated >= 1, true);
    assert.equal(summary.linksAdded >= 2, true);
    assert.equal(JSON.stringify(summary).includes("binance-secret"), false);
    const stored = JSON.parse(await readFile(accountPath(sub), "utf8")) as {
      updatedAt: string;
      containers: Array<{ links: Array<{ credentials: Record<string, string> }> }>;
    };
    assert.equal(stored.updatedAt, updatedAt);
    assert.equal(hasSecretField(stored), false);
    assert.equal(stored.containers[0]?.links[0]?.credentials.apiKeyMasked, "bina…cret");
    assert.equal(accountPath(sub).endsWith(`${hash}.json`), true);

    const binance = await store.loadDecryptedExchange(sub, "binance");
    const luno = await store.loadDecryptedExchange(sub, "luno");
    assert.equal(binance?.[0]?.id, "binance-link");
    assert.equal(binance?.[0]?.name, "Main");
    assert.equal(binance?.[0]?.apiKey, "binance-key");
    assert.equal(binance?.[0]?.apiSecret, "binance-secret");
    assert.equal(luno?.[0]?.apiSecret, "luno-secret");
    const credRaw = await readFile(credsPath(sub), "utf8");
    assert.equal(credRaw.includes("binance-secret"), false);
    assert.equal(credRaw.includes("luno-key"), false);

    assert.equal(await readFile(settingsPath, "utf8"), JSON.stringify({ apiKey: "settings-secret", apiSecret: "s" }));
    assert.equal(await readFile(ltvPath, "utf8"), JSON.stringify({ apiSecret: "ltv-secret" }));
    assert.equal(await readFile(applePath, "utf8"), JSON.stringify({ apiKey: "apple-secret" }));
    assert.equal(await readFile(microsoftPath, "utf8"), JSON.stringify({ apiSecret: "ms-secret" }));

    const credBytes = await readFile(credsPath(sub));
    const accountBytes = await readFile(accountPath(sub));
    const again = await migration.migratePlaintextAccountSecrets();
    assert.equal(again.migrated, 0);
    assert.deepEqual(await readFile(credsPath(sub)), credBytes);
    assert.deepEqual(await readFile(accountPath(sub)), accountBytes);
  });

  it("migratePlaintextAccountSecrets_existingEncryptedLink_keepsCiphertextAndOtherExchange", async () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = encryptionKey;
    const sub = "migrate-keep";
    await store.upsertCredentialLink(sub, "binance", {
      id: "kept-binance",
      name: "Stored",
      apiKey: "stored-key",
      apiSecret: "stored-secret",
    });
    await store.upsertCredentialLink(sub, "luno", {
      id: "kept-luno",
      name: "Stored Luno",
      apiKey: "stored-luno-key",
      apiSecret: "stored-luno-secret",
    });
    const before = JSON.parse(await readFile(credsPath(sub), "utf8")) as {
      binance: Array<{ id: string; apiSecret: { ct: string } }>;
      luno: unknown[];
    };
    await writeJson(accountPath(sub), {
      updatedAt: "2026-05-01T00:00:00.000Z",
      containers: [
        {
          id: "acct",
          name: "Personal",
          links: [
            {
              id: "kept-binance",
              exchange: "binance",
              credentials: { apiKey: "blob-key", apiSecret: "blob-secret-must-not-win" },
            },
            {
              id: "new-binance",
              exchange: "binance",
              label: "New",
              credentials: { apiKey: "new-key", apiSecret: "new-secret" },
            },
          ],
        },
      ],
    });

    await migration.migratePlaintextAccountSecrets();

    const after = JSON.parse(await readFile(credsPath(sub), "utf8")) as {
      binance: Array<{ id: string; apiSecret: { ct: string } }>;
      luno: unknown[];
    };
    assert.deepEqual(after.luno, before.luno);
    const kept = after.binance.find((account) => account.id === "kept-binance");
    const original = before.binance.find((account) => account.id === "kept-binance");
    assert.deepEqual(kept?.apiSecret, original?.apiSecret);
    const decrypted = await store.loadDecryptedExchange(sub, "binance");
    assert.equal(
      decrypted?.find((account) => account.id === "kept-binance")?.apiSecret,
      "stored-secret",
    );
    assert.equal(
      decrypted?.find((account) => account.id === "new-binance")?.apiSecret,
      "new-secret",
    );
    const blob = JSON.parse(await readFile(accountPath(sub), "utf8")) as unknown;
    assert.equal(hasSecretField(blob), false);
    assert.equal(JSON.stringify(blob).includes("blob-secret-must-not-win"), false);
  });

  it("migratePlaintextAccountSecrets_unreadableCredentialFile_doesNotStripOrReplace", async () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = encryptionKey;
    const sub = "migrate-corrupt";
    const blob = {
      updatedAt: "2026-06-01T00:00:00.000Z",
      containers: [
        {
          id: "acct",
          links: [
            {
              id: "link",
              exchange: "luno",
              credentials: { apiKey: "keep-key", apiSecret: "keep-secret" },
            },
          ],
        },
      ],
    };
    await writeJson(accountPath(sub), blob);
    await writeFile(credsPath(sub), "{not-json", "utf8");
    const blobBefore = await readFile(accountPath(sub), "utf8");
    const credsBefore = await readFile(credsPath(sub), "utf8");

    const summary = await migration.migratePlaintextAccountSecrets();

    assert.equal(summary.skipped >= 1, true);
    assert.equal(await readFile(accountPath(sub), "utf8"), blobBefore);
    assert.equal(await readFile(credsPath(sub), "utf8"), credsBefore);
  });

  it("migratePlaintextAccountSecrets_undecryptableExistingSeal_leavesBlobAndCiphertext", async () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = encryptionKey;
    const sub = "migrate-wrong-key";
    const blob = {
      updatedAt: "2026-06-15T00:00:00.000Z",
      containers: [
        {
          id: "acct",
          links: [
            {
              id: "kept",
              exchange: "binance",
              credentials: { apiKey: "recoverable-key", apiSecret: "recoverable-secret" },
            },
          ],
        },
      ],
    };
    await writeJson(accountPath(sub), blob);
    const sealed = {
      v: 1,
      iv: crypto.randomBytes(12).toString("base64"),
      tag: crypto.randomBytes(16).toString("base64"),
      ct: crypto.randomBytes(16).toString("base64"),
    };
    const creds = {
      updatedAt: "2026-06-15T00:00:00.000Z",
      binance: [{ id: "kept", name: "Stored", apiKey: sealed, apiSecret: sealed }],
      luno: [],
    };
    await writeJson(credsPath(sub), creds);
    const credsBefore = await readFile(credsPath(sub), "utf8");

    await migration.migratePlaintextAccountSecrets();

    assert.equal(await readFile(accountPath(sub), "utf8"), JSON.stringify(blob));
    assert.equal(await readFile(credsPath(sub), "utf8"), credsBefore);
  });

  it("migratePlaintextAccountSecrets_overExchangeLimit_doesNotDropExistingOrStrip", async () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = encryptionKey;
    const sub = "migrate-limit";
    for (let index = 1; index <= 10; index += 1) {
      await store.upsertCredentialLink(sub, "binance", {
        id: `existing-${index}`,
        name: `Existing ${index}`,
        apiKey: `existing-key-${index}`,
        apiSecret: `existing-secret-${index}`,
      });
    }
    const credsBefore = await readFile(credsPath(sub), "utf8");
    const blob = {
      updatedAt: "2026-07-01T00:00:00.000Z",
      containers: [
        {
          id: "acct",
          links: [
            {
              id: "eleventh",
              exchange: "binance",
              credentials: { apiKey: "eleventh-key", apiSecret: "eleventh-secret" },
            },
          ],
        },
      ],
    };
    await writeJson(accountPath(sub), blob);

    await migration.migratePlaintextAccountSecrets();

    assert.equal(await readFile(credsPath(sub), "utf8"), credsBefore);
    assert.equal(await readFile(accountPath(sub), "utf8"), JSON.stringify(blob));
    const decrypted = await store.loadDecryptedExchange(sub, "binance");
    assert.equal(decrypted?.length, 10);
    assert.equal(decrypted?.some((account) => account.id === "eleventh"), false);
  });

  it("migratePlaintextAccountSecrets_unplacedOrConflictingSecret_leavesBlob", async () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = encryptionKey;
    const unplaced = "migrate-unplaced";
    const unplacedBlob = {
      updatedAt: "2026-08-01T00:00:00.000Z",
      containers: [{ id: "acct", name: "Trust", apiKey: "orphan-key", apiSecret: "orphan-secret" }],
    };
    await writeJson(accountPath(unplaced), unplacedBlob);
    const conflicting = "migrate-conflict";
    const conflictingBlob = {
      updatedAt: "2026-08-02T00:00:00.000Z",
      containers: [
        {
          id: "a",
          links: [
            {
              id: "same",
              exchange: "binance",
              credentials: { apiKey: "k1", apiSecret: "s1" },
            },
          ],
        },
        {
          id: "b",
          links: [
            {
              id: "same",
              exchange: "binance",
              credentials: { apiKey: "k2", apiSecret: "s2" },
            },
          ],
        },
      ],
    };
    await writeJson(accountPath(conflicting), conflictingBlob);

    await migration.migratePlaintextAccountSecrets();

    assert.equal(await readFile(accountPath(unplaced), "utf8"), JSON.stringify(unplacedBlob));
    assert.equal(await readFile(accountPath(conflicting), "utf8"), JSON.stringify(conflictingBlob));
    await assert.rejects(() => readFile(credsPath(unplaced), "utf8"));
    await assert.rejects(() => readFile(credsPath(conflicting), "utf8"));
  });
});
