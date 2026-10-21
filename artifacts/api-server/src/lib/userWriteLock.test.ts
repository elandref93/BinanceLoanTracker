import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isStorageFileKey, withUserWriteLock } from "./userWriteLock";

describe("isStorageFileKey", () => {
  it("isStorageFileKey_pathSegments_rejected", () => {
    assert.equal(isStorageFileKey("../secrets"), false);
    assert.equal(isStorageFileKey("..\\secrets"), false);
    assert.equal(isStorageFileKey("g".repeat(64)), false);
    assert.equal(isStorageFileKey("a".repeat(64)), true);
  });
});

describe("withUserWriteLock", () => {
  it("withUserWriteLock_overlappingReadModifyWrite_keepsEveryIncrement", async () => {
    let value = 0;
    async function bump(): Promise<void> {
      await withUserWriteLock("user-a", async () => {
        const current = value;
        await new Promise((resolve) => setTimeout(resolve, 15));
        value = current + 1;
      });
    }
    await Promise.all([bump(), bump(), bump()]);
    assert.equal(value, 3);
  });
});
