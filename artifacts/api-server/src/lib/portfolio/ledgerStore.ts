import { withUserWriteLock } from "../userWriteLock";
import { readSealed, writeSealed } from "./sealedStore";
import type { ExchangeId, LedgerEvent } from "./types";

const SUFFIX = ".ledger.enc";

export type ImportState = "unavailable" | "pending" | "running" | "partial" | "complete" | "error";

export interface SourceCursor {
  key: string;
  exchange: ExchangeId;
  linkId: string;
  linkName: string;
  source: string;
  state: ImportState;
  rows: number;
  /** Oldest instant covered so far (backfill walks this back to the floor). */
  coveredFrom: number | null;
  /** Newest instant covered so far (incremental sync walks this forward). */
  coveredTo: number | null;
  backfillDone: boolean;
  error: string | null;
  updatedAt: number;
  /** Source-specific progress, e.g. last trade id per symbol or next row per wallet. */
  extra?: Record<string, number>;
}

export interface LedgerFile {
  v: 1;
  /** Bumped on every write so derived results can be cached safely. */
  revision: number;
  events: LedgerEvent[];
  cursors: Record<string, SourceCursor>;
  startedAt: number | null;
  finishedAt: number | null;
  notes: string[];
}

export function emptyLedger(): LedgerFile {
  return { v: 1, revision: 0, events: [], cursors: {}, startedAt: null, finishedAt: null, notes: [] };
}

export async function readLedger(hash: string): Promise<LedgerFile | null> {
  const file = await readSealed<LedgerFile>(hash, SUFFIX);
  if (!file || file.v !== 1) return null;
  return {
    ...emptyLedger(),
    ...file,
    events: Array.isArray(file.events) ? file.events : [],
    cursors: file.cursors ?? {},
    notes: Array.isArray(file.notes) ? file.notes : [],
  };
}

/**
 * Applies `update` to the latest stored ledger under the user lock. New
 * events replace stored ones with the same id, so re-importing a window is
 * harmless.
 */
export async function updateLedger(
  hash: string,
  update: (file: LedgerFile) => { events?: LedgerEvent[]; cursors?: SourceCursor[]; patch?: Partial<Omit<LedgerFile, "events" | "cursors">> },
): Promise<LedgerFile> {
  return withUserWriteLock(hash, async () => {
    const file = (await readLedger(hash)) ?? emptyLedger();
    const change = update(file);
    if (change.events && change.events.length > 0) {
      const byId = new Map(file.events.map((event) => [event.id, event]));
      for (const event of change.events) byId.set(event.id, event);
      file.events = [...byId.values()].sort((a, b) => a.t - b.t);
    }
    for (const cursor of change.cursors ?? []) file.cursors[cursor.key] = cursor;
    Object.assign(file, change.patch ?? {});
    file.revision += 1;
    await writeSealed(hash, SUFFIX, file);
    return file;
  });
}

export function overallState(file: LedgerFile | null): { state: ImportState; progress: number } {
  const cursors = Object.values(file?.cursors ?? {});
  if (cursors.length === 0) return { state: file ? "pending" : "unavailable", progress: 0 };
  const usable = cursors.filter((cursor) => cursor.state !== "unavailable");
  if (usable.length === 0) return { state: "unavailable", progress: 0 };
  const done = usable.filter((cursor) => cursor.backfillDone).length;
  const progress = done / usable.length;
  if (usable.some((cursor) => cursor.state === "running")) return { state: "running", progress };
  if (usable.every((cursor) => cursor.state === "error")) return { state: "error", progress };
  if (done === usable.length) return { state: usable.some((cursor) => cursor.state === "error") ? "partial" : "complete", progress: 1 };
  return { state: "partial", progress };
}
