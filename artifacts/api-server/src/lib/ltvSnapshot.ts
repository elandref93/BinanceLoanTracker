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
/** Retain ~13 months of daily interest-charge buckets for the chart ranges. */
export const MAX_DAILY_CHARGE = 400;

export interface LtvPoint {
  t: string;
  ltv: number;
}

/** A daily total interest-charge bucket, accumulated server-side over time. */
export interface DailyChargePoint {
  /** UTC day, ISO date (yyyy-mm-dd…). */
  t: string;
  /** Projected interest charge for that day in USD (sum across loans). */
  usd: number;
}

/** Per Personal/Trust container LTV breakdown (keyed by the synced accounts blob). */
export interface ContainerLtv {
  containerId: string;
  name?: string;
  type?: string;
  debtUsd: number;
  collateralUsd: number;
  ltv: number;
  loanCount: number;
}

/**
 * Minimal loan shape persisted in the snapshot so the app can render the loan
 * list instantly from the server bundle. Mirrors the fields the dashboard
 * actually uses; the live `/loans` response remains the source of truth once
 * it arrives.
 */
export interface SnapshotLoan {
  id: string;
  accountId: string;
  asset: string;
  debtUsd: number;
  collateralAsset: string;
  collateralValueUsd: number;
  ltv: number;
  apr: number;
}

export interface LtvSnapshot {
  updatedAt: string;
  asOf: string;
  aggregateLtv: number;
  totalDebtUsd: number;
  totalCollateralUsd: number;
  history: LtvPoint[];
  // ── Consolidated bundle (Phase 3). All optional so older snapshots and the
  // LTV-only fast path keep validating; readers must tolerate absence. ──
  loans?: SnapshotLoan[];
  holdingsUsd?: number;
  interestLifetimeUsd?: number;
  interestProjected30dUsd?: number;
  perContainer?: ContainerLtv[];
  dailyCharge?: DailyChargePoint[];
  fxUsdToZar?: number;
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
      // Consolidated bundle — pass through verbatim when present.
      ...(Array.isArray(p.loans) ? { loans: p.loans } : {}),
      ...(typeof p.holdingsUsd === "number"
        ? { holdingsUsd: p.holdingsUsd }
        : {}),
      ...(typeof p.interestLifetimeUsd === "number"
        ? { interestLifetimeUsd: p.interestLifetimeUsd }
        : {}),
      ...(typeof p.interestProjected30dUsd === "number"
        ? { interestProjected30dUsd: p.interestProjected30dUsd }
        : {}),
      ...(Array.isArray(p.perContainer)
        ? { perContainer: p.perContainer }
        : {}),
      ...(Array.isArray(p.dailyCharge) ? { dailyCharge: p.dailyCharge } : {}),
      ...(typeof p.fxUsdToZar === "number"
        ? { fxUsdToZar: p.fxUsdToZar }
        : {}),
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
