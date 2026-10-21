import { withUserWriteLock } from "../userWriteLock";
import { appendPoint, compactHistory, mergeStatementHistory, toHistoryPoint } from "./history";
import { repairPeresecHistory } from "./perecRepair";
import { readSealed, writeSealed } from "./sealedStore";
import type { HistoryPoint, PortfolioState } from "./types";

const SUFFIX = ".portfolio.enc";

export interface PortfolioFile {
  v: 1;
  latest: PortfolioState | null;
  points: HistoryPoint[];
}

export async function readPortfolio(hash: string): Promise<PortfolioFile | null> {
  const file = await readSealed<PortfolioFile>(hash, SUFFIX);
  if (!file || file.v !== 1) return null;
  return { v: 1, latest: file.latest ?? null, points: Array.isArray(file.points) ? file.points : [] };
}

/**
 * Replaces history under the user lock and leaves the latest snapshot as it is.
 * `update` returns null when nothing should be written.
 */
export async function updateHistory(
  hash: string,
  update: (file: PortfolioFile) => HistoryPoint[] | null,
): Promise<boolean> {
  return withUserWriteLock(hash, async () => {
    const current = await readPortfolio(hash);
    if (!current?.latest) return false;
    const next = update(current);
    if (!next) return false;
    await writeSealed(hash, SUFFIX, {
      v: 1,
      latest: current.latest,
      points: compactHistory(next, current.latest.asOf),
    } satisfies PortfolioFile);
    return true;
  });
}

/** Saves the new state and appends a compacted history point, under the user lock. */
export async function recordState(hash: string, state: PortfolioState): Promise<void> {
  await withUserWriteLock(hash, async () => {
    const current = (await readPortfolio(hash)) ?? { v: 1 as const, latest: null, points: [] };
    const hasData = state.positions.length > 0 || state.debts.length > 0;
    // A snapshot where every account failed would look like a crash to zero.
    if (!hasData && state.errors.length > 0 && current.latest) return;
    await writeSealed(hash, SUFFIX, {
      v: 1,
      latest: state,
      points: compactHistory(
        repairPeresecHistory(mergeStatementHistory(appendPoint(current.points, toHistoryPoint(state)), state), state.statementSeries).points,
        state.asOf,
      ),
    } satisfies PortfolioFile);
  });
}
