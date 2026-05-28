import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "ledger.loanSnapshots.v1";
// ~30d at 15-min cadence across all loans, capped to avoid runaway storage.
// Real cadence is closer to user-triggered refresh + 15-min bg-fetch, so this
// is a safety net rather than the expected steady state.
const MAX_SAMPLES = 30 * 24 * 4 * 8;
const MIN_INTERVAL_MS = 60_000;

export type LoanSnapshot = {
  /** Epoch ms. */
  t: number;
  loanId: string;
  /** APR as a percent number (e.g. 7.91 for 7.91% APR). */
  apr: number;
  /** LTV percent (e.g. 53.2). */
  ltv: number;
  /** Debt converted to USD at the time of the snapshot. */
  debtUsd: number;
};

type LoanInput = {
  id: string;
  apr: number;
  ltv: number;
  debtUsd: number;
};

let cache: LoanSnapshot[] | null = null;

async function read(): Promise<LoanSnapshot[]> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as LoanSnapshot[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

async function write(samples: LoanSnapshot[]): Promise<void> {
  cache = samples;
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(samples));
  } catch {
    // ignore — these are observability samples, not authoritative state
  }
}

// Serialize all read-modify-write sequences. Foreground refresh and the
// background-fetch task can fire concurrently (e.g. user opens app while bg
// fetch is finishing); without a mutex the later writer would clobber the
// earlier one's additions.
let writeChain: Promise<void> = Promise.resolve();

/**
 * Append one snapshot per loan. Dedupes per-loan within MIN_INTERVAL_MS so a
 * fast double-refresh doesn't pad the buffer with near-duplicates.
 */
export async function recordLoanSnapshots(loans: LoanInput[]): Promise<void> {
  if (loans.length === 0) return;
  const run = async () => {
    const now = Date.now();
    const samples = await read();
    const lastByLoan = new Map<string, number>();
    for (const s of samples) {
      const prev = lastByLoan.get(s.loanId);
      if (prev === undefined || s.t > prev) lastByLoan.set(s.loanId, s.t);
    }
    const additions: LoanSnapshot[] = [];
    for (const l of loans) {
      if (!Number.isFinite(l.apr) || !Number.isFinite(l.ltv)) continue;
      const last = lastByLoan.get(l.id);
      if (last !== undefined && now - last < MIN_INTERVAL_MS) continue;
      additions.push({
        t: now,
        loanId: l.id,
        apr: l.apr,
        ltv: l.ltv,
        debtUsd: l.debtUsd,
      });
    }
    if (additions.length === 0) return;
    const next = [...samples, ...additions].slice(-MAX_SAMPLES);
    await write(next);
  };
  const next = writeChain.then(run, run);
  writeChain = next.catch(() => undefined);
  return next;
}

/** All snapshots within the last `days` window, oldest → newest. */
export async function getSnapshotsSince(days: number): Promise<LoanSnapshot[]> {
  const cutoff = Date.now() - days * 86_400_000;
  const samples = await read();
  return samples.filter((s) => s.t >= cutoff);
}

export async function clearLoanSnapshots(): Promise<void> {
  cache = [];
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export type AprStats = {
  avg: number;
  min: number;
  max: number;
  samples: number;
};

/** Time-weighted APR stats over `days` for one loan. */
export function aprStatsFor(
  snapshots: LoanSnapshot[],
  loanId: string,
  days: number,
): AprStats | null {
  const cutoff = Date.now() - days * 86_400_000;
  const rows = snapshots
    .filter((s) => s.loanId === loanId && s.t >= cutoff)
    .sort((a, b) => a.t - b.t);
  if (rows.length < 2) return null;
  // Time-weighted average: each sample's APR contributes for the span until
  // the next sample. Last sample contributes nothing (no forward span).
  let weighted = 0;
  let totalSpan = 0;
  let min = rows[0].apr;
  let max = rows[0].apr;
  for (let i = 0; i < rows.length - 1; i++) {
    const span = rows[i + 1].t - rows[i].t;
    weighted += rows[i].apr * span;
    totalSpan += span;
    if (rows[i].apr < min) min = rows[i].apr;
    if (rows[i].apr > max) max = rows[i].apr;
  }
  const last = rows[rows.length - 1].apr;
  if (last < min) min = last;
  if (last > max) max = last;
  const avg = totalSpan > 0 ? weighted / totalSpan : last;
  return { avg, min, max, samples: rows.length };
}

/** APR series for one loan (sparkline input), oldest → newest. */
export function aprSeriesFor(
  snapshots: LoanSnapshot[],
  loanId: string,
  days: number,
): number[] {
  const cutoff = Date.now() - days * 86_400_000;
  return snapshots
    .filter((s) => s.loanId === loanId && s.t >= cutoff)
    .sort((a, b) => a.t - b.t)
    .map((s) => s.apr);
}

/**
 * Derive a per-day "interest charged" series for ALL loans across the window.
 * Trapezoid-integrate `debtUsd * apr / 365` between consecutive snapshots and
 * bucket the result into local-day keys. Sparse buckets are zero-filled so the
 * chart shows continuous bars even on days the user didn't open the app.
 */
function localDayKey(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function dailyChargeBuckets(
  snapshots: LoanSnapshot[],
  days: number,
): Array<[string, number]> {
  const cutoff = Date.now() - days * 86_400_000;
  const buckets = new Map<string, number>();
  // Pre-seed every day in the window with 0 so the bar chart stays continuous.
  for (let i = 0; i < days; i++) {
    buckets.set(localDayKey(Date.now() - i * 86_400_000), 0);
  }
  const byLoan = new Map<string, LoanSnapshot[]>();
  for (const s of snapshots) {
    if (s.t < cutoff) continue;
    const arr = byLoan.get(s.loanId) ?? [];
    arr.push(s);
    byLoan.set(s.loanId, arr);
  }
  for (const arr of byLoan.values()) {
    arr.sort((a, b) => a.t - b.t);
    for (let i = 0; i < arr.length - 1; i++) {
      const a = arr[i];
      const b = arr[i + 1];
      const spanMs = b.t - a.t;
      // Cap a gap to 1 day so a long absence doesn't synthesize fake interest.
      const cappedSpan = Math.min(spanMs, 86_400_000);
      const avgDebt = (a.debtUsd + b.debtUsd) / 2;
      const avgApr = (a.apr + b.apr) / 2;
      const usd = (avgDebt * avgApr * cappedSpan) / (365 * 86_400_000);
      const day = localDayKey(a.t);
      buckets.set(day, (buckets.get(day) ?? 0) + usd);
    }
  }
  return Array.from(buckets.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}
