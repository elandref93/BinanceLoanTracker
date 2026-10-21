import { Router, type IRouter } from "express";
import { z } from "zod";
import { readRecord, writeRecord, type SyncKind } from "../lib/accountStorage";
import { logger, logSubject } from "../lib/logger";
import { chooseSyncUpdatedAt, isRejectedSyncWrite } from "../lib/syncUpdatedAt";
import { stripAccountSyncSecrets } from "../lib/stripAccountSecrets";
import { userStorageKey, withUserWriteLock } from "../lib/userWriteLock";

// Shared implementation for the per-user blob sync endpoints (accounts,
// settings, annotations, and strategy scenarios). GET returns the stored record,
// PUT does an atomic per-user last-write-wins update. Mobile sends `updatedAt`
// and that string is compared as-is (equal timestamps conflict, so the phone
// re-pulls). Web omits `updatedAt`; the server assigns its clock and the same
// comparison still applies, so a phone write that is already newer wins.

type Options = {
  kind: SyncKind;
  /** The field name carrying the opaque payload, e.g. "containers"/"settings". */
  payloadKey: string;
  /** Reject obviously-wrong payload shapes before persisting. */
  validatePayload: (v: unknown) => boolean;
  /**
   * Optional transform applied to the payload before it is written.
   * Account sync uses this to drop exchange secrets. The client's
   * `updatedAt` is unchanged.
   */
  sanitizePayload?: (payload: unknown) => unknown;
};

const Body = z
  .object({ updatedAt: z.string().min(1).max(64).optional() })
  .passthrough();

export function makeSyncRouter({
  kind,
  payloadKey,
  validatePayload,
  sanitizePayload,
}: Options): IRouter {
  const router: IRouter = Router();

  router.get("/sync", async (req, res) => {
    const sub = req.userId;
    if (!sub) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const rec = await readRecord(sub, kind);
    if (!rec) {
      logger.info(
        { op: "sync.get", kind, user: logSubject(sub), hit: false, status: 404 },
        `${kind}/sync miss`,
      );
      res.status(404).json({ error: "No synced data" });
      return;
    }
    logger.info(
      { op: "sync.get", kind, user: logSubject(sub), hit: true, status: 200 },
      `${kind}/sync hit`,
    );
    res.json(stripAccountSyncSecrets(rec));
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
          user: logSubject(sub),
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
          user: logSubject(sub),
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
    const clock = chooseSyncUpdatedAt(parsed.data.updatedAt, new Date());
    try {
      const outcome = await withUserWriteLock(userStorageKey(sub), async () => {
        const existing = await readRecord(sub, kind);
        // Strict `>=` so equal timestamps don't silently overwrite — the
        // tying client re-pulls and retries with a fresh monotonic timestamp.
        if (existing && isRejectedSyncWrite(existing.updatedAt, clock.updatedAt)) {
          return { kind: "conflict" as const, existing };
        }
        const storedPayload = stripAccountSyncSecrets(
          sanitizePayload ? sanitizePayload(payload) : payload,
        );
        await writeRecord(sub, kind, {
          updatedAt: clock.updatedAt,
          [payloadKey]: storedPayload,
        });
        return { kind: "ok" as const };
      });
      if (outcome.kind === "conflict") {
        logger.warn(
          {
            op: "sync.put",
            kind,
            user: logSubject(sub),
            status: 409,
            reason: "stale",
            incomingUpdatedAt: clock.updatedAt,
            clockSource: clock.source,
            existingUpdatedAt: outcome.existing.updatedAt,
          },
          `${kind}/sync rejected (conflict)`,
        );
        res.status(409).json(stripAccountSyncSecrets(outcome.existing));
        return;
      }
      logger.info(
        {
          op: "sync.put",
          kind,
          user: logSubject(sub),
          status: 200,
          items: itemCount,
          updatedAt: clock.updatedAt,
          clockSource: clock.source,
        },
        `${kind}/sync accepted (ok)`,
      );
      res.json({ ok: true, updatedAt: clock.updatedAt });
    } catch (err) {
      logger.error(
        { err, op: "sync.put", kind, user: logSubject(sub), status: 500 },
        `${kind}/sync PUT failed`,
      );
      res.status(500).json({ error: "Failed to persist sync blob" });
    }
  });

  return router;
}
