import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getDataDir, ensureDataDir } from "./dataDir";
import { logger } from "./logger";

// Server-computed LTV snapshots, one file per user (sha256(sub).ltv.json). The
// scheduler writes these; the app reads them via GET /api/ltv/snapshot so it has
// fresh data even when it was closed during the computation.

const SUFFIX = ".ltv.json";
export const MAX_HISTORY = 500;

export interface LtvPoint {
  t: string;
  ltv: number;
}

export interface LtvSnapshot {
  updatedAt: string;
  asOf: string;
  aggregateLtv: number;
  totalDebtUsd: number;
  totalCollateralUsd: number;
  history: LtvPoint[];
}

function hashFor(sub: string): string {
  return crypto.createHash("sha256").update(sub).digest("hex");
}

function fileForHash(hash: string): string {
  return path.join(getDataDir(), `${hash}${SUFFIX}`);
}

export async function readSnapshotByHash(
  hash: string,
): Promise<LtvSnapshot | null> {
  try {
    const raw = await fs.readFile(fileForHash(hash), "utf8");
    const p = JSON.parse(raw) as Partial<LtvSnapshot>;
    if (typeof p?.updatedAt !== "string") return null;
    return {
      updatedAt: p.updatedAt,
      asOf: typeof p.asOf === "string" ? p.asOf : p.updatedAt,
      aggregateLtv: typeof p.aggregateLtv === "number" ? p.aggregateLtv : 0,
      totalDebtUsd: typeof p.totalDebtUsd === "number" ? p.totalDebtUsd : 0,
      totalCollateralUsd:
        typeof p.totalCollateralUsd === "number" ? p.totalCollateralUsd : 0,
      history: Array.isArray(p.history) ? p.history : [],
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    logger.warn({ err, op: "ltv.read" }, "ltvSnapshot: read failed");
    return null;
  }
}

export async function readSnapshot(sub: string): Promise<LtvSnapshot | null> {
  return readSnapshotByHash(hashFor(sub));
}

export async function writeSnapshotByHash(
  hash: string,
  snap: LtvSnapshot,
): Promise<void> {
  await ensureDataDir();
  const target = fileForHash(hash);
  const tmp = `${target}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(snap), {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.rename(tmp, target);
}
