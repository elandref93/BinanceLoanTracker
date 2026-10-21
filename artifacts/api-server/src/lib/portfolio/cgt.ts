import { NO_CONTAINER } from "./history";
import type { DailyPrice } from "./pnl";
import { jhbDay, saTaxYear } from "./time";
import type { LedgerEvent } from "./types";

export type CgtMethod = "weighted" | "fifo";

export const DEFAULT_CGT_METHOD: CgtMethod = "fifo";

/** Trusts pay a flat 45%; for individuals this is the top marginal rate, so an upper bound. */
export const TOP_MARGINAL_RATE = 0.45;

/** Annual exclusion for individuals (natural persons). Trusts have none. */
export const INDIVIDUAL_ANNUAL_EXCLUSION_ZAR = 40_000;
export const INDIVIDUAL_INCLUSION_RATE = 0.4;
export const TRUST_INCLUSION_RATE = 0.8;

const NON_CGT_ASSETS = new Set(["ZAR", "USD", "EUR", "GBP"]);
const EPSILON = 1e-12;

interface Lot {
  qty: number;
  usd: number;
  zar: number;
}

interface Pool {
  lots: Lot[];
  complete: boolean;
}

export interface Disposal {
  t: number;
  container: string;
  asset: string;
  qty: number;
  proceedsUsd: number;
  proceedsZar: number;
  costUsd: number;
  costZar: number;
}

export interface CostBasisResult {
  /** container → asset → open position cost. */
  holdings: Map<string, Map<string, { qty: number; costUsd: number; costZar: number; complete: boolean }>>;
  disposals: Disposal[];
}

function poolQty(pool: Pool): number {
  return pool.lots.reduce((sum, lot) => sum + lot.qty, 0);
}

function take(pool: Pool, qty: number, method: CgtMethod): { usd: number; zar: number; shortfall: number } {
  let remaining = qty;
  let usd = 0;
  let zar = 0;
  if (method === "weighted") {
    const total = poolQty(pool);
    if (total <= EPSILON) return { usd: 0, zar: 0, shortfall: qty };
    const totalUsd = pool.lots.reduce((sum, lot) => sum + lot.usd, 0);
    const totalZar = pool.lots.reduce((sum, lot) => sum + lot.zar, 0);
    const used = Math.min(qty, total);
    const fraction = used / total;
    usd = totalUsd * fraction;
    zar = totalZar * fraction;
    pool.lots = [{ qty: total - used, usd: totalUsd - usd, zar: totalZar - zar }];
    return { usd, zar, shortfall: qty - used };
  }
  while (remaining > EPSILON && pool.lots.length > 0) {
    const lot = pool.lots[0] as Lot;
    const used = Math.min(remaining, lot.qty);
    const fraction = lot.qty > EPSILON ? used / lot.qty : 0;
    usd += lot.usd * fraction;
    zar += lot.zar * fraction;
    lot.qty -= used;
    lot.usd -= lot.usd * fraction;
    lot.zar -= lot.zar * fraction;
    remaining -= used;
    if (lot.qty <= EPSILON) pool.lots.shift();
  }
  return { usd, zar, shortfall: Math.max(0, remaining) };
}

/**
 * Runs the whole history through cost pools per profile and asset.
 * Acquisitions: buys, conversions in, income, borrowed coins, and deposits
 * (valued at market because the original cost is unknown, so the result is
 * marked incomplete). Disposals: sells, conversions out, fees paid in coin,
 * and loan repayments in coin. Withdrawals and negative adjustments leave
 * the pool at cost without a gain.
 */
