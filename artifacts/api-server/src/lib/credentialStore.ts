import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getDataDir, ensureDataDir } from "./dataDir";
import { seal, open, type Sealed } from "./secretCrypto";
import { logger } from "./logger";

// Server-side storage of exchange API credentials, encrypted at rest.
//
// One file per user, named sha256(sub).creds.json (same privacy convention as
// accountStorage — the raw user id is never written to disk). Inside, each
// account's apiKey/apiSecret are individually sealed with AES-256-GCM.
//
// This deliberately departs from the otherwise-stateless design (the device used
// to send keys per request). It exists so a scheduled job can refresh LTV while
// the app is fully closed. The tradeoff is accepted with: encryption at rest,
// a master key held only as a server secret, and (strongly recommended)
// read-only + IP-restricted exchange keys so a breach cannot move funds.

const SUFFIX = ".creds.json";

export type Exchange = "binance" | "luno";

export interface PlainAccount {
  id: string;
  name: string;
  apiKey: string;
  apiSecret: string;
}

interface StoredAccount {
  id: string;
  name: string;
  apiKey: Sealed;
  apiSecret: Sealed;
}

interface CredFile {
  updatedAt: string;
  binance: StoredAccount[];
  luno: StoredAccount[];
}

export interface AccountMeta {
  id: string;
  name: string;
  exchange: Exchange;
}

function dataDir(): string {
  return getDataDir();
}

function hashFor(sub: string): string {
  return crypto.createHash("sha256").update(sub).digest("hex");
}

function fileForHash(hash: string): string {
  return path.join(dataDir(), `${hash}${SUFFIX}`);
}

async function readByHash(hash: string): Promise<CredFile | null> {
  try {
    const raw = await fs.readFile(fileForHash(hash), "utf8");
    const p = JSON.parse(raw) as Partial<CredFile>;
    if (typeof p?.updatedAt !== "string") return null;
    return {
      updatedAt: p.updatedAt,
      binance: Array.isArray(p.binance) ? p.binance : [],
      luno: Array.isArray(p.luno) ? p.luno : [],
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    logger.warn({ err, op: "creds.read" }, "credentialStore: read failed");
    return null;
  }
}

function sealAccounts(accts: PlainAccount[] | undefined): StoredAccount[] {
  return (accts ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    apiKey: seal(a.apiKey),
    apiSecret: seal(a.apiSecret),
  }));
}

function metaOf(rec: CredFile): AccountMeta[] {
  return [
    ...rec.binance.map((a) => ({
      id: a.id,
      name: a.name,
      exchange: "binance" as const,
    })),
    ...rec.luno.map((a) => ({
      id: a.id,
      name: a.name,
      exchange: "luno" as const,
    })),
  ];
}

/** Encrypt and persist the full credential set for a user (replaces prior set). */
export async function putCredentials(
  sub: string,
  input: { binance?: PlainAccount[]; luno?: PlainAccount[] },
): Promise<AccountMeta[]> {
  const dir = await ensureDataDir();
  const rec: CredFile = {
    updatedAt: new Date().toISOString(),
    binance: sealAccounts(input.binance),
    luno: sealAccounts(input.luno),
  };
  const target = fileForHash(hashFor(sub));
  const tmp = `${target}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(rec), { encoding: "utf8", mode: 0o600 });
  await fs.rename(tmp, target);
  logger.info(
    {
      op: "creds.write",
      userId: sub,
      binance: rec.binance.length,
      luno: rec.luno.length,
    },
    "credentialStore: stored encrypted credentials",
  );
  return metaOf(rec);
}

/** Metadata only — never returns secrets. */
export async function getCredentialMeta(
  sub: string,
): Promise<{ updatedAt: string | null; accounts: AccountMeta[] }> {
  const rec = await readByHash(hashFor(sub));
  if (!rec) return { updatedAt: null, accounts: [] };
  return { updatedAt: rec.updatedAt, accounts: metaOf(rec) };
}

export async function deleteCredentials(sub: string): Promise<void> {
  try {
    await fs.unlink(fileForHash(hashFor(sub)));
    logger.info({ op: "creds.delete", userId: sub }, "credentialStore: deleted");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

/**
 * Decrypt a user's stored credentials by their on-disk hash. Used only by the
 * scheduler, which iterates files and never has the raw sub. Plaintext lives in
 * memory just long enough to build exchange clients.
 */
export async function loadDecryptedByHash(
  hash: string,
): Promise<{ binance: PlainAccount[]; luno: PlainAccount[] } | null> {
  const rec = await readByHash(hash);
  if (!rec) return null;
  const openAccts = (accts: StoredAccount[]): PlainAccount[] =>
    accts.map((a) => ({
      id: a.id,
      name: a.name,
      apiKey: open(a.apiKey),
      apiSecret: open(a.apiSecret),
    }));
  return { binance: openAccts(rec.binance), luno: openAccts(rec.luno) };
}

/** All user hashes that have stored credentials (for the scheduler to iterate). */
export async function listUserHashes(): Promise<string[]> {
  try {
    await ensureDataDir();
    const files = await fs.readdir(dataDir());
    return files
      .filter((f) => f.endsWith(SUFFIX))
      .map((f) => f.slice(0, -SUFFIX.length));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}
