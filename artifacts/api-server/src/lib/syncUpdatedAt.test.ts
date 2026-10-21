import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { chooseSyncUpdatedAt, isRejectedSyncWrite } from "./syncUpdatedAt";

describe("chooseSyncUpdatedAt", () => {
  it("chooseSyncUpdatedAt_clientValue_isStoredVerbatim", () => {
    const chosen = chooseSyncUpdatedAt("2026-01-01T00:00:00.000Z", new Date("2026-06-01T00:00:00.000Z"));
    assert.deepEqual(chosen, {
      updatedAt: "2026-01-01T00:00:00.000Z",
      source: "client",
    });
  });

  it("chooseSyncUpdatedAt_omitted_assignsServerTime", () => {
    const now = new Date("2026-06-01T12:30:00.000Z");
    const chosen = chooseSyncUpdatedAt(undefined, now);
    assert.deepEqual(chosen, {
      updatedAt: "2026-06-01T12:30:00.000Z",
      source: "server",
    });
  });
});

describe("isRejectedSyncWrite", () => {
  it("isRejectedSyncWrite_olderOrEqual_rejects", () => {
    assert.equal(
      isRejectedSyncWrite("2026-01-02T00:00:00.000Z", "2026-01-01T00:00:00.000Z"),
      true,
    );
    assert.equal(
      isRejectedSyncWrite("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"),
      true,
    );
  });

  it("isRejectedSyncWrite_newer_accepts", () => {
    assert.equal(
      isRejectedSyncWrite("2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z"),
      false,
    );
  });
});
