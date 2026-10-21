/**
 * Interest history from the saved LTV snapshot and the interest API.
 * Phone-local LTV samples and loan snapshots are not available here, and this
 * module does not synthesize a series when those fields are absent.
 */

import { fmtDate, fmtDateTime, fmtPct, groupWithSpaces } from "@/domain/format";
import { money, snapshotFx, type PortfolioCurrency } from "@/domain/portfolio";

export const HISTORY_SNAPSHOT_LOADING = "Loading the saved snapshot…";
export const HISTORY_INTEREST_LOADING = "Loading interest…";
export const LIFETIME_NOT_RETURNED = "Lifetime interest was not returned.";
export const LIFETIME_LOADING = "Loading lifetime interest…";
export const PROJECTED_NOT_RETURNED = "Projected interest was not returned.";
export const PROJECTED_LOADING = "Loading projected interest…";
export const CHARGED_NOT_RETURNED = "Charged interest for the last 30 days was not returned.";
export const WEIGHTED_APR_NOT_RETURNED = "Weighted APR was not returned.";
export const OPEN_LOANS_NOT_RETURNED = "Open loans were not returned.";
export const OPEN_LOANS_LOADING = "Loading open loans…";
export const LTV_NOT_RETURNED = "LTV history was not returned.";
export const LTV_EMPTY = "LTV history was returned empty.";
export const LTV_UNREADABLE = "LTV history was returned but could not be read.";
export const LTV_SINGLE = "One LTV sample was returned, so there is no line.";
export const DAILY_NOT_RETURNED = "Daily-charge history was not returned.";
export const DAILY_EMPTY = "Daily-charge history was returned empty.";
export const DAILY_UNREADABLE = "Daily-charge history was returned but could not be read.";
export const DAILY_LOADING = "Loading daily-charge history…";
export const APR_NOT_RETURNED = "APR series was not returned.";
export const APR_UNREADABLE = "APR series was returned but could not be read.";
export const APR_LOADING = "Loading the APR series…";
export const APR_SINGLE = "One APR sample was returned, so there is no line.";
export const LOANS_EMPTY = "No interest charges yet.";
export const LOANS_NOT_RETURNED = "Interest by loan was not returned.";
export const ASSETS_NOT_RETURNED = "Interest by borrowed asset was not returned.";
export const FROM_INTEREST = "From the interest API.";
export const FROM_SNAPSHOT = "From the saved snapshot.";
export const SERIES_FLAT = "The returned series does not change.";
export const ROWS_REPLACE_SNAPSHOT = "Interest rows replace the snapshot amount on days they were returned.";
export const SNAPSHOT_DAILY_LOADING = "Snapshot daily charges are still loading.";
export const SNAPSHOT_DAILY_ABSENT = "The snapshot did not return a daily-charge series.";
export const INTEREST_ROWS_LOADING = "Interest rows are still loading.";
export const ZAR_RATE_ABSENT = "This snapshot has no USD to ZAR rate.";
export const SNAPSHOT_TIME_ABSENT = "Snapshot time was not returned.";
export const NO_BROWSER_HISTORY = "This page does not keep a copy of history in the browser.";

export const DAILY_RANGES = [30, 90, 180, 365] as const;
export type DailyRange = (typeof DAILY_RANGES)[number];

export type HistoryLoad = "loading" | "missing" | "ready";
export type HistoryCurrency = PortfolioCurrency;

export type HistoryLine = {
  status: "loading" | "missing" | "value";
  text: string;
  source: string | null;
};

export type LtvHistoryInput = {
  t: string;
  ltv: number;
};

export type DailyChargeInput = {
  t: string;
  usd: number;
};

export type HistorySnapshot = {
  asOf?: string;
  history?: LtvHistoryInput[];
  dailyCharge?: DailyChargeInput[];
  interestLifetimeUsd?: number;
  interestProjected30dUsd?: number;
  fxUsdToZar?: number;
  loans?: ReadonlyArray<{ id: string }>;
};

export type RatePointInput = {
  ts: string;
  apr: number;
};

export type HistoryLoanInput = {
  loanId: string;
  accountId: string;
  asset: string;
  collateralAsset: string;
  currentApr: number;
  avg30dApr: number;
  min30dApr: number;
  max30dApr: number;
  projected30dUsd: number;
  lifetimeInterestUsd: number;
  loanAgeDays: number;
  rateHistory?: RatePointInput[];
};

