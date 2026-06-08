import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { logger } from "./logger";

// Where per-user blobs (account sync, encrypted credentials, LTV snapshots) live.
//
// Azure App Service Linux containers have an ephemeral filesystem — only `/home`
// survives restarts/redeploys, and only with WEBSITES_ENABLE_APP_SERVICE_STORAGE
// =true. We detect Azure via WEBSITE_INSTANCE_ID. An explicit ACCOUNT_SYNC_DIR
// always wins (used in tests/dev). See AZURE.md.
export function resolveDataDir(): string {
  if (process.env.ACCOUNT_SYNC_DIR) return process.env.ACCOUNT_SYNC_DIR;
  if (process.env.WEBSITE_INSTANCE_ID) {
    return "/home/data/account_sync";
  }
  return path.resolve(process.cwd(), "data", "account_sync");
}

// The directory actually in use. Starts at the preferred location and is replaced
// with an ephemeral fallback by ensureDataDir() if the preferred one can't be
// created (see below). All readers/writers must build paths from getDataDir() so
// reads and writes always agree on the location.
let activeDir = resolveDataDir();
let ensured = false;
let warned = false;

/** Directory currently in use for reads/writes (may be the ephemeral fallback). */
export function getDataDir(): string {
  return activeDir;
}

/**
 * Ensure the data directory exists and is writable. Cached after the first call.
 *
 * If the preferred location can't be created — e.g. Azure mounts `/home` but the
 * app runs as a non-root user without WEBSITES_ENABLE_APP_SERVICE_STORAGE, so
 * `mkdir /home/data` throws EACCES — we fall back to an ephemeral temp dir so the
 * API keeps serving instead of 500-ing every write. The fallback does NOT persist
 * across restarts; we log a loud error once so the degraded state is never silent.
 * The durable fix is enabling Azure App Service storage (see AZURE.md).
 */
export async function ensureDataDir(): Promise<string> {
  if (ensured) return activeDir;
  const preferred = resolveDataDir();
  try {
    await fs.mkdir(preferred, { recursive: true });
    activeDir = preferred;
    ensured = true;
    return activeDir;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EACCES" && code !== "EPERM" && code !== "EROFS") throw err;
    const fallback = path.join(os.tmpdir(), "ledger-data", "account_sync");
    await fs.mkdir(fallback, { recursive: true });
    activeDir = fallback;
    ensured = true;
    if (!warned) {
      warned = true;
      logger.error(
        { err, code, preferred, fallback, op: "datadir.fallback" },
        "data dir not writable; using EPHEMERAL fallback (data will NOT survive " +
          "restarts). On Azure set WEBSITES_ENABLE_APP_SERVICE_STORAGE=true so " +
          "/home persists and is writable.",
      );
    }
    return activeDir;
  }
}
