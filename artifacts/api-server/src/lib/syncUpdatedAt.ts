export type SyncClockSource = "client" | "server";

/**
 * Mobile sends `updatedAt` and that exact string stays the conflict key.
 * Web omits it. The server then assigns its own clock so a browser timestamp
 * cannot win or lose against the phone.
 */
export function chooseSyncUpdatedAt(
  clientUpdatedAt: string | undefined,
  now: Date,
): { updatedAt: string; source: SyncClockSource } {
  if (clientUpdatedAt !== undefined) {
    return { updatedAt: clientUpdatedAt, source: "client" };
  }
  return { updatedAt: now.toISOString(), source: "server" };
}

/**
 * Stored timestamp wins ties. Comparison is lexicographic on the ISO-8601
 * strings the mobile app already sends — not a reparsed Date — so the
 * installed client's last-write-wins behavior stays the same.
 */
export function isRejectedSyncWrite(
  existingUpdatedAt: string,
  incomingUpdatedAt: string,
): boolean {
  return existingUpdatedAt >= incomingUpdatedAt;
}
