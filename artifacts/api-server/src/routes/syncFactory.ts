import { Router, type IRouter } from "express";
import { z } from "zod";
import { readRecord, writeRecord, type SyncKind } from "../lib/accountStorage";
import { logger } from "../lib/logger";

// Shared implementation for the per-user "blob sync" endpoints (accounts +
// settings). Both follow the same contract: GET returns the stored record,
// PUT does an atomic per-user last-write-wins update keyed by client
// `updatedAt`, returning 409 + the current record when the incoming push is
// older (so the device re-pulls instead of clobbering).

type Options = {
  kind: SyncKind;
  /** The field name carrying the opaque payload, e.g. "containers"/"settings". */
  payloadKey: string;
  /** Reject obviously-wrong payload shapes before persisting. */
  validatePayload: (v: unknown) => boolean;
};

const Body = z
  .object({ updatedAt: z.string().min(1).max(64) })
  .passthrough();

export function makeSyncRouter({
  kind,
  payloadKey,
  validatePayload,
}: Options): IRouter {
  const router: IRouter = Router();

  // Per-user serialization so read-compare-write is atomic per `sub`, even
  // when two devices race a PUT (Node interleaves at await boundaries).
  const userLocks = new Map<string, Promise<unknown>>();
  function withUserLock<T>(sub: string, fn: () => Promise<T>): Promise<T> {
    const prev = userLocks.get(sub) ?? Promise.resolve();
    const chained = prev.then(fn, fn);
    const tail = chained.catch(() => undefined);
    userLocks.set(sub, tail);
    void tail.then(() => {
      if (userLocks.get(sub) === tail) userLocks.delete(sub);
    });
    return chained;
  }

  router.get("/sync", async (req, res) => {
    const sub = req.userId;
    if (!sub) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const rec = await readRecord(sub, kind);
    if (!rec) {
      logger.info(
        { op: "sync.get", kind, userId: sub, hit: false, status: 404 },
        `${kind}/sync miss`,
      );
      res.status(404).json({ error: "No synced data" });
      return;
    }
    logger.info(
      { op: "sync.get", kind, userId: sub, hit: true, status: 200 },
      `${kind}/sync hit`,
    );
    res.json(rec);
  });

  router.put("/sync", async (req, res) => {
    const sub = req.userId;
    if (!sub) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      logger.warn(
        {
          op: "sync.put",
          kind,
          userId: sub,
          status: 400,
          reason: "invalid-body",
          issues: parsed.error.issues.map((i) => i.code),
        },
        `${kind}/sync rejected (invalid body)`,
      );
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const payload = (parsed.data as Record<string, unknown>)[payloadKey];
    if (!validatePayload(payload)) {
      logger.warn(
        {
          op: "sync.put",
          kind,
          userId: sub,
          status: 400,
          reason: "invalid-payload-shape",
        },
        `${kind}/sync rejected (invalid ${payloadKey} shape)`,
      );
      res.status(400).json({ error: `${payloadKey} has an invalid shape` });
      return;
    }
    // Item count only — never the payload contents.
    const itemCount = Array.isArray(payload)
      ? payload.length
      : payload && typeof payload === "object"
        ? Object.keys(payload).length
        : 0;
    try {
      const outcome = await withUserLock(sub, async () => {
        const existing = await readRecord(sub, kind);
        // Strict `>=` so equal timestamps don't silently overwrite — the
        // tying client re-pulls and retries with a fresh monotonic timestamp.
        if (existing && existing.updatedAt >= parsed.data.updatedAt) {
          return { kind: "conflict" as const, existing };
        }
        await writeRecord(sub, kind, {
          updatedAt: parsed.data.updatedAt,
          [payloadKey]: payload,
        });
        return { kind: "ok" as const };
      });
      if (outcome.kind === "conflict") {
        logger.warn(
          {
            op: "sync.put",
            kind,
            userId: sub,
            status: 409,
            reason: "stale",
            incomingUpdatedAt: parsed.data.updatedAt,
            existingUpdatedAt: outcome.existing.updatedAt,
          },
          `${kind}/sync rejected (conflict)`,
        );
        res.status(409).json(outcome.existing);
        return;
      }
      logger.info(
        {
          op: "sync.put",
          kind,
          userId: sub,
          status: 200,
          items: itemCount,
          updatedAt: parsed.data.updatedAt,
        },
        `${kind}/sync accepted (ok)`,
      );
      res.json({ ok: true, updatedAt: parsed.data.updatedAt });
    } catch (err) {
      logger.error(
        { err, op: "sync.put", kind, userId: sub, status: 500 },
        `${kind}/sync PUT failed`,
      );
      res.status(500).json({ error: "Failed to persist sync blob" });
    }
  });

  return router;
}