export function runCostBasis(input: {
  events: LedgerEvent[];
  linkContainer: Map<string, string>;
  price: DailyPrice;
  fxOn: (day: string) => number | null;
  method: CgtMethod;
}): CostBasisResult {
  const pools = new Map<string, Pool>();
  const disposals: Disposal[] = [];
  const sorted = [...input.events].filter((event) => !event.debt).sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
  for (const event of sorted) {
    if (NON_CGT_ASSETS.has(event.asset) || event.qty === 0) continue;
    const container = input.linkContainer.get(event.linkId) ?? NO_CONTAINER;
    const key = `${container}|${event.asset}`;
    const pool = pools.get(key) ?? { lots: [], complete: true };
    pools.set(key, pool);
    const day = jhbDay(event.t);
    const usd = typeof event.usd === "number" && Number.isFinite(event.usd) ? Math.abs(event.usd) : Math.abs(event.qty) * input.price(event.asset, day);
    const fx = input.fxOn(day) ?? 0;
    const zar = usd * fx;
    if (event.qty > 0) {
      pool.lots.push({ qty: event.qty, usd, zar });
      if (event.type === "deposit" || event.type === "adjustment" || event.type === "transfer") pool.complete = false;
      continue;
    }
    const qty = -event.qty;
    const cost = take(pool, qty, input.method);
    if (cost.shortfall > EPSILON) pool.complete = false;
    const isDisposal = event.type === "sell" || event.type === "convert" || event.type === "fee" || event.type === "repay" || event.type === "buy";
    if (!isDisposal) continue;
    disposals.push({
      t: event.t,
      container,
      asset: event.asset,
      qty,
      proceedsUsd: usd,
      proceedsZar: zar,
      costUsd: cost.usd,
      costZar: cost.zar,
    });
  }
  const holdings: CostBasisResult["holdings"] = new Map();
  for (const [key, pool] of pools) {
    const [container = NO_CONTAINER, asset = ""] = key.split("|");
    const bucket = holdings.get(container) ?? new Map();
    bucket.set(asset, {
      qty: poolQty(pool),
      costUsd: pool.lots.reduce((sum, lot) => sum + lot.usd, 0),
      costZar: pool.lots.reduce((sum, lot) => sum + lot.zar, 0),
      complete: pool.complete,
    });
    holdings.set(container, bucket);
  }
  return { holdings, disposals };
}

export interface CgtSummary {
  taxYear: string;
  profileType: "individual" | "trust" | "mixed";
  realizedGainUsd: number;
  realizedGainZar: number | null;
  annualExclusionZar: number;
  inclusionRate: number;
  taxableGainZar: number | null;
  disposals: number;
}

/**
 * Taxable capital gain for the tax year containing `now`. Individuals get
 * the R40 000 annual exclusion then 40% inclusion; trusts include 80% with
 * no exclusion. Net losses are not carried forward here.
 */
export function summariseCgt(input: {
  disposals: Disposal[];
  containerTypes: Map<string, string>;
  containers: Set<string> | null;
  now: number;
  fxKnown: boolean;
}): CgtSummary {
  const year = saTaxYear(input.now);
  const perContainer = new Map<string, { usd: number; zar: number; count: number }>();
  for (const disposal of input.disposals) {
    if (input.containers && !input.containers.has(disposal.container)) continue;
    const day = jhbDay(disposal.t);
    if (day < year.from || day > year.to) continue;
    const entry = perContainer.get(disposal.container) ?? { usd: 0, zar: 0, count: 0 };
    entry.usd += disposal.proceedsUsd - disposal.costUsd;
    entry.zar += disposal.proceedsZar - disposal.costZar;
    entry.count += 1;
    perContainer.set(disposal.container, entry);
  }
  let usd = 0;
  let zar = 0;
  let taxable = 0;
  let count = 0;
  const types = new Set<string>();
  const containerIds = input.containers ? [...input.containers] : [...new Set([...perContainer.keys(), ...input.containerTypes.keys()])];
  for (const id of containerIds) {
    const type = input.containerTypes.get(id) === "trust" ? "trust" : "individual";
    const entry = perContainer.get(id);
    if (input.containerTypes.has(id)) types.add(type);
    if (!entry) continue;
    usd += entry.usd;
    zar += entry.zar;
    count += entry.count;
    if (type === "trust") taxable += Math.max(0, entry.zar) * TRUST_INCLUSION_RATE;
    else taxable += Math.max(0, entry.zar - INDIVIDUAL_ANNUAL_EXCLUSION_ZAR) * INDIVIDUAL_INCLUSION_RATE;
  }
  const profileType = types.size > 1 ? "mixed" : types.has("trust") ? "trust" : "individual";
  return {
    taxYear: year.label,
    profileType,
    realizedGainUsd: usd,
    realizedGainZar: input.fxKnown ? zar : null,
    annualExclusionZar: profileType === "trust" ? 0 : INDIVIDUAL_ANNUAL_EXCLUSION_ZAR,
    inclusionRate: profileType === "trust" ? TRUST_INCLUSION_RATE : profileType === "individual" ? INDIVIDUAL_INCLUSION_RATE : taxable > 0 && zar > 0 ? taxable / zar : INDIVIDUAL_INCLUSION_RATE,
    taxableGainZar: input.fxKnown ? taxable : null,
    disposals: count,
  };
}

