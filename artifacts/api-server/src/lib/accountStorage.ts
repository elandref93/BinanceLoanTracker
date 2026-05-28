import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { logger } from "./logger";

// Per-user encrypted-at-rest? No — the API is gated by Apple Sign-In and HTTPS,
// and the user *is* the only reader. We store the raw JSON blob the mobile app
// sends. Filename is sha256(sub) so we never write a user identifier (which
// could contain unexpected characters) onto the filesystem.

const DATA_DIR =
  process.env.ACCOUNT_SYNC_DIR ?? path.resolve(process.cwd(), "data", "account_sync");

export type SyncBlob = {
  /** ISO timestamp of the writing device's last local mutation. */
  updatedAt: string;
  /** Opaque payload — the mobile app owns this shape. */
  containers: unknown;
};

function fileFor(sub: string): string {
  const hash = crypto.createHash("sha256").update(sub).digest("hex");
  return path.join(DATA_DIR, `${hash}.json`);
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export async function readSyncBlob(sub: string): Promise<SyncBlob | null> {
  try {
    const raw = await fs.readFile(fileFor(sub), "utf8");
    const parsed = JSON.parse(raw) as SyncBlob;
    if (typeof parsed?.updatedAt !== "string") return null;
    return parsed;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    logger.warn({ err, code }, "accountStorage: read failed");
    return null;
  }
}

export async function writeSyncBlob(sub: string, blob: SyncBlob): Promise<void> {
  await ensureDir();
  const target = fileFor(sub);
  const tmp = `${target}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  const body = JSON.stringify(blob);
  await fs.writeFile(tmp, body, { encoding: "utf8", mode: 0o600 });
  await fs.rename(tmp, target);
}
