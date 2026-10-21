/**
 * Per-holding expected annual return, stored in the settings sync blob.
 * Nothing is assumed until the user saves a percent for that holding.
 */

import { parseDecimalInput } from "@/domain/decimalInput";
import { fmtNum } from "@/domain/format";

export const EXPECTED_RETURN_FIELD = "expectedAnnualReturns";
export const EXPECTED_RETURN_MIN = -100;
export const EXPECTED_RETURN_MAX = 1000;
/** On par when actual and the prorated target differ by at most this many percentage points. */
export const RETURN_PAR_BAND_PP = 0.5;
/**
 * A starting value under one dollar is leftover dust or a near-zero history
 * point, not a position a return can be measured from.
 */
export const REAL_POSITION_MIN_USD = 1;

const DAY_MS = 86_400_000;
const YEAR_DAYS = 365;

export type ReturnStatus = "ahead" | "on_par" | "behind";

export type CashFlow = { t: string; usd: number };

export type ExpectedComparison = {
  annualPct: number;
  elapsedDays: number;
  expectedPct: number;
  /** Null when the start value is not a real position. The percent is omitted. */
  actualPct: number | null;
  /**
   * Actual minus target so far, in percentage points.
   * Null when actual is omitted. The same difference that picks the status.
   */
  gapPp: number | null;
  /** True when a deposit or withdrawal after the opening balance was removed. */
  flowsRemoved: boolean;
  status: ReturnStatus | null;
  startedAt: string;
};

export type ExpectedReturnRow = {
  asset: string;
  title: string;
  annualPct: number;
  comparison: ExpectedComparison | null;
};