export interface CgtProfileEstimate {
  containerId: string | null;
  name: string;
  type: "individual" | "trust";
  realizedGainZar: number;
  unrealizedGainZar: number;
  gainIfSoldZar: number;
  annualExclusionZar: number;
  inclusionRate: number;
  taxableIfSoldZar: number;
  taxIfSoldZar: number;
  complete: boolean;
}

/**
 * What each profile would owe if everything it holds were sold today: this
 * tax year's realised gains plus the open gain (value minus cost), less the
 * individual annual exclusion, times the inclusion rate, at the top rate.
 */
export function cgtIfSoldToday(input: {
  disposals: Disposal[];
  holdings: CostBasisResult["holdings"];
  /** container → asset → value in ZAR today. */
  values: Map<string, Map<string, number>>;
  containers: Array<{ id: string; name: string; type: string }>;
  scope: Set<string> | null;
  now: number;
}): CgtProfileEstimate[] {
  const year = saTaxYear(input.now);
  const ids = new Set<string>();
  for (const container of input.containers) ids.add(container.id);
  for (const id of input.values.keys()) ids.add(id);
  for (const id of input.holdings.keys()) ids.add(id);
  const out: CgtProfileEstimate[] = [];
  for (const id of ids) {
    if (input.scope && !input.scope.has(id)) continue;
    const info = input.containers.find((container) => container.id === id);
    const type = info?.type === "trust" ? "trust" : "individual";
    let realized = 0;
    for (const disposal of input.disposals) {
      if (disposal.container !== id) continue;
      const day = jhbDay(disposal.t);
      if (day < year.from || day > year.to) continue;
      realized += disposal.proceedsZar - disposal.costZar;
    }
    let unrealized = 0;
    let complete = true;
    let hasValue = false;
    const bucket = input.holdings.get(id);
    for (const [asset, valueZar] of input.values.get(id) ?? []) {
      if (NON_CGT_ASSETS.has(asset) || valueZar <= 0) continue;
      hasValue = true;
      const entry = bucket?.get(asset);
      if (!entry) {
        complete = false;
        continue;
      }
      unrealized += valueZar - entry.costZar;
      complete &&= entry.complete;
    }
    if (!hasValue && realized === 0) continue;
    const gain = realized + unrealized;
    const exclusion = type === "trust" ? 0 : INDIVIDUAL_ANNUAL_EXCLUSION_ZAR;
    const inclusion = type === "trust" ? TRUST_INCLUSION_RATE : INDIVIDUAL_INCLUSION_RATE;
    const taxable = Math.max(0, gain - exclusion) * inclusion;
    out.push({
      containerId: id === NO_CONTAINER ? null : id,
      name: info?.name ?? "Unassigned",
      type,
      realizedGainZar: realized,
      unrealizedGainZar: unrealized,
      gainIfSoldZar: gain,
      annualExclusionZar: exclusion,
      inclusionRate: inclusion,
      taxableIfSoldZar: taxable,
      taxIfSoldZar: taxable * TOP_MARGINAL_RATE,
      complete,
    });
  }
  return out.sort((a, b) => b.gainIfSoldZar - a.gainIfSoldZar);
}
