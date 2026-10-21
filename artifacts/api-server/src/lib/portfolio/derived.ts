import { childProfileById, isChildProfileId } from "./childProfiles";
import { NO_CONTAINER, containerKey, priceOf } from "./history";
import { repairPeresecHistory } from "./perecRepair";
import { separateChildHoldings } from "./pickleRick";
import { readLedger, type LedgerFile } from "./ledgerStore";
import { buildDailySeries, type DailySeries } from "./pnl";
import { readPortfolio } from "./portfolioStore";
import { linkContainerMap } from "./positions";
import { priceBook, type PriceBook } from "./prices";
import { balanceKey, parseBalanceKey, reconcile, reconstructBalances, type Reconstruction } from "./reconstruct";
import { dayRange, jhbDay, jhbDayEnd } from "./time";
import type { HistoryPoint, LedgerEvent, PortfolioState } from "./types";

export interface Derived {
  state: PortfolioState;
  points: HistoryPoint[];
  ledger: LedgerFile | null;
  /** Imported events plus estimated daily interest on flexible loans. */
  events: LedgerEvent[];
  linkContainer: Map<string, string>;
  book: PriceBook;
  recon: Reconstruction | null;
  series: DailySeries | null;
  reconciliation: ReturnType<typeof reconcile>;
  containerTypes: Map<string, string>;
}

const cache = new Map<string, { key: string; at: number; value: Derived }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export function anchorBalances(state: PortfolioState): Map<string, number> {
  const anchor = new Map<string, number>();
  for (const position of state.positions) {
    // Statement lines are not exchange ledger balances, so they must not become reconciliation adjustments.
    if (position.exchange === "pickle_rick") continue;
    const key = balanceKey(position.linkId, position.asset, false);
    anchor.set(key, (anchor.get(key) ?? 0) + position.qty);
  }
  for (const loan of state.debts) {
    const key = balanceKey(loan.linkId, loan.asset, true);
    anchor.set(key, (anchor.get(key) ?? 0) + loan.qty);
  }
  return anchor;
}

/**
 * Flexible loans accrue interest into the debt every hour without an event,
 * so the ledger estimates one interest event per day from the running debt
 * and the loan's current hourly rate. Margin interest is imported as-is.
 */
export function synthesiseFlexibleInterest(events: LedgerEvent[], state: PortfolioState, nowMs: number): LedgerEvent[] {
  const flexible = events.filter((event) => event.debt === true && (event.id.includes(":flb:") || event.id.includes(":flr:")));
  if (flexible.length === 0) return [];
  const rateFor = new Map<string, number>();
  for (const loan of state.debts) {
    if (loan.loanId.includes("_flex_") && loan.hourlyRate > 0) rateFor.set(`${loan.linkId}|${loan.asset}`, loan.hourlyRate);
  }
  const groups = new Map<string, LedgerEvent[]>();
  for (const event of flexible) {
    const key = `${event.linkId}|${event.asset}`;
    const list = groups.get(key) ?? [];
    list.push(event);
    groups.set(key, list);
  }
  const out: LedgerEvent[] = [];
  for (const [key, list] of groups) {
    const rate = rateFor.get(key);
    if (!rate) continue;
    list.sort((a, b) => a.t - b.t);
    const [linkId = "", asset = ""] = key.split("|");
    const first = list[0] as LedgerEvent;
    const byDay = new Map<string, number>();
    for (const event of list) byDay.set(jhbDay(event.t), (byDay.get(jhbDay(event.t)) ?? 0) + event.qty);
    let debt = 0;
    for (const day of dayRange(jhbDay(first.t), jhbDay(nowMs))) {
      debt = Math.max(0, debt + (byDay.get(day) ?? 0));
      if (debt <= 0) continue;
      const interest = debt * rate * 24;
      debt += interest;
      out.push({
        id: `syn:flexint:${linkId}:${asset}:${day}`,
        t: Math.min(jhbDayEnd(day) - 1, nowMs),
        exchange: "binance",
        linkId,
        type: "interest",
        asset,
        qty: interest,
        debt: true,
        note: "Estimated daily loan interest",
      });
    }
  }
  return out;
}

export async function loadDerived(hash: string): Promise<Derived | null> {
  const [portfolio, ledger] = await Promise.all([readPortfolio(hash), readLedger(hash)]);
  const state = portfolio?.latest;
  if (!portfolio || !state) return null;
  const key = `${state.asOf}:${ledger?.revision ?? 0}`;
  const cached = cache.get(hash);
  if (cached && cached.key === key && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  const book = await priceBook({ prices: state.prices, fx: state.fx });
  const value = deriveFrom({ state, points: portfolio.points, ledger, book });
  cache.set(hash, { key, at: Date.now(), value });
  return value;
}

export function deriveFrom(input: { state: PortfolioState; points: HistoryPoint[]; ledger: LedgerFile | null; book: PriceBook }): Derived {
  const { ledger, book } = input;
  const state = separateChildHoldings(input.state);
  const points = repairPeresecHistory(input.points, state.statementSeries).points;
  const linkContainer = linkContainerMap(state.containers);
  const imported = (ledger?.events ?? []).filter((event) => event.t <= state.asOf);
  const events = [...imported, ...synthesiseFlexibleInterest(imported, state, state.asOf)].sort((a, b) => a.t - b.t);
  const anchor = anchorBalances(state);
  let recon: Reconstruction | null = null;
  let series: DailySeries | null = null;
  if (events.length > 0) {
    recon = reconstructBalances({ anchorT: state.asOf, anchor, events });
    series = buildDailySeries({ recon, events, linkContainer, price: (asset, day) => book.close(asset, day) });
  }
  const reconciliation = reconcile(anchor, events, (asset) => priceOf(asset, state.prices, state.fx));
  const containerTypes = new Map(state.containers.map((container) => [container.id, container.type]));
  return { state, points, ledger, events, linkContainer, book, recon, series, reconciliation, containerTypes };
}

export function invalidateDerived(hash: string): void {
  cache.delete(hash);
}

/** Profiles in the combined view: the user's trust, investments, and rows that name nobody's child. */
function userCombinedScope(state: PortfolioState): Set<string> {
  const set = new Set<string>([NO_CONTAINER]);
  for (const container of state.containers) {
    if (container.type === "child" || isChildProfileId(container.id)) continue;
    set.add(container.id);
  }
  return set;
}

/**
 * `all` is the user's trust and investments. A child profile id is that child
 * only. An unknown id falls back to the same combined user view.
 */
export function scopeSet(state: PortfolioState, scope: string | undefined): { id: string; set: Set<string> | null } {
  const user = userCombinedScope(state);
  if (!scope || scope === "all") return { id: "all", set: user };
  const child = childProfileById(scope);
  if (child) return { id: child.id, set: new Set([child.id]) };
  const match = state.containers.find((container) => container.id === scope);
  if (!match || isChildProfileId(match.id) || match.type === "child") return { id: "all", set: user };
  return { id: match.id, set: new Set([match.id]) };
}

export function inScope(set: Set<string> | null, containerId: string | null): boolean {
  return !set || set.has(containerKey(containerId));
}

export function eventInScope(derived: Derived, set: Set<string> | null, event: LedgerEvent): boolean {
  return !set || set.has(derived.linkContainer.get(event.linkId) ?? NO_CONTAINER);
}

export { parseBalanceKey };
