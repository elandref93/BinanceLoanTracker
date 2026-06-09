import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { logger } from "./logger";

// Where per-user blobs (account sync, encrypted credentials, LTV snapshots) live.
//
// Azure hosts run from a read-only image layer (`/app`), so writing next to the
// app throws EACCES. The writable location that can be made persistent is
// `/home` (App Service: WEBSITES_ENABLE_APP_SERVICE_STORAGE=true; Container
// Apps: a volume mounted at /home). We detect Azure across BOTH App Service
// (WEBSITE_*) and Container Apps (CONTAINER_APP_*) — relying on
// WEBSITE_INSTANCE_ID alone missed Container Apps, so the app fell back to the
// unwritable `/app/data` and logged EACCES on every boot. An explicit
// ACCOUNT_SYNC_DIR always wins (used in tests/dev). See AZURE.md.
const AZURE_HOME_DIR = "/home/data/account_sync";

function isAzureHost(): boolean {
  return Boolean(
    process.env.WEBSITE_INSTANCE_ID ||
      process.env.WEBSITE_SITE_NAME ||
      process.env.CONTAINER_APP_NAME,
  );
}

export function resolveDataDir(): string {
  if (process.env.ACCOUNT_SYNC_DIR) return process.env.ACCOUNT_SYNC_DIR;
  if (isAzureHost()) return AZURE_HOME_DIR;
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
 * Tries an ordered chain of candidates and uses the first that can be created:
 *   1. the preferred location (ACCOUNT_SYNC_DIR / Azure /home / cwd),
 *   2. the Azure-writable `/home` (covers hosts we couldn't positively detect),
 *   3. an ephemeral temp dir as a last resort.
 *
 * Only permission-type failures (EACCES/EPERM/EROFS) advance to the next
 * candidate so the API keeps serving instead of 500-ing every write; any other
 * error is genuinely unexpected and is surfaced. The ephemeral temp dir does NOT
 * persist across restarts, so landing there is logged once — at `warn`, NOT
 * `error`: it's an environment/config condition, not a code defect, and logging
 * it at `error` would mirror it into Sentry as a recurring non-actionable issue
 * (see lib/logger.ts). The durable fix is a persistent writable `/home` (see
 * AZURE.md) or an explicit ACCOUNT_SYNC_DIR.
 */
export async function ensureDataDir(): Promise<string> {
  if (ensured) return activeDir;
  const preferred = resolveDataDir();
  const ephemeral = path.join(os.tmpdir(), "ledger-data", "account_sync");

  const candidates = [preferred];
  // On non-Windows hosts, try the Azure-writable /home before giving up to a
  // temp dir — even if host detection above didn't fire. (Skipped on Windows,
  // where "/home/..." would resolve to a bogus drive-relative path.)
  if (preferred !== AZURE_HOME_DIR && process.platform !== "win32") {
    candidates.push(AZURE_HOME_DIR);
  }
  candidates.push(ephemeral);

  let lastErr: unknown;
  for (const dir of candidates) {
    try {
      await fs.mkdir(dir, { recursive: true });
      activeDir = dir;
      ensured = true;
      if (dir === ephemeral && dir !== preferred && !warned) {
        warned = true;
        logger.warn(
          { lastErr, preferred, fallback: ephemeral, op: "datadir.fallback" },
          "data dir not writable; using EPHEMERAL fallback (data will NOT " +
            "survive restarts). Set ACCOUNT_SYNC_DIR to a writable persistent " +
            "path, or make /home persistent (App Service: " +
            "WEBSITES_ENABLE_APP_SERVICE_STORAGE=true; Container Apps: mount a " +
            "volume at /home). See AZURE.md.",
        );
      }
      return activeDir;
    } catch (err) {
      lastErr = err;
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EACCES" && code !== "EPERM" && code !== "EROFS") throw err;
    }
  }
  // Unreachable in practice (the temp dir is virtually always writable), but
  // honor the contract rather than returning a dir we failed to create.
  throw lastErr;
}
