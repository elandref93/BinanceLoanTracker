import crypto from "node:crypto";

import { isDirectStorageKey } from "./profileStorageKey";

/**
 * In-process per-user lock for read-modify-write.
 *
 * Settings sync, credential updates, and the scheduler snapshot all write
 * JSON files with temp-file rename, which is atomic but still drops an update
 * when two writers read the same bytes and both rename. This lock serializes
 * those writers for one user inside this process. The deployment is a single
 * App Service instance; a second instance would need its own coordination.
 *
 * The key is sha256(canonical user id), the same hash used in credential and
 * snapshot filenames. The pinned web profile key is already that filename, so
 * it is returned unchanged and is not hashed again. The scheduler still
 * addresses files by hash through the ByHash readers.
 */
const tails = new Map<string, Promise<void>>();

const STORAGE_FILE_KEY = /^[a-f0-9]{64}$/;

/** True when `value` is a 64-char hex profile filename and not a path. */
export function isStorageFileKey(value: string): boolean {
  return STORAGE_FILE_KEY.test(value);
}

export function userStorageKey(sub: string): string {
  if (isDirectStorageKey(sub)) return sub;
  return crypto.createHash("sha256").update(sub).digest("hex");
}

export function withUserWriteLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}
