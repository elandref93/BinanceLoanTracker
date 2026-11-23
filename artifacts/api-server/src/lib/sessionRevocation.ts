import { promises as fs } from "node:fs";
import path from "node:path";

import { ensureDataDir, getDataDir } from "./dataDir";

type Row = { sid: string; until: number };

let chain: Promise<unknown> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function filePath(): string {
  return path.join(getDataDir(), "revoked-web-sessions.json");
}

async function readRows(): Promise<Row[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath(), "utf8")) as { sessions?: Row[] };
    const now = Date.now();
    return (parsed.sessions ?? []).filter((row) => row.until > now && typeof row.sid === "string");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    return [];
  }
}

/** Forget a browser session id until its absolute lifetime has passed. */
export function revokeWebSession(sid: string, untilMs: number): Promise<void> {
  return serialize(async () => {
    await ensureDataDir();
    const sessions = await readRows();
    if (!sessions.some((row) => row.sid === sid)) {
      sessions.push({ sid, until: untilMs });
    }
    const tmp = `${filePath()}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ sessions }), { encoding: "utf8", mode: 0o600 });
    await fs.rename(tmp, filePath());
  });
}

export function isWebSessionRevoked(sid: string): Promise<boolean> {
  return serialize(async () => {
    const sessions = await readRows();
    return sessions.some((row) => row.sid === sid);
  });
}
