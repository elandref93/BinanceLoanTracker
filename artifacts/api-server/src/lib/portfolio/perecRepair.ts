import { containerKey, priceOf } from "./history";
import { jhbDay } from "./time";
import type { HistoryPoint, StatementSeries } from "./types";

const TRUST_KEY = "investment:1";
const TRUST_ACCOUNT = "0433383";
const PERSONAL_KEY = "investment:3";
const PERSONAL_ACCOUNT = "0454918";
/** A snapshot this far below the statement is an incomplete read, not a market move. */
const GROSS_UNDER = 0.5;

interface Level {
  date: string;
  value: number;
  currency: string;
}

interface PerecAccount {
  id: "trust" | "personal";
  account: string;
  asset: string;
  container: string;
  byDate: Map<string, Level>;
}

interface Hit {
  container: string;
  asset: string;
  qty: number;
}

function round(value: number, dp: number): number {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

function unitUsd(currency: string, fx: number | null): number {
  if (currency === "USD") return 1;
  if (currency === "ZAR" && fx != null && fx > 0) return 1 / fx;
  return 0;
}

function accountId(item: StatementSeries): "trust" | "personal" | null {
  if ((item.kind ?? "as") !== "as") return null;
  if (item.key === TRUST_KEY || item.accountNumber === TRUST_ACCOUNT) return "trust";
  if (item.key === PERSONAL_KEY || item.accountNumber === PERSONAL_ACCOUNT) return "personal";
  return null;
}

/** Trust `investment:1` / 0433383 and personal `investment:3` / 0454918, from asset-swap series only. */
export function perecAccounts(series: readonly StatementSeries[] | undefined): PerecAccount[] {
  const grouped = new Map<"trust" | "personal", PerecAccount>();
  for (const item of series ?? []) {
    const id = accountId(item);
    if (!id) continue;
    const account = id === "trust" ? TRUST_ACCOUNT : PERSONAL_ACCOUNT;
    const current = grouped.get(id) ?? {
      id,
      account,
      asset: item.asset,
      container: containerKey(item.containerId),
      byDate: new Map<string, Level>(),
    };
    if (item.asset) current.asset = item.asset;
    current.container = containerKey(item.containerId);
    for (const point of item.points) {
      if (typeof point.value !== "number" || !Number.isFinite(point.value) || !(point.value > 0)) continue;
      const date = point.date;
      current.byDate.set(date, { date, value: point.value, currency: point.currency || item.currency || "USD" });
    }
    grouped.set(id, current);
  }
  return [...grouped.values()];
}

/** Statement value for `day`, or the last real value on an earlier day. Null points are skipped. */
function levelFor(account: PerecAccount, day: string): Level | null {
  let best: Level | null = null;
  for (const level of account.byDate.values()) {
    if (level.date > day) continue;
    if (!best || level.date >= best.date) best = level;
  }
  return best;
}

function isAccountAsset(asset: string, account: PerecAccount): boolean {
  if (asset === account.asset) return true;
  const lower = asset.toLowerCase();
  if (account.id === "personal") {
    if (lower.includes(account.account)) return true;
    if (!lower.includes("peresec")) return false;
    return lower.includes("structured note") || (lower.includes("asset swap") && lower.includes("personal"));
  }
  if (lower.includes(account.account)) return true;
  return lower.includes("peresec") && lower.includes("consolidated portfolio");
}

function hitsFor(holdings: HistoryPoint["h"], account: PerecAccount): Hit[] {
  const hits: Hit[] = [];
  for (const [container, bucket] of Object.entries(holdings)) {
    for (const [asset, qty] of Object.entries(bucket)) {
      if (!isAccountAsset(asset, account)) continue;
      hits.push({ container, asset, qty });
    }
  }
  return hits;
}

function defective(hits: Hit[], level: Level): boolean {
  if (hits.length !== 1) return true;
  const hit = hits[0] as Hit;
  if (!(hit.qty > 0)) return true;
  // Quantity is the statement amount. A missing price is not an under-record:
  // the stored totals already booked a matching quantity.
  return hit.qty < GROSS_UNDER * level.value;
}

function clonePoint(point: HistoryPoint): HistoryPoint {
  const h: HistoryPoint["h"] = {};
  for (const [key, bucket] of Object.entries(point.h)) h[key] = { ...bucket };
  const c: HistoryPoint["c"] = {};
  for (const [key, totals] of Object.entries(point.c)) c[key] = [totals[0], totals[1]];
  return {
    t: point.t,
    a: point.a,
    d: point.d,
    h,
    c,
    p: { ...point.p },
    fx: point.fx,
    ...(point.l ? { l: { ...point.l } } : {}),
    ...(point.gapFill ? { gapFill: true as const } : {}),
    ...(point.carried ? { carried: [...point.carried] } : {}),
  };
}

function removeBookedAssets(point: HistoryPoint, hit: Hit): void {
  if (!(hit.qty > 0)) return;
  const totals = point.c[hit.container];
  if (!totals) return;
  const usd = hit.qty * priceOf(hit.asset, point.p, point.fx);
  const removed = Math.min(Math.max(usd, 0), totals[0]);
  totals[0] = round(totals[0] - removed, 2);
  point.a = round(Math.max(0, point.a - removed), 2);
  if (totals[0] === 0 && totals[1] === 0) delete point.c[hit.container];
}

function dropHit(point: HistoryPoint, hit: Hit): void {
  removeBookedAssets(point, hit);
  const bucket = point.h[hit.container];
  if (!bucket) return;
  delete bucket[hit.asset];
  if (Object.keys(bucket).length === 0) delete point.h[hit.container];
  const stillUsed = Object.values(point.h).some((entry) => entry[hit.asset] != null);
  if (!stillUsed) delete point.p[hit.asset];
}

function placeStatement(point: HistoryPoint, account: PerecAccount, level: Level): void {
  const px = unitUsd(level.currency, point.fx);
  if (!(px > 0)) return;
  const bucket = (point.h[account.container] ??= {});
  bucket[account.asset] = round(level.value, 10);
  point.p[account.asset] = px;
  const usd = level.value * px;
  const totals = (point.c[account.container] ??= [0, 0]);
  totals[0] = round(totals[0] + usd, 2);
  point.a = round(point.a + usd, 2);
}

/**
 * One snapshot: a Peresec account uses that date's statement value when the
 * stored quantity is missing, negative, far below the statement, or an extra
 * name for the same account. Other holdings are left as recorded.
 */
export function repairPeresecPoint(point: HistoryPoint, accounts: readonly PerecAccount[]): HistoryPoint {
  if (accounts.length === 0) return point;
  const day = jhbDay(point.t);
  let copy: HistoryPoint | null = null;
  for (const account of accounts) {
    const level = levelFor(account, day);
    if (!level) continue;
    if (!(unitUsd(level.currency, point.fx) > 0)) continue;
    const hits = hitsFor(copy?.h ?? point.h, account);
    if (!defective(hits, level)) continue;
    copy ??= clonePoint(point);
    for (const hit of hits) dropHit(copy, hit);
    placeStatement(copy, account, level);
    if (copy.carried) {
      const dropped = new Set(hits.map((hit) => `${hit.container}|${hit.asset}`));
      const carried = copy.carried.filter((key) => !dropped.has(key));
      if (carried.length > 0) copy.carried = carried;
      else delete copy.carried;
    }
  }
  return copy ?? point;
}

export interface PerecRepairResult {
  points: HistoryPoint[];
  days: string[];
}

/** Repairs every stored point. A second run changes nothing. */
export function repairPeresecHistory(points: readonly HistoryPoint[], series: readonly StatementSeries[] | undefined): PerecRepairResult {
  const accounts = perecAccounts(series);
  if (accounts.length === 0 || points.length === 0) return { points: [...points], days: [] };
  const days = new Set<string>();
  let changed = false;
  const next = points.map((point) => {
    const repaired = repairPeresecPoint(point, accounts);
    if (repaired !== point) {
      changed = true;
      days.add(jhbDay(point.t));
    }
    return repaired;
  });
  return changed ? { points: next, days: [...days].sort() } : { points: [...points], days: [] };
}
