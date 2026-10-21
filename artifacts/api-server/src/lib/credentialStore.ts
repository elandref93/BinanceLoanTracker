import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getDataDir, ensureDataDir } from "./dataDir";
import { seal, open, isCryptoConfigured, type Sealed } from "./secretCrypto";
import { logSubject, logger } from "./logger";
import { isStorageFileKey, userStorageKey, withUserWriteLock } from "./userWriteLock";

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
const MAX_LINKS_PER_EXCHANGE = 10;

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
  return userStorageKey(sub);
}

function fileForHash(hash: string): string | null {
  if (!isStorageFileKey(hash)) return null;
  return path.join(dataDir(), `${hash}${SUFFIX}`);
}

async function readByHash(hash: string): Promise<CredFile | null> {
  const target = fileForHash(hash);
  if (!target) return null;
  try {
    const raw = await fs.readFile(target, "utf8");
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

function withSubLock<T>(sub: string, fn: () => Promise<T>): Promise<T> {
  return withUserWriteLock(userStorageKey(sub), fn);
}

function httpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

async function persist(sub: string, rec: CredFile): Promise<void> {
  await ensureDataDir();
  const target = fileForHash(hashFor(sub));
  if (!target) throw new Error("Invalid storage key");
  const tmp = `${target}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(rec), { encoding: "utf8", mode: 0o600 });
  await fs.rename(tmp, target);
}

function openAccounts(accts: StoredAccount[]): PlainAccount[] {
  return accts.map((a) => ({
    id: a.id,
    name: a.name,
    apiKey: open(a.apiKey),
    apiSecret: open(a.apiSecret),
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

export interface CredentialWriteResult {
  updatedAt: string;
  accounts: AccountMeta[];
}

export interface CredentialLinkResult {
  updatedAt: string;
  account: AccountMeta;
}

/**
 * Encrypt and persist the full credential set for a user.
 * An omitted exchange is stored as empty. Mobile full-set upload uses this.
 * A single web link change must use `upsertCredentialLink` instead.
 */
export async function putCredentials(
  sub: string,
  input: { binance?: PlainAccount[]; luno?: PlainAccount[] },
): Promise<CredentialWriteResult> {
  return withSubLock(sub, async () => {
    const rec: CredFile = {
      updatedAt: new Date().toISOString(),
      binance: sealAccounts(input.binance),
      luno: sealAccounts(input.luno),
    };
    await persist(sub, rec);
    logger.info(
      {
        op: "creds.write",
        user: logSubject(sub),
        binance: rec.binance.length,
        luno: rec.luno.length,
      },
      "credentialStore: stored encrypted credentials",
    );
    return { updatedAt: rec.updatedAt, accounts: metaOf(rec) };
  });
}

/**
 * Create or replace one link. Other links stay sealed as they were; their
 * ciphertext is not regenerated and their secrets are not returned.
 */
export async function upsertCredentialLink(
  sub: string,
  exchange: Exchange,
  account: PlainAccount,
): Promise<CredentialLinkResult> {
  return withSubLock(sub, async () => {
    const existing = await readByHash(hashFor(sub));
    const binance = [...(existing?.binance ?? [])];
    const luno = [...(existing?.luno ?? [])];
    const target = exchange === "binance" ? binance : luno;
    const sealed = sealAccounts([account])[0];
    if (!sealed) {
      throw httpError(400, "Credential link is empty.");
    }
    const index = target.findIndex((item) => item.id === account.id);
    if (index >= 0) {
      target[index] = sealed;
    } else if (target.length >= MAX_LINKS_PER_EXCHANGE) {
      throw httpError(400, "At most 10 credentials per exchange.");
    } else {
      target.push(sealed);
    }
    const rec: CredFile = {
      updatedAt: new Date().toISOString(),
      binance,
      luno,
    };
    await persist(sub, rec);
    logger.info(
      { op: "creds.upsert", user: logSubject(sub), exchange, linkId: account.id },
      "credentialStore: stored one encrypted link",
    );
    return {
      updatedAt: rec.updatedAt,
      account: { id: account.id, name: account.name, exchange },
    };
  });
}

/** Remove one link. Other sealed secrets stay on disk and are not returned. */
export async function deleteCredentialLink(
  sub: string,
  exchange: Exchange,
  id: string,
): Promise<void> {
  return withSubLock(sub, async () => {
    const existing = await readByHash(hashFor(sub));
    if (!existing) return;
    const binance = existing.binance.filter(
      (item) => !(exchange === "binance" && item.id === id),
    );
    const luno = existing.luno.filter(
      (item) => !(exchange === "luno" && item.id === id),
    );
    const removed =
      binance.length + luno.length <
      existing.binance.length + existing.luno.length;
    if (!removed) return;
    if (binance.length === 0 && luno.length === 0) {
      const target = fileForHash(hashFor(sub));
      if (!target) return;
      try {
        await fs.unlink(target);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    } else {
      await persist(sub, {
        updatedAt: new Date().toISOString(),
        binance,
        luno,
      });
    }
    logger.info(
      { op: "creds.deleteLink", user: logSubject(sub), exchange, linkId: id },
      "credentialStore: removed one link",
    );
  });
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
  return withSubLock(sub, async () => {
    const target = fileForHash(hashFor(sub));
    if (!target) return;
    try {
      await fs.unlink(target);
      logger.info({ op: "creds.delete", user: logSubject(sub) }, "credentialStore: deleted");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  });
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
  return { binance: openAccounts(rec.binance), luno: openAccounts(rec.luno) };
}

/**
 * Decrypt one exchange for the signed-in user. Returns null when encryption
 * is not configured, the user has no file, or that exchange has no links.
 * A corrupt seal throws status 503 with a message that contains no secrets.
 */
export async function loadDecryptedExchange(
  sub: string,
  exchange: Exchange,
): Promise<PlainAccount[] | null> {
  if (!isCryptoConfigured()) return null;
  const rec = await readByHash(hashFor(sub));
  if (!rec) return null;
  const sealed = exchange === "binance" ? rec.binance : rec.luno;
  if (sealed.length === 0) return null;
  try {
    return openAccounts(sealed);
  } catch {
    logger.warn(
      { op: "creds.decrypt", user: logSubject(sub), exchange },
      "credentialStore: could not decrypt stored credentials",
    );
    throw httpError(503, "Stored credentials could not be loaded");
  }
}

export interface PlaintextCredentialLink extends PlainAccount {
  exchange: Exchange;
}

export type MergePlaintextLinksResult =
  | { status: "added"; linksAdded: number; linksKept: number }
  | { status: "unchanged"; linksKept: number }
  | { status: "unreadable" }
  | { status: "undecryptable" }
  | { status: "over_limit" }
  | { status: "encryption_unavailable" };

async function readCredFileForMerge(
  hash: string,
): Promise<
  | { status: "missing" }
  | { status: "ok"; rec: CredFile }
  | { status: "unreadable" }
> {
  const target = fileForHash(hash);
  if (!target) return { status: "unreadable" };
  let raw: string;
  try {
    raw = await fs.readFile(target, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "missing" };
    }
    logger.warn({ err, op: "creds.read" }, "credentialStore: read failed");
    return { status: "unreadable" };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<CredFile>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { status: "unreadable" };
    }
    if (typeof parsed.updatedAt !== "string") return { status: "unreadable" };
    if (parsed.binance !== undefined && !Array.isArray(parsed.binance)) {
      return { status: "unreadable" };
    }
    if (parsed.luno !== undefined && !Array.isArray(parsed.luno)) {
      return { status: "unreadable" };
    }
    return {
      status: "ok",
      rec: {
        updatedAt: parsed.updatedAt,
        binance: parsed.binance ?? [],
        luno: parsed.luno ?? [],
      },
    };
  } catch (err) {
    logger.warn({ err, op: "creds.read" }, "credentialStore: read failed");
    return { status: "unreadable" };
  }
}

async function persistByHash(hash: string, rec: CredFile): Promise<void> {
  await ensureDataDir();
  const target = fileForHash(hash);
  if (!target) throw new Error("Invalid storage key");
  const tmp = `${target}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(rec), { encoding: "utf8", mode: 0o600 });
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.unlink(tmp).catch(() => undefined);
    throw err;
  }
}

