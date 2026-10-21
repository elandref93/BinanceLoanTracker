import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { ensureDataDir, getDataDir } from "../dataDir";
import { logger } from "../logger";
import { open, seal, type Sealed } from "../secretCrypto";
import { isStorageFileKey } from "../userWriteLock";

/**
 * Per-user JSON sealed with the credential master key (AES-256-GCM). Balances
 * and transaction history are as sensitive as the keys that fetched them, so
 * they are never written in the clear. Writes are atomic (temp file, then
 * rename) with mode 0600. Callers serialise writes with withUserWriteLock.
 */
function fileFor(hash: string, suffix: string): string | null {
  if (!isStorageFileKey(hash)) return null;
  return path.join(getDataDir(), `${hash}${suffix}`);
}

export async function readSealed<T>(hash: string, suffix: string): Promise<T | null> {
  await ensureDataDir();
  const target = fileFor(hash, suffix);
  if (!target) return null;
  let raw: string;
  try {
    raw = await fs.readFile(target, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    logger.warn({ err, op: "sealed.read", suffix }, "sealed store read failed");
    return null;
  }
  try {
    const sealed = JSON.parse(raw) as Sealed;
    return JSON.parse(open(sealed)) as T;
  } catch (err) {
    logger.warn({ err, op: "sealed.open", suffix }, "sealed store could not be opened");
    return null;
  }
}

export async function writeSealed(hash: string, suffix: string, value: unknown): Promise<void> {
  await ensureDataDir();
  const target = fileFor(hash, suffix);
  if (!target) throw new Error("Invalid storage key");
  const tmp = `${target}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(seal(JSON.stringify(value))), { encoding: "utf8", mode: 0o600 });
  await fs.rename(tmp, target);
}

/** Shared, non-personal cache (public market prices). Plain JSON. */
export async function readShared<T>(name: string): Promise<T | null> {
  await ensureDataDir();
  try {
    return JSON.parse(await fs.readFile(path.join(getDataDir(), name), "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.warn({ err, op: "shared.read", name }, "shared cache read failed");
    }
    return null;
  }
}

export async function writeShared(name: string, value: unknown): Promise<void> {
  await ensureDataDir();
  const target = path.join(getDataDir(), name);
  const tmp = `${target}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
  await fs.rename(tmp, target);
}