type HistoryDetail = {
  holdingHistory: readonly { t: string; usd: number }[];
  priceHistory?: readonly { t: string }[];
  asset: { usd: number };
  holdingOpened?: unknown;
  externalFlows?: readonly CashFlow[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validAssetKey(asset: string): boolean {
  return asset.length > 0 && asset.length <= 200 && !/[\u0000-\u001f]/.test(asset);
}

function inRange(value: number): boolean {
  return value >= EXPECTED_RETURN_MIN && value <= EXPECTED_RETURN_MAX;
}

/** Blank stays unset. A number outside the allowed band is rejected. */
export function parseExpectedAnnual(raw: string): number | null {
  const value = parseDecimalInput(raw);
  if (value == null) return null;
  const rounded = Math.round(value * 10_000) / 10_000;
  return inRange(rounded) ? rounded : null;
}

export function readExpectedReturns(settings: unknown): Record<string, number> {
  if (!isRecord(settings) || !isRecord(settings[EXPECTED_RETURN_FIELD])) return {};
  const stored: Record<string, number> = {};
  for (const [asset, value] of Object.entries(settings[EXPECTED_RETURN_FIELD])) {
    if (!validAssetKey(asset) || typeof value !== "number" || !Number.isFinite(value)) continue;
    const rounded = Math.round(value * 10_000) / 10_000;
    if (!inRange(rounded)) continue;
    stored[asset] = rounded;
  }
  return stored;
}

export function readExpectedReturn(settings: unknown, asset: string): number | null {
  return readExpectedReturns(settings)[asset] ?? null;
}

/** Replace one holding's percent. Other settings fields stay. `null` removes it. */
export function applyExpectedReturn(settings: unknown, asset: string, annualPct: number | null): Record<string, unknown> {
  const next = isRecord(settings) ? { ...settings } : {};
  if (!validAssetKey(asset)) return next;
  const current = readExpectedReturns(next);
  if (annualPct == null) delete current[asset];
  else if (inRange(annualPct)) current[asset] = Math.round(annualPct * 10_000) / 10_000;
  else return next;
  if (Object.keys(current).length === 0) delete next[EXPECTED_RETURN_FIELD];
  else next[EXPECTED_RETURN_FIELD] = current;
  return next;
}

/**
 * "Ahead 1,1 pp" or "Behind 2,4 pp". On par stays the word alone.
 * The number is the absolute gap, formatted like other percents. Ahead and
 * Behind carry the sign.
 */
export function returnStatusLabel(status: ReturnStatus, gapPp?: number | null): string {
  if (status === "on_par") return "On par";
  const word = status === "ahead" ? "Ahead" : "Behind";
  if (gapPp == null || !Number.isFinite(gapPp)) return word;
  return `${word} ${fmtNum(Math.abs(gapPp), 1)} pp`;
}

/**
 * Modified Dietz for one interval. Flows are assumed at the midpoint, the same
 * weight as the portfolio engine's `modifiedDietz`.
 */
export function modifiedDietzReturn(startValue: number, endValue: number, flows: number): number {
  const denominator = startValue + 0.5 * flows;
  if (Math.abs(denominator) < 1e-6) return 0;
  return (endValue - startValue - flows) / denominator;
}

function inHoldingWindow(flow: CashFlow, startMs: number, nowMs: number): boolean {
  if (!Number.isFinite(flow.usd) || flow.usd === 0) return false;
  const t = Date.parse(flow.t);
  if (!Number.isFinite(t)) return false;
  if (Number.isFinite(startMs) && t <= startMs) return false;
  if (Number.isFinite(nowMs) && t > nowMs) return false;
  return true;
}

/**
 * Growth from a real starting value to the value now, in percent.
 * Dust and a missing start have no defined return: dividing by them prints a giant percent.
 * Dated deposits and withdrawals are chained out with Modified Dietz. Money already
 * inside the opening balance is not removed again. With no external flows this is
 * value growth from that opening balance.
 */
export function actualGrowthPct(
  startUsd: number,
  nowUsd: number,
  options?: {
    startedAt?: string;
    nowMs?: number;
    marks?: readonly { t: string; usd: number }[];
    flows?: readonly CashFlow[];
  },
): { pct: number | null; flowsRemoved: boolean } {
  if (!(startUsd >= REAL_POSITION_MIN_USD) || !Number.isFinite(nowUsd)) return { pct: null, flowsRemoved: false };
  const startMs = options?.startedAt ? Date.parse(options.startedAt) : NaN;
  const nowMs = options?.nowMs ?? NaN;
  const flows = (options?.flows ?? []).filter((flow) => inHoldingWindow(flow, startMs, nowMs));
  if (flows.length === 0) {
    const pct = (nowUsd / startUsd - 1) * 100;
    return { pct: Number.isFinite(pct) ? pct : null, flowsRemoved: false };
  }
  const points: { t: number; usd: number }[] = [];
  const put = (t: number, usd: number) => {
    const existing = points.find((point) => point.t === t);
    if (existing) existing.usd = usd;
    else points.push({ t, usd });
  };
  if (Number.isFinite(startMs)) put(startMs, startUsd);
  for (const mark of options?.marks ?? []) {
    const t = Date.parse(mark.t);
    if (!Number.isFinite(t) || !Number.isFinite(mark.usd)) continue;
    if (Number.isFinite(startMs) && t <= startMs) continue;
    if (Number.isFinite(nowMs) && t > nowMs) continue;
    put(t, mark.usd);
  }
  if (Number.isFinite(nowMs)) put(nowMs, nowUsd);
  else put((points[points.length - 1]?.t ?? 0) + 1, nowUsd);
  points.sort((a, b) => a.t - b.t);
  let growth = 1;
  let previous = points[0];
  if (!previous) return { pct: null, flowsRemoved: false };
  const used = new Set<number>();
  for (let index = 1; index < points.length; index += 1) {
    const next = points[index];
    if (!next || next.t === previous.t) {
      if (next) previous = next;
      continue;
    }
    let flow = 0;
    flows.forEach((item, flowIndex) => {
      if (used.has(flowIndex)) return;
      const t = Date.parse(item.t);
      if (t > previous.t && t <= next.t) {
        flow += item.usd;
        used.add(flowIndex);
      }
    });
    growth *= 1 + modifiedDietzReturn(previous.usd, next.usd, flow);
    previous = next;
  }
  const pct = (growth - 1) * 100;
  return { pct: Number.isFinite(pct) ? pct : null, flowsRemoved: true };
}

/**
 * expected_so_far = annual_percent * (days since start / 365).
 * Actual is the time-weighted return from the start value to the value now.
 * External deposits and withdrawals are not capital growth.
 */
export function compareExpectedReturn(input: {
  annualPct: number;
  startedAt: string;
  startUsd: number;
  nowUsd: number;
  nowMs: number;
  marks?: readonly { t: string; usd: number }[];
  flows?: readonly CashFlow[];
}): ExpectedComparison | null {
  const startMs = Date.parse(input.startedAt);
  if (!Number.isFinite(input.annualPct) || !inRange(input.annualPct)) return null;
  if (!Number.isFinite(startMs) || !Number.isFinite(input.nowMs) || input.nowMs < startMs) return null;
  if (!(input.startUsd > 0) || !Number.isFinite(input.nowUsd)) return null;
  // Elapsed time includes partial days as a fraction of 365.
  const elapsedDays = (input.nowMs - startMs) / DAY_MS;
  const expectedPct = input.annualPct * (elapsedDays / YEAR_DAYS);
  const actual = actualGrowthPct(input.startUsd, input.nowUsd, {
    startedAt: input.startedAt,
    nowMs: input.nowMs,
    marks: input.marks,
    flows: input.flows,
  });
  const gap = actual.pct == null ? null : actual.pct - expectedPct;
  const status: ReturnStatus | null =
    gap == null ? null : gap > RETURN_PAR_BAND_PP ? "ahead" : gap < -RETURN_PAR_BAND_PP ? "behind" : "on_par";
  return {
    annualPct: input.annualPct,
    elapsedDays,
    expectedPct,
    actualPct: actual.pct,
    gapPp: gap,
    flowsRemoved: actual.flowsRemoved,
    status,
    startedAt: input.startedAt,
  };
}

function openedPoint(value: unknown): { t: string; usd: number } | null {
  if (!isRecord(value) || typeof value.t !== "string" || typeof value.usd !== "number") return null;
  if (!(value.usd > 0) || !Number.isFinite(Date.parse(value.t))) return null;
  return { t: value.t, usd: value.usd };
}

/** Flows the asset detail attached. Absent on snapshots recorded before cash flows were kept. */
export function readExternalFlows(detail: object): CashFlow[] {
  if (!("externalFlows" in detail) || !Array.isArray(detail.externalFlows)) return [];
  const flows: CashFlow[] = [];
  for (const flow of detail.externalFlows) {
    if (!isRecord(flow) || typeof flow.t !== "string" || typeof flow.usd !== "number" || !Number.isFinite(flow.usd)) continue;
    flows.push({ t: flow.t, usd: flow.usd });
  }
  return flows;
}

/** Earliest positive history point. A server `holdingOpened` wins over the chart window. */
export function holdingStart(detail: { holdingHistory: readonly { t: string; usd: number }[]; holdingOpened?: unknown }): {
  t: string;
  usd: number;
} | null {
  const opened = openedPoint(detail.holdingOpened);
  if (opened) return opened;
  const totals = new Map<string, number>();
  for (const point of detail.holdingHistory) {
    if (!Number.isFinite(point.usd) || !Number.isFinite(Date.parse(point.t))) continue;
    totals.set(point.t, (totals.get(point.t) ?? 0) + point.usd);
  }
  const earliest = [...totals.entries()].filter(([, usd]) => usd > 0).sort(([a], [b]) => a.localeCompare(b))[0];
  return earliest ? { t: earliest[0], usd: earliest[1] } : null;
}

export function comparisonAsOf(priceHistory: readonly { t: string }[] | undefined, fallback = Date.now()): number {
  const last = priceHistory?.[priceHistory.length - 1];
  const parsed = last ? Date.parse(last.t) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Targets for holdings in the current scope only. Holdings outside the list are omitted. */
export function expectedReturnRows(input: {
  targets: Record<string, number>;
  holdings: readonly { asset: string; title: string }[];
  details: ReadonlyMap<string, HistoryDetail | null>;
  nowMs?: number;
}): ExpectedReturnRow[] {
  const rows: ExpectedReturnRow[] = [];
  for (const holding of input.holdings) {
    const annualPct = input.targets[holding.asset];
    if (annualPct == null) continue;
    const detail = input.details.get(holding.asset) ?? null;
    const start = detail ? holdingStart(detail) : null;
    const comparison =
      detail && start
        ? compareExpectedReturn({
            annualPct,
            startedAt: start.t,
            startUsd: start.usd,
            nowUsd: detail.asset.usd,
            nowMs: comparisonAsOf(detail.priceHistory, input.nowMs),
            marks: detail.holdingHistory,
            flows: detail.externalFlows,
          })
        : null;
    rows.push({ asset: holding.asset, title: holding.title, annualPct, comparison });
  }
  return rows;
}
