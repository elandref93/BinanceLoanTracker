import { Router, type IRouter } from "express";
import { z } from "zod";
import { readSyncBlob, writeSyncBlob } from "../lib/accountStorage";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Per-user serialization. Express + Node is single-threaded, but PUT handlers
// for the SAME user can interleave at any `await` boundary — so two devices
// racing a write would both read the same "old" blob, both pass the 409
// check, and the later rename silently wins. We chain each user's writes
// through their own promise so read-compare-write is atomic per `sub`.
const userLocks = new Map<string, Promise<unknown>>();
function withUserLock<T>(sub: string, fn: () => Promise<T>): Promise<T> {
  const prev = userLocks.get(sub) ?? Promise.resolve();
  // Swallow rejections on the chain so one failure doesn't poison the
  // next writer; the caller still observes their own rejection via `next`.
  const chained = prev.then(fn, fn);
  const tail = chained.catch(() => undefined);
  userLocks.set(sub, tail);
  // Drop the entry once we're the most recent writer AND we've settled,
  // so the map stays bounded for ephemeral users.
  void tail.then(() => {
    if (userLocks.get(sub) === tail) userLocks.delete(sub);
  });
  return chained;
}

// Last-write-wins by client-provided updatedAt. Two devices editing offline
// at the same time can lose one edit — the mobile UI keeps a local copy, so
// "lose" here means the server overwrites stale state on next push, not data
// destruction. Acceptable for a 3-user private app.

const PutBody = z.object({
  updatedAt: z.string().min(1).max(64),
  // Opaque to the server. Cap at ~200 KB so a bug can't blow up disk.
  containers: z.unknown(),
});

router.get("/sync", async (req, res) => {
  const sub = req.userId;
  if (!sub) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const blob = await readSyncBlob(sub);
  if (!blob) {
    res.status(404).json({ error: "No synced accounts" });
    return;
  }
  res.json(blob);
});

router.put("/sync", async (req, res) => {
  const sub = req.userId;
  if (!sub) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = PutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  // Reject obvious garbage shapes for `containers` — must be an array.
  if (!Array.isArray(parsed.data.containers)) {
    res.status(400).json({ error: "containers must be an array" });
    return;
  }
  try {
    const outcome = await withUserLock(sub, async () => {
      // Read-compare-write is now atomic per user thanks to withUserLock.
      // Strict `>=` so equal timestamps don't silently overwrite — the
      // tying client re-pulls and tries again with a fresh monotonic
      // timestamp produced by the mobile accountStore.
      const existing = await readSyncBlob(sub);
      if (existing && existing.updatedAt >= parsed.data.updatedAt) {
        return { kind: "conflict" as const, existing };
      }
      await writeSyncBlob(sub, {
        updatedAt: parsed.data.updatedAt,
        containers: parsed.data.containers,
      });
      return { kind: "ok" as const };
    });
    if (outcome.kind === "conflict") {
      res.status(409).json(outcome.existing);
      return;
    }
    res.json({ ok: true, updatedAt: parsed.data.updatedAt });
  } catch (err) {
    logger.error({ err }, "accounts/sync PUT failed");
    res.status(500).json({ error: "Failed to persist sync blob" });
  }
});

export default router;