/**
 * Add plaintext links into the encrypted file for an existing sha256(sub) hash.
 * Links already stored stay sealed as they are — their ciphertext is not
 * regenerated and they are never deleted. A missing or unreadable credential
 * file is not replaced. Nothing is written when every incoming id is already
 * present or when the result would exceed the per-exchange limit.
 */
export async function mergePlaintextLinksByHash(
  hash: string,
  links: PlaintextCredentialLink[],
): Promise<MergePlaintextLinksResult> {
  if (!/^[a-f0-9]{64}$/.test(hash)) return { status: "unreadable" };
  if (!isCryptoConfigured()) return { status: "encryption_unavailable" };
  return withUserWriteLock(hash, async () => {
    const loaded = await readCredFileForMerge(hash);
    if (loaded.status === "unreadable") return { status: "unreadable" as const };
    if (loaded.status === "ok") {
      try {
        openAccounts(loaded.rec.binance);
        openAccounts(loaded.rec.luno);
      } catch {
        logger.warn(
          { op: "creds.migrate" },
          "credentialStore: existing credentials could not be decrypted; leaving them unchanged",
        );
        return { status: "undecryptable" as const };
      }
    }
    const binance = [...(loaded.status === "ok" ? loaded.rec.binance : [])];
    const luno = [...(loaded.status === "ok" ? loaded.rec.luno : [])];
    let linksAdded = 0;
    let linksKept = 0;
    for (const link of links) {
      const target = link.exchange === "binance" ? binance : luno;
      if (target.some((account) => account.id === link.id)) {
        linksKept += 1;
        continue;
      }
      if (target.length >= MAX_LINKS_PER_EXCHANGE) {
        return { status: "over_limit" as const };
      }
      const sealed = sealAccounts([
        {
          id: link.id,
          name: link.name,
          apiKey: link.apiKey,
          apiSecret: link.apiSecret,
        },
      ])[0];
      if (!sealed) return { status: "unreadable" as const };
      target.push(sealed);
      linksAdded += 1;
    }
    if (linksAdded === 0) return { status: "unchanged", linksKept };
    await persistByHash(hash, {
      updatedAt: new Date().toISOString(),
      binance,
      luno,
    });
    logger.info(
      {
        op: "creds.migrate",
        linksAdded,
        linksKept,
        binance: binance.length,
        luno: luno.length,
      },
      "credentialStore: merged plaintext links into encrypted store",
    );
    return { status: "added", linksAdded, linksKept };
  });
}

/** All user hashes that have stored credentials (for the scheduler to iterate). */
export async function listUserHashes(): Promise<string[]> {
  try {
    await ensureDataDir();
    const files = await fs.readdir(dataDir());
    return files
      .filter((f) => f.endsWith(SUFFIX))
      .map((f) => f.slice(0, -SUFFIX.length))
      .filter(isStorageFileKey);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}
