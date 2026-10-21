import type { PlainAccount } from "../credentialStore";
import { logger } from "../logger";
import { invalidateDerived } from "./derived";
import { ensureImportRunning } from "./importer";
import { collectState } from "./positions";
import { readPortfolio, recordState } from "./portfolioStore";
import type { PortfolioState } from "./types";

type Creds = { binance: PlainAccount[]; luno: PlainAccount[] };

export const REFRESH_INTERVAL_MS = 60_000;

const inFlight = new Map<string, Promise<void>>();
const lastStarted = new Map<string, number>();

/** Takes a snapshot of every connected account now. Joins a run already in progress. */
export function snapshotNow(hash: string, creds: Creds): Promise<void> {
  const existing = inFlight.get(hash);
  if (existing) return existing;
  lastStarted.set(hash, Date.now());
  const run = (async () => {
    let previous: PortfolioState | null = null;
    try {
      previous = (await readPortfolio(hash))?.latest ?? null;
    } catch (err) {
      logger.warn({ err, op: "portfolio.snapshot.previous" }, "previous portfolio could not be read");
    }
    const state = await collectState(hash, creds, previous);
    await recordState(hash, state);
    invalidateDerived(hash);
  })()
    .catch((err) => {
      logger.warn({ err, op: "portfolio.snapshot" }, "portfolio snapshot failed");
    })
    .finally(() => {
      inFlight.delete(hash);
    });
  inFlight.set(hash, run);
  return run;
}

export function isSnapshotRunning(hash: string): boolean {
  return inFlight.has(hash);
}

export function nextRefreshAllowedAt(hash: string): number {
  return (lastStarted.get(hash) ?? 0) + REFRESH_INTERVAL_MS;
}

/** Snapshot plus a history-import pass; the import keeps running in the background. */
export async function refreshUser(hash: string, creds: Creds): Promise<void> {
  await snapshotNow(hash, creds);
  void ensureImportRunning(hash, creds);
}
