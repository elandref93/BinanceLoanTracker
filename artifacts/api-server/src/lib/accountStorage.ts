import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getDataDir, ensureDataDir } from "./dataDir";
import { logger } from "./logger";

// Per-user encrypted-at-rest? No — the API is gated by Apple Sign-In and HTTPS,
// and the user *is* the only reader. We store the raw JSON blob the mobile app
// sends. Filename is sha256(sub) so we never write a user identifier (which
// could contain unexpected characters) onto the filesystem.
//
// Persistence/data-dir resolution (Azure /home, ACCOUNT_SYNC_DIR override) is
// shared with credential + snapshot storage in ./dataDir.

/** Distinct per-user blobs. Each maps to its own file so they sync independently. */
export type SyncKind = "accounts" | "settings" | "annotations";

export type StoredRecord = { updatedAt: string } & Record<string, unknown>;

function fileForHash(hash: string, kind: SyncKind): string {
  // "accounts" keeps the original bare filename for backwards compatibility
  // with blobs already on disk; other kinds get a suffix.
  const name = kind === "accounts" ? `${hash}.json` : `${hash}.${kind}.json`;
  return path.join(getDataDir(), name);
}

function fileFor(sub: string, kind: SyncKind): string {
  const hash = crypto.createHash("sha256").update(sub).digest("hex");
  return fileForHash(hash, kind);
}

async function ensureDir(): Promise<void> {
  await ensureDataDir();
}

export async function readRecord(
  sub: string,
  kind: SyncKind,
): Promise<StoredRecord | null> {
  const target = fileFor(sub, kind);
  try {
    const raw = await fs.readFile(target, "utf8");
    const parsed = JSON.parse(raw) as StoredRecord;
    if (typeof parsed?.updatedAt !== "string") return null;
    return parsed;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      logger.info(
        { op: "storage.read", kind, userId: sub, path: target, hit: false },
        "accountStorage: read miss",
      );
      return null;
    }
    logger.warn(
      { err, code, op: "storage.read", kind, userId: sub, path: target },
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
  try {
    const raw = await fs.readFile(target, "utf8");
    const parsed = JSON.parse(raw) as StoredRecord;
    if (typeof parsed?.updatedAt !== "string") return null;
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    logger.warn(
      { err, op: "storage.readByHash", kind, path: target },
      "accountStorage: read-by-hash failed",
    );
    return null;
  }
}

export async function writeRecord(
  sub: string,
  kind: SyncKind,
  rec: StoredRecord,
): Promise<void> {
  await ensureDir();
  const target = fileFor(sub, kind);
  const tmp = `${target}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  const body = JSON.stringify(rec);
  const bytes = Buffer.byteLength(body, "utf8");
  try {
    await fs.writeFile(tmp, body, { encoding: "utf8", mode: 0o600 });
    await fs.rename(tmp, target);
    logger.info(
      { op: "storage.write", kind, userId: sub, path: target, bytes },
      "accountStorage: write+rename ok",
    );
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    logger.error(
      { err, code, op: "storage.write", kind, userId: sub, path: target, bytes },
      "accountStorage: write+rename failed",
    );
    throw err;
  }
}
