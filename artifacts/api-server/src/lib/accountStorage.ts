import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { logger } from "./logger";

// Per-user encrypted-at-rest? No — the API is gated by Apple Sign-In and HTTPS,
// and the user *is* the only reader. We store the raw JSON blob the mobile app
// sends. Filename is sha256(sub) so we never write a user identifier (which
// could contain unexpected characters) onto the filesystem.
//
// Persistence: Azure App Service Linux *containers* have an ephemeral
// filesystem — anything written under the app dir is wiped on every restart
// or redeploy, which silently destroyed cross-device sync (a second device
// would pull and get 404). Azure persists ONLY `/home`, and only when the app
// setting WEBSITES_ENABLE_APP_SERVICE_STORAGE=true. So when we detect we're on
// Azure (WEBSITE_INSTANCE_ID is injected there) we default the data dir under
// `/home`. An explicit ACCOUNT_SYNC_DIR always wins. See AZURE.md.

function resolveDataDir(): string {
  if (process.env.ACCOUNT_SYNC_DIR) return process.env.ACCOUNT_SYNC_DIR;
  if (process.env.WEBSITE_INSTANCE_ID) {
    return "/home/data/account_sync";
  }
  return path.resolve(process.cwd(), "data", "account_sync");
}

const DATA_DIR = resolveDataDir();

/** Distinct per-user blobs. Each maps to its own file so they sync independently. */
export type SyncKind = "accounts" | "settings";

export type StoredRecord = { updatedAt: string } & Record<string, unknown>;

function fileFor(sub: string, kind: SyncKind): string {
  const hash = crypto.createHash("sha256").update(sub).digest("hex");
  // "accounts" keeps the original bare filename for backwards compatibility
  // with blobs already on disk; other kinds get a suffix.
  const name = kind === "accounts" ? `${hash}.json` : `${hash}.${kind}.json`;
  return path.join(DATA_DIR, name);
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
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