export type HistoryAssetInput = {
  asset: string;
  debtUsd: number;
  weightedApr: number;
  projected30dUsd: number;
};

export type HistoryRowInput = {
  ts: string;
  amountUsd: number;
};

export type HistoryInterest = {
  totalUsd: number;
  weightedApr: number;
  projected30dUsd: number;
  byLoan: HistoryLoanInput[];
  byAsset: HistoryAssetInput[];
  rows: HistoryRowInput[];
};

export type LtvSampleView = {
  label: string;
  ltv: string;
  value: number;
};

export type DailySampleView = {
  day: string;
  label: string;
  amount: string;
  usd: number;
};

export type HistoryLoanView = {
  loanId: string;
  title: string;
  accountLabel: string;
  currentApr: string;
  avg30dApr: string;
  range: string;
  projected: string;
  lifetime: string;
  loanAge: string;
  delta: { direction: "up" | "down"; text: string } | null;
  aprValues: number[];
  aprSummary: string;
};

export type HistoryAssetView = {
  asset: string;
  debt: string;
  weightedApr: string;
  projected: string;
};

export type HistoryView = {
  asOfLabel: string | null;
  fxLabel: string | null;
  zarNote: string | null;
  lifetime: HistoryLine;
  snapshotLifetime: string | null;
  projected: HistoryLine;
  snapshotProjected: string | null;
  charged30d: HistoryLine;
  weightedApr: HistoryLine;
  openLoans: HistoryLine;
  ltvMessage: string;
  ltvSummary: string;
  ltvPoints: LtvSampleView[];
  ltvLine: boolean;
  dailyMessage: string;
  dailySummary: string;
  dailyPoints: DailySampleView[];
  dailyReturnedCount: number;
  loansMessage: string | null;
  loans: HistoryLoanView[];
  assetsMessage: string | null;
  assets: HistoryAssetView[];
  aprMessage: string | null;
};

