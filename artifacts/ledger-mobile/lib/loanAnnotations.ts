/**
 * Per-loan user annotations: manual Luno sell rate, repayment savings goal
 * (monthly contribution or target settlement date), and the goal mode.
 *
 * These are user-entered values that don't come from any exchange, so they live
 * in AsyncStorage and sync cross-device through our api-server, keyed by the
 * Apple Sign In subject — the same last-write-wins contract as settingsStore.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { reportError, reportMessage } from "@/lib/crashReporting";
import { notifyAuthFailure } from "@/lib/authEvents";

const baseUrl = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : "";

const STORE_KEY = "ledger.loanAnnotations.v1";
const UPDATED_AT_KEY = "ledger.loanAnnotations.updatedAt";

export type GoalMode = "contribution" | "target" | "collateral";

export type LoanAnnotation = {
  /** Manual ZAR sell rate the borrowed asset was sold at on Luno. */
  sellRate?: number;
  /**
   * Total ZAR value received for the borrowed asset on Luno. Divided by the
   * total quantity borrowed to derive a FIXED sell rate (ZAR per asset unit)
   * used to drive the repayment plan.
   */
  borrowedValueZar?: number;
  /**
   * Optional custom ZAR/USDC target for repayment alerts. When set, automatic
   * "favorable vs conversion rate" notifications are suppressed — the user
   * manages their own threshold.
   */
  targetRepaymentUsdcZarRate?: number;
  /** Planned monthly repayment contribution (loan-asset units). */
  monthlyContribution?: number;
  /** Target settlement date (ISO yyyy-mm-dd). */
  targetSettleDate?: string;
  /**
   * Planned monthly contribution used to BUY collateral (display-currency
   * amount) in "Build collateral" mode, instead of paying down the debt.
   */
  monthlyCollateralContribution?: number;
  /** Which forecasting input the user is driving. */
  goalMode?: GoalMode;
};

/** Map keyed by loanId. */
export type LoanAnnotationMap = Record<string, LoanAnnotation>;

// ── change emitter ──
const listeners = new Set<() => void>();
function notify(): void {
  for (const fn of listeners) fn();
}
export function subscribeLoanAnnotations(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// Process-lifetime monotonic timestamp — wall-clock can collide within a ms,
// which would trip the server's `>=` conflict check.
let lastIssuedMs = 0;
function nextMonotonicTimestamp(): string {
  const now = Date.now();
  const next = Math.max(now, lastIssuedMs + 1);
  lastIssuedMs = next;
  return new Date(next).toISOString();
}

type TokenGetter = () => Promise<string | null>;
let tokenGetter: TokenGetter | null = null;
export function setLoanAnnotationsTokenGetter(fn: TokenGetter | null): void {
  tokenGetter = fn;
}

async function authHeader(): Promise<Record<string, string> | null> {
  if (!tokenGetter || !baseUrl) return null;
  const token = await tokenGetter();
  if (!token) return null;
  return { authorization: `Bearer ${token}` };
}

// ── local cache ──
let cache: LoanAnnotationMap | null = null;

async function readLocal(): Promise<LoanAnnotationMap> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    cache = raw ? (JSON.parse(raw) as LoanAnnotationMap) : {};
  } catch (e) {
    reportError(e, { op: "annotations.read" });
    cache = {};
  }
  return cache;
}

async function writeLocal(map: LoanAnnotationMap): Promise<void> {
  cache = map;
  await AsyncStorage.setItem(STORE_KEY, JSON.stringify(map));
}

/** All per-loan annotations (empty map when none). */
export async function readAllLoanAnnotations(): Promise<LoanAnnotationMap> {
  return readLocal();
}

/** Current annotations for one loan ({} when none). */
export async function getLoanAnnotation(
  loanId: string,
): Promise<LoanAnnotation> {
  const map = await readLocal();
  return map[loanId] ?? {};
}

/** Synchronous read from the in-memory cache (after a prior async read). */
export function getCachedLoanAnnotation(loanId: string): LoanAnnotation {
  return cache?.[loanId] ?? {};
}

/**
 * Merge a partial annotation for one loan, persist locally, then push to the
 * server. Undefined fields are left untouched; null clears a field.
 */
export async function setLoanAnnotation(
  loanId: string,
  patch: Partial<Record<keyof LoanAnnotation, LoanAnnotation[keyof LoanAnnotation] | null>>,
): Promise<void> {
  const map = { ...(await readLocal()) };
  const current: LoanAnnotation = { ...(map[loanId] ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    const key = k as keyof LoanAnnotation;
    if (v === null || v === undefined) {
      delete current[key];
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (current as any)[key] = v;
    }
  }
  if (Object.keys(current).length === 0) {
    delete map[loanId];
  } else {
    map[loanId] = current;
  }
  await writeLocal(map);
  notify();
  await pushAnnotations(map);
}

async function pushAnnotations(map: LoanAnnotationMap): Promise<void> {
  const headers = await authHeader();
  if (!headers) return;
  const updatedAt = nextMonotonicTimestamp();
  await AsyncStorage.setItem(UPDATED_AT_KEY, updatedAt);
  try {
    const res = await fetch(`${baseUrl}/api/loans/annotations/sync`, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ updatedAt, annotations: map }),
    });
    if (res.status === 409) {
      void hydrateLoanAnnotations();
      return;
    }
    if (res.status === 401) {
      notifyAuthFailure();
      return;
    }
    if (!res.ok) {
      reportMessage("[sync] annotations push non-ok", {
        op: "annotations.push",
        status: res.status,
      });
    }
  } catch (e) {
    reportError(e, { op: "annotations.push", reason: "network" });
  }
}

/**
 * Pull the server's annotations and adopt them when newer (or local has none).
 * Safe to call signed-out (no-op). Emits a change when local state changes.
 */
export async function hydrateLoanAnnotations(): Promise<void> {
  const headers = await authHeader();
  if (!headers) return;
  try {
    const res = await fetch(`${baseUrl}/api/loans/annotations/sync`, {
      headers,
    });
    if (res.status === 404) return;
    if (res.status === 401) {
      notifyAuthFailure();
      return;
    }
    if (!res.ok) return;
    const body = (await res.json()) as {
      updatedAt?: string;
      annotations?: LoanAnnotationMap;
    };
    if (
      typeof body?.updatedAt !== "string" ||
      typeof body.annotations !== "object" ||
      body.annotations === null
    ) {
      return;
    }
    const remoteMs = Date.parse(body.updatedAt);
    if (Number.isFinite(remoteMs) && remoteMs > lastIssuedMs) {
      lastIssuedMs = remoteMs;
    }
    const localUpdatedAt = await AsyncStorage.getItem(UPDATED_AT_KEY);
    if (localUpdatedAt && localUpdatedAt >= body.updatedAt) {
      // Local is newer or tied — push up only if strictly newer.
      if (localUpdatedAt > body.updatedAt) {
        void pushAnnotations(await readLocal());
      }
      return;
    }
    await writeLocal(body.annotations);
    await AsyncStorage.setItem(UPDATED_AT_KEY, body.updatedAt);
    notify();
  } catch (e) {
    reportError(e, { op: "annotations.hydrate" });
  }
}
