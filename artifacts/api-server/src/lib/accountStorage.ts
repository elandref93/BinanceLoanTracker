import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getDataDir, ensureDataDir } from "./dataDir";
import { logger } from "./logger";
import { isDirectStorageKey } from "./profileStorageKey";
import { isStorageFileKey, userStorageKey } from "./userWriteLock";
import { logSubject } from "./logger";

// Per-user encrypted-at-rest? No — the API is gated by Apple Sign-In and HTTPS,
// and the user *is* the only reader. We store the raw JSON blob the mobile app
// sends. Filename is sha256(sub) so we never write a user identifier (which
// could contain unexpected characters) onto the filesystem.
//
// Persistence/data-dir resolution (Azure /home, ACCOUNT_SYNC_DIR override) is
// shared with credential + snapshot storage in ./dataDir.

/**
 * Distinct per-user blobs. Each maps to its own file so they sync independently.
 * `scenarios` is the strategy list. It is not part of settings: the phone
 * replaces that blob from currency, LTV targets, and alert rules.
 */
export type SyncKind = "accounts" | "settings" | "annotations" | "scenarios";

export type StoredRecord = { updatedAt: string } & Record<string, unknown>;

function fileForHash(hash: string, kind: SyncKind): string | null {
  if (!isStorageFileKey(hash)) return null;
  // "accounts" keeps the original bare filename for backwards compatibility
  // with blobs already on disk; other kinds get a suffix.
  const name = kind === "accounts" ? `${hash}.json` : `${hash}.${kind}.json`;
  return path.join(getDataDir(), name);
}

function fileFor(sub: string, kind: SyncKind): string | null {
  // userStorageKey hashes ordinary Apple subs. The pinned web profile id is
  // already the on-disk filename, so reads and writes use that key directly.
  return fileForHash(userStorageKey(sub), kind);
}

async function ensureDir(): Promise<void> {
  await ensureDataDir();
}

export async function readRecord(
  sub: string,
  kind: SyncKind,
): Promise<StoredRecord | null> {
  const target = fileFor(sub, kind);
  if (!target) return null;
  try {
    const raw = await fs.readFile(target, "utf8");
    const parsed = JSON.parse(raw) as StoredRecord;
    if (typeof parsed?.updatedAt !== "string") return null;
    return parsed;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      logger.info(
        { op: "storage.read", kind, user: logSubject(sub), hit: false, dataDir: getDataDir(), direct: isDirectStorageKey(sub) },
        "accountStorage: read miss",
      );
      return null;
    }
    logger.warn(
      { err, code, op: "storage.read", kind, user: logSubject(sub) },
      "accountStorage: read failed",
    );
    return null;
  }
}

/**
 * Read a stored record directly by its on-disk hash (sha256(sub)). Used by the
 * scheduler, which iterates credential files and only has the hash — never the
 * raw `sub`. The hash convention is identical across credential / snapshot /
 * blob storage, so a credential file's hash maps to the same user's blobs.
 */
export async function readRecordByHash(
  hash: string,
  kind: SyncKind,
): Promise<StoredRecord | null> {
  const target = fileForHash(hash, kind);
  if (!target) return null;
  try {
    const raw = await fs.readFile(target, "utf8");
    const parsed = JSON.parse(raw) as StoredRecord;
    if (typeof parsed?.updatedAt !== "string") return null;
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    logger.warn(
      { err, op: "storage.readByHash", kind },
      "accountStorage: read-by-hash failed",
    );
    return null;
  }
}

/**
 * True when this Apple `sub` already has an identity-bearing blob on disk
 * (account, settings, or annotation sync, encrypted credentials, or an LTV
 * snapshot). Used by Apple identity linking so a new Expo Go `sub` is aliased
 * onto the established TestFlight user rather than the other way around.
 * Scenario files are omitted on purpose: they must not change which profile
 * is treated as canonical.
 */
export async function hasPersistedUserData(sub: string): Promise<boolean> {
  await ensureDir();
  const hash = userStorageKey(sub);
  if (!isStorageFileKey(hash)) return false;
  const dir = getDataDir();
  const candidates = [
    fileForHash(hash, "accounts"),
    fileForHash(hash, "settings"),
    fileForHash(hash, "annotations"),
    path.join(dir, `${hash}.creds.json`),
    path.join(dir, `${hash}.ltv.json`),
  ];
  for (const target of candidates) {
    if (!target) continue;
    try {
      await fs.access(target);
      return true;
    } catch {
      // ENOENT / not readable — try the next candidate
    }
  }
  return false;
}

export async function writeRecord(
  sub: string,
  kind: SyncKind,
  rec: StoredRecord,
): Promise<void> {
  await ensureDir();
  const target = fileFor(sub, kind);
  if (!target) throw new Error("Invalid storage key");
  const tmp = `${target}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  const body = JSON.stringify(rec);
  const bytes = Buffer.byteLength(body, "utf8");
  try {
    await fs.writeFile(tmp, body, { encoding: "utf8", mode: 0o600 });
    await fs.rename(tmp, target);
    logger.info(
      { op: "storage.write", kind, user: logSubject(sub), bytes },
      "accountStorage: write+rename ok",
    );
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    logger.error(
      { err, code, op: "storage.write", kind, user: logSubject(sub), bytes },
      "accountStorage: write+rename failed",
    );
    throw err;
  }
}