type AprSample = {
  t: number;
  apr: number;
  label: string;
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** UTC day key as returned by the snapshot and by ISO timestamps. */
export function utcDayKey(value: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match ? match[1] : null;
}

/** Format a UTC yyyy-mm-dd bucket without moving it to the previous or next Johannesburg day. */
export function labelUtcDay(day: string): string {
  return fmtDate(`${day}T12:00:00.000Z`);
}

/**
 * Time-weighted APR over the points the API returned.
 * Same span rule as the phone: each sample counts until the next one, and the
 * last sample sets min and max but has no forward span.
 */
export function aprStatsForSeries(
  points: ReadonlyArray<{ t: number; apr: number }>,
): { avg: number; min: number; max: number; samples: number } | null {
  const rows = points
    .filter((point) => finite(point.t) && finite(point.apr) && point.apr > 0)
    .slice()
    .sort((left, right) => left.t - right.t);
  if (rows.length < 2) return null;
  let weighted = 0;
  let totalSpan = 0;
  let min = rows[0].apr;
  let max = rows[0].apr;
  for (let index = 0; index < rows.length - 1; index += 1) {
    const span = rows[index + 1].t - rows[index].t;
    weighted += rows[index].apr * span;
    totalSpan += span;
    if (rows[index].apr < min) min = rows[index].apr;
    if (rows[index].apr > max) max = rows[index].apr;
  }
  const last = rows[rows.length - 1].apr;
  if (last < min) min = last;
  if (last > max) max = last;
  const avg = totalSpan > 0 ? weighted / totalSpan : last;
  return { avg, min, max, samples: rows.length };
}

function formatMoney(usd: number, currency: HistoryCurrency, fx: number | null): string {
  return money(usd, currency, fx);
}

function accountLabel(accountId: string, labels: ReadonlyMap<string, string> | undefined): string {
  return labels?.get(accountId) ?? "Account not in the synced list";
}

function sumLifetime(loans: ReadonlyArray<HistoryLoanInput>): number | null {
  let sum = 0;
  let any = false;
  for (const loan of loans) {
    if (!finite(loan.lifetimeInterestUsd)) continue;
    sum += loan.lifetimeInterestUsd;
    any = true;
  }
  return any ? sum : null;
}

function savedNumber(
  state: HistoryLoad,
  snapshot: HistorySnapshot | null,
  read: (snapshot: HistorySnapshot) => number | undefined,
): number | null {
  if (state !== "ready" || !snapshot) return null;
  const value = read(snapshot);
  return finite(value) ? value : null;
}

function preferLive(
  live: number | null,
  saved: number | null,
  interestState: HistoryLoad,
  currency: HistoryCurrency,
  fx: number | null,
  missing: string,
  loading: string,
): { line: HistoryLine; snapshotText: string | null } {
  if (live != null) {
    return {
      line: { status: "value", text: formatMoney(live, currency, fx), source: FROM_INTEREST },
      snapshotText: saved != null ? formatMoney(saved, currency, fx) : null,
    };
  }
  if (interestState === "loading" && saved == null) {
    return { line: { status: "loading", text: loading, source: null }, snapshotText: null };
  }
  if (saved != null) {
    return {
      line: { status: "value", text: formatMoney(saved, currency, fx), source: FROM_SNAPSHOT },
      snapshotText: null,
    };
  }
  if (interestState === "loading") {
    return { line: { status: "loading", text: loading, source: null }, snapshotText: null };
  }
  return { line: { status: "missing", text: missing, source: null }, snapshotText: null };
}

function parseLtv(history: readonly LtvHistoryInput[]): LtvSampleView[] {
  const parsed: Array<LtvSampleView & { time: number }> = [];
  for (const point of history) {
    if (typeof point.t !== "string" || !finite(point.ltv)) continue;
    const time = Date.parse(point.t);
    if (!Number.isFinite(time)) continue;
    parsed.push({ time, label: fmtDateTime(point.t), ltv: fmtPct(point.ltv, 2), value: point.ltv });
  }
  parsed.sort((left, right) => left.time - right.time);
  return parsed.map((point) => ({ label: point.label, ltv: point.ltv, value: point.value }));
}

function ltvBlock(
  state: HistoryLoad,
  snapshot: HistorySnapshot | null,
): { message: string; summary: string; points: LtvSampleView[]; line: boolean } {
  if (state === "loading") {
    return { message: HISTORY_SNAPSHOT_LOADING, summary: HISTORY_SNAPSHOT_LOADING, points: [], line: false };
  }
  if (state !== "ready" || !snapshot || !Array.isArray(snapshot.history)) {
    return { message: LTV_NOT_RETURNED, summary: LTV_NOT_RETURNED, points: [], line: false };
  }
  if (snapshot.history.length === 0) {
    return { message: LTV_EMPTY, summary: LTV_EMPTY, points: [], line: false };
  }
  const points = parseLtv(snapshot.history);
  if (points.length === 0) {
    return { message: LTV_UNREADABLE, summary: LTV_UNREADABLE, points: [], line: false };
  }
  if (points.length === 1) {
    const only = points[0];
    const summary = `${LTV_SINGLE} ${only.label}: ${only.ltv}, Africa/Johannesburg.`;
    return { message: summary, summary, points, line: false };
  }
  const numeric = snapshot.history
    .map((point) => point.ltv)
    .filter((value) => finite(value));
  const low = Math.min(...numeric);
  const high = Math.max(...numeric);
  const first = points[0];
  const last = points[points.length - 1];
  const summary = `LTV history has ${points.length} samples from ${first.label} to ${last.label}, Africa/Johannesburg. Started at ${first.ltv} and ended at ${last.ltv}. Low ${fmtPct(low, 2)} and high ${fmtPct(high, 2)}.`;
  return { message: summary, summary, points, line: true };
}

function serverDaily(points: readonly DailyChargeInput[] | undefined): Map<string, number> | null {
  if (points == null) return null;
  const map = new Map<string, number>();
  for (const point of points) {
    if (typeof point.t !== "string" || !finite(point.usd) || point.usd < 0) continue;
    const day = utcDayKey(point.t);
    if (!day) continue;
    map.set(day, point.usd);
  }
  return map;
}

function rowDaily(rows: readonly HistoryRowInput[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (typeof row.ts !== "string" || !finite(row.amountUsd)) continue;
    const day = utcDayKey(row.ts);
    if (!day) continue;
    map.set(day, (map.get(day) ?? 0) + row.amountUsd);
  }
  return map;
}

function dailyBlock(
  snapshotState: HistoryLoad,
  snapshot: HistorySnapshot | null,
  interestState: HistoryLoad,
  interest: HistoryInterest | null,
  currency: HistoryCurrency,
  fx: number | null,
  range: DailyRange,
): { message: string; summary: string; points: DailySampleView[]; returnedCount: number } {
  const serverMap = snapshotState === "ready" ? serverDaily(snapshot?.dailyCharge) : null;
  const rowMap = interestState === "ready" && interest ? rowDaily(interest.rows) : new Map<string, number>();
  const waitingForSnapshot = snapshotState === "loading";
  const waitingForInterest = interestState === "loading";
  const canUseServer = serverMap != null && serverMap.size > 0;
  const canUseRows = rowMap.size > 0;
  const rawCount = snapshotState === "ready" && Array.isArray(snapshot?.dailyCharge) ? snapshot.dailyCharge.length : 0;

  if (!canUseServer && !canUseRows && (waitingForSnapshot || waitingForInterest)) {
    return { message: DAILY_LOADING, summary: DAILY_LOADING, points: [], returnedCount: 0 };
  }
  if (!canUseServer && !canUseRows) {
    if (rawCount > 0) {
      return { message: DAILY_UNREADABLE, summary: DAILY_UNREADABLE, points: [], returnedCount: 0 };
    }
    if (snapshotState === "ready" && serverMap != null) {
      return { message: DAILY_EMPTY, summary: DAILY_EMPTY, points: [], returnedCount: 0 };
    }
    return { message: DAILY_NOT_RETURNED, summary: DAILY_NOT_RETURNED, points: [], returnedCount: 0 };
  }

  const merged = new Map<string, number>(canUseServer && serverMap ? serverMap : []);
  if (canUseRows) {
    for (const [day, usd] of rowMap) merged.set(day, usd);
  }
  const all = Array.from(merged.entries())
    .map(([day, usd]) => ({
      day,
      label: labelUtcDay(day),
      amount: formatMoney(usd, currency, fx),
      usd,
    }))
    .sort((left, right) => left.day.localeCompare(right.day));
  const shown = all.slice(-range);
  const first = shown[0];
  const last = shown[shown.length - 1];
  const low = Math.min(...shown.map((point) => point.usd));
  const high = Math.max(...shown.map((point) => point.usd));
  const window =
    shown.length === all.length
      ? `Showing all ${all.length} returned days.`
      : `Showing the last ${shown.length} of ${all.length} returned days.`;
  const notes: string[] = [];
  if (canUseRows && canUseServer) notes.push(ROWS_REPLACE_SNAPSHOT);
  else if (canUseRows && waitingForSnapshot) notes.push(SNAPSHOT_DAILY_LOADING);
  else if (canUseRows) notes.push(SNAPSHOT_DAILY_ABSENT);
  if (canUseServer && waitingForInterest) notes.push(INTEREST_ROWS_LOADING);
  const summary = `Daily interest charges from ${first.label} to ${last.label}. Low ${formatMoney(low, currency, fx)} and high ${formatMoney(high, currency, fx)}. ${window} Days without a returned bucket are omitted. ${notes.join(" ")}`.trim();
  return { message: summary, summary, points: shown, returnedCount: all.length };
}

function aprDelta(current: number, avg: number): { direction: "up" | "down"; text: string } | null {
  if (!finite(current) || !finite(avg) || avg <= 0 || current === avg) return null;
  const delta = ((current - avg) / avg) * 100;
  if (!finite(delta) || delta === 0) return null;
  return {
    direction: delta > 0 ? "up" : "down",
    text: `${delta > 0 ? "▲" : "▼"}${fmtPct(Math.abs(delta), 1)}`,
  };
}

function aprSeries(raw: RatePointInput[] | undefined, title: string): { values: number[]; summary: string } {
  if (raw == null || raw.length === 0) {
    return { values: [], summary: APR_NOT_RETURNED };
  }
  const parsed: AprSample[] = [];
  for (const point of raw) {
    if (typeof point.ts !== "string" || !finite(point.apr)) continue;
    const time = Date.parse(point.ts);
    if (!Number.isFinite(time)) continue;
    parsed.push({ t: time, apr: point.apr, label: fmtDateTime(point.ts) });
  }
  parsed.sort((left, right) => left.t - right.t);
  if (parsed.length === 0) return { values: [], summary: APR_UNREADABLE };
  const values = parsed.map((point) => point.apr);
  if (parsed.length === 1) {
    const only = parsed[0];
    return { values, summary: `${APR_SINGLE} ${only.label}: ${fmtPct(only.apr, 2)}, Africa/Johannesburg.` };
  }
  const low = Math.min(...values);
  const high = Math.max(...values);
  const stats = aprStatsForSeries(parsed);
  const first = parsed[0];
  const last = parsed[parsed.length - 1];
  const pieces = [
    `APR series for ${title}, ${parsed.length} points from ${first.label} to ${last.label}, Africa/Johannesburg.`,
    `Low ${fmtPct(low, 2)} and high ${fmtPct(high, 2)}.`,
  ];
  if (stats) pieces.push(`Time-weighted average ${fmtPct(stats.avg, 2)}.`);
  if (low === high) pieces.push(SERIES_FLAT);
  return { values, summary: pieces.join(" ") };
}

function loanViews(
  interest: HistoryInterest,
  currency: HistoryCurrency,
  fx: number | null,
  labels: ReadonlyMap<string, string> | undefined,
): HistoryLoanView[] {
  return interest.byLoan
    .slice()
    .sort((left, right) => {
      const leftValue = finite(left.projected30dUsd) ? left.projected30dUsd : Number.NEGATIVE_INFINITY;
      const rightValue = finite(right.projected30dUsd) ? right.projected30dUsd : Number.NEGATIVE_INFINITY;
      return rightValue - leftValue;
    })
    .map((loan) => {
      const title = `${loan.collateralAsset}/${loan.asset}`;
      const series = aprSeries(loan.rateHistory, title);
      const min = finite(loan.min30dApr) ? fmtPct(loan.min30dApr, 2) : "—";
      const max = finite(loan.max30dApr) ? fmtPct(loan.max30dApr, 2) : "—";
      return {
        loanId: loan.loanId,
        title,
        accountLabel: accountLabel(loan.accountId, labels),
        currentApr: finite(loan.currentApr) ? fmtPct(loan.currentApr, 2) : "—",
        avg30dApr: finite(loan.avg30dApr) ? fmtPct(loan.avg30dApr, 2) : "—",
        range: `${min} – ${max}`,
        projected: finite(loan.projected30dUsd) ? formatMoney(loan.projected30dUsd, currency, fx) : "—",
        lifetime: finite(loan.lifetimeInterestUsd) ? formatMoney(loan.lifetimeInterestUsd, currency, fx) : LIFETIME_NOT_RETURNED,
        loanAge: finite(loan.loanAgeDays) ? `${loan.loanAgeDays} days` : "Loan age was not returned.",
        delta: aprDelta(loan.currentApr, loan.avg30dApr),
        aprValues: series.values,
        aprSummary: series.summary,
      };
    });
}

function assetViews(
  interest: HistoryInterest,
  currency: HistoryCurrency,
  fx: number | null,
): HistoryAssetView[] {
  return interest.byAsset
    .slice()
    .sort((left, right) => {
      const leftValue = finite(left.projected30dUsd) ? left.projected30dUsd : Number.NEGATIVE_INFINITY;
      const rightValue = finite(right.projected30dUsd) ? right.projected30dUsd : Number.NEGATIVE_INFINITY;
      return rightValue - leftValue;
    })
    .map((asset) => ({
      asset: asset.asset,
      debt: finite(asset.debtUsd) ? formatMoney(asset.debtUsd, currency, fx) : "—",
      weightedApr: finite(asset.weightedApr) ? fmtPct(asset.weightedApr, 2) : "—",
      projected: finite(asset.projected30dUsd) ? formatMoney(asset.projected30dUsd, currency, fx) : "—",
    }));
}

export function buildHistoryView(input: {
  snapshotState: HistoryLoad;
  snapshot: HistorySnapshot | null;
  interestState: HistoryLoad;
  interest: HistoryInterest | null;
  currency: HistoryCurrency;
  accountLabels?: ReadonlyMap<string, string>;
  dailyRange?: DailyRange;
}): HistoryView {
  const range = input.dailyRange ?? 30;
  const fx = input.snapshotState === "ready" && input.snapshot ? snapshotFx(input.snapshot.fxUsdToZar) : null;
  const savedLifetime = savedNumber(input.snapshotState, input.snapshot, (snapshot) => snapshot.interestLifetimeUsd);
  const savedProjected = savedNumber(
    input.snapshotState,
    input.snapshot,
    (snapshot) => snapshot.interestProjected30dUsd,
  );
  const liveLifetime =
    input.interestState === "ready" && input.interest ? sumLifetime(input.interest.byLoan) : null;
  const liveProjected =
    input.interestState === "ready" && input.interest && finite(input.interest.projected30dUsd)
      ? input.interest.projected30dUsd
      : null;
  const lifetime = preferLive(
    liveLifetime,
    savedLifetime,
    input.interestState,
    input.currency,
    fx,
    LIFETIME_NOT_RETURNED,
    LIFETIME_LOADING,
  );
  const projected = preferLive(
    liveProjected,
    savedProjected,
    input.interestState,
    input.currency,
    fx,
    PROJECTED_NOT_RETURNED,
    PROJECTED_LOADING,
  );
  const charged30d: HistoryLine =
    input.interestState === "loading"
      ? { status: "loading", text: HISTORY_INTEREST_LOADING, source: null }
      : input.interestState === "ready" && input.interest && finite(input.interest.totalUsd)
        ? { status: "value", text: formatMoney(input.interest.totalUsd, input.currency, fx), source: FROM_INTEREST }
        : { status: "missing", text: CHARGED_NOT_RETURNED, source: null };
  const weightedApr: HistoryLine =
    input.interestState === "loading"
      ? { status: "loading", text: HISTORY_INTEREST_LOADING, source: null }
      : input.interestState === "ready" && input.interest && finite(input.interest.weightedApr)
        ? { status: "value", text: fmtPct(input.interest.weightedApr, 2), source: FROM_INTEREST }
        : { status: "missing", text: WEIGHTED_APR_NOT_RETURNED, source: null };
  const openLoans: HistoryLine =
    input.snapshotState === "ready" && input.snapshot && Array.isArray(input.snapshot.loans)
      ? { status: "value", text: String(input.snapshot.loans.length), source: FROM_SNAPSHOT }
      : input.interestState === "ready" && input.interest
        ? { status: "value", text: String(input.interest.byLoan.length), source: FROM_INTEREST }
        : input.snapshotState === "loading" || input.interestState === "loading"
          ? { status: "loading", text: OPEN_LOANS_LOADING, source: null }
          : { status: "missing", text: OPEN_LOANS_NOT_RETURNED, source: null };
  const ltv = ltvBlock(input.snapshotState, input.snapshot);
  const daily = dailyBlock(
    input.snapshotState,
    input.snapshot,
    input.interestState,
    input.interest,
    input.currency,
    fx,
    range,
  );
  const loans =
    input.interestState === "ready" && input.interest
      ? loanViews(input.interest, input.currency, fx, input.accountLabels)
      : [];
  const assets =
    input.interestState === "ready" && input.interest ? assetViews(input.interest, input.currency, fx) : [];
  let asOfLabel: string | null = null;
  if (input.snapshotState === "ready") {
    if (!input.snapshot || typeof input.snapshot.asOf !== "string") {
      asOfLabel = SNAPSHOT_TIME_ABSENT;
    } else {
      const label = fmtDateTime(input.snapshot.asOf);
      asOfLabel = label === "—" ? SNAPSHOT_TIME_ABSENT : label;
    }
  }
  return {
    asOfLabel,
    fxLabel: fx == null ? null : `R${groupWithSpaces(fx, 2)} per USD`,
    zarNote: input.currency === "ZAR" && input.snapshotState !== "loading" && fx == null ? ZAR_RATE_ABSENT : null,
    lifetime: lifetime.line,
    snapshotLifetime: lifetime.snapshotText,
    projected: projected.line,
    snapshotProjected: projected.snapshotText,
    charged30d,
    weightedApr,
    openLoans,
    ltvMessage: ltv.message,
    ltvSummary: ltv.summary,
    ltvPoints: ltv.points,
    ltvLine: ltv.line,
    dailyMessage: daily.message,
    dailySummary: daily.summary,
    dailyPoints: daily.points,
    dailyReturnedCount: daily.returnedCount,
    loansMessage:
      input.interestState === "loading"
        ? HISTORY_INTEREST_LOADING
        : input.interestState !== "ready" || !input.interest
          ? LOANS_NOT_RETURNED
          : loans.length === 0
            ? LOANS_EMPTY
            : null,
    loans,
    assetsMessage:
      input.interestState === "loading"
        ? HISTORY_INTEREST_LOADING
        : input.interestState !== "ready" || !input.interest
          ? ASSETS_NOT_RETURNED
          : assets.length === 0
            ? LOANS_EMPTY
            : null,
    assets,
    aprMessage:
      input.interestState === "loading"
        ? APR_LOADING
        : loans.length === 0
          ? APR_NOT_RETURNED
          : null,
  };
}
