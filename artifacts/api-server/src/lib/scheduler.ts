import cron, { type ScheduledTask } from "node-cron";
import {
  listUserHashes,
  loadDecryptedByHash,
} from "./credentialStore";
import { buildBinanceClient, computeLoanSummary } from "./loanCompute";
import {
  readSnapshotByHash,
  writeSnapshotByHash,
  MAX_HISTORY,
} from "./ltvSnapshot";
import { isCryptoConfigured } from "./secretCrypto";
import { logger } from "./logger";

// Periodically recomputes each user's Binance LTV from their stored (encrypted)
// credentials and writes a snapshot. This is what makes data fresh even when the
// app is fully closed.
//
// In-process cron requires the host to stay running. On Azure App Service enable
// "Always On" (otherwise the container idles out and the schedule stops). For 3
// users a single instance is fine; multiple instances would just recompute the
// same snapshot harmlessly.

const SCHEDULE = "*/15 * * * *"; // every 15 minutes

let task: ScheduledTask | null = null;
let running = false;

export async function runOnce(): Promise<void> {
  if (running) {
    logger.info({ op: "scheduler.skip" }, "previous LTV run still in progress");
    return;
  }
  running = true;
  try {
    // Guard the outer work too: if listUserHashes()/readdir throws something
    // other than ENOENT, we must not let it escape as an unhandled rejection.
    const hashes = await listUserHashes();
    for (const hash of hashes) {
      try {
        const creds = await loadDecryptedByHash(hash);
        if (!creds || creds.binance.length === 0) continue;
        const client = buildBinanceClient(creds.binance);
        const summary = await computeLoanSummary(client);
        const prev = await readSnapshotByHash(hash);
        const history = [
          ...(prev?.history ?? []),
          { t: summary.asOf, ltv: summary.aggregateLtv },
        ].slice(-MAX_HISTORY);
        await writeSnapshotByHash(hash, {
          updatedAt: new Date().toISOString(),
          asOf: summary.asOf,
          aggregateLtv: summary.aggregateLtv,
          totalDebtUsd: summary.totalDebtUsd,
          totalCollateralUsd: summary.totalCollateralUsd,
          history,
        });
      } catch (err) {
        logger.warn(
          { err, op: "scheduler.user" },
          "scheduled LTV compute failed for one user",
        );
      }
    }
  } catch (err) {
    logger.error(
      { err, op: "scheduler.run" },
      "scheduled LTV run failed before/while enumerating users",
    );
  } finally {
    running = false;
  }
}

export function startScheduler(): void {
  if (task) return;
  if (process.env.NODE_ENV === "test") return;
  if (!isCryptoConfigured()) {
    logger.warn(
      { op: "scheduler.init" },
      "CREDENTIAL_ENCRYPTION_KEY not set — scheduled LTV compute disabled",
    );
    return;
  }
  task = cron.schedule(SCHEDULE, () => {
    // runOnce() guards its own body, but belt-and-suspenders: never let a
    // rejected promise escape the cron callback as an unhandled rejection.
    void runOnce().catch((err) => {
      logger.error({ err, op: "scheduler.tick" }, "scheduled LTV tick failed");
    });
  });
  logger.info(
    { op: "scheduler.init", schedule: SCHEDULE },
    "scheduled LTV compute started",
  );
}
