import { dayRange, jhbDay } from "./time";
import type { LedgerEvent } from "./types";

/** Balance key: link, asset, and whether the quantity is debt. */
export function balanceKey(linkId: string, asset: string, debt: boolean): string {
  return `${linkId}|${asset}|${debt ? "D" : "A"}`;
}

export function parseBalanceKey(key: string): { linkId: string; asset: string; debt: boolean } {
  const [linkId = "", asset = "", kind = "A"] = key.split("|");
  return { linkId, asset, debt: kind === "D" };
}

export interface Reconstruction {
  days: string[];
  /** End-of-day balances, one map per entry in `days`. */
  endOfDay: Array<Map<string, number>>;
  /** Balances implied before the first imported event. */
  opening: Map<string, number>;
  /** Corrections where the history could not explain the anchor balance. */
  adjustments: LedgerEvent[];
}

const EPSILON = 1e-9;

/**
 * Rebuilds daily balances by starting from the exact anchor balances (the
 * latest snapshot) and undoing events newest-first. When undoing an inflow
 * would make a balance negative, events must be missing after it; the
 * balance is clamped to zero and the gap is recorded as a flagged
 * adjustment at that moment, so later days still match the anchor.
 */
export function reconstructBalances(input: {
  anchorT: number;
  anchor: Map<string, number>;
  events: LedgerEvent[];
  fromDay?: string;
}): Reconstruction {
  const events = input.events.filter((event) => event.t <= input.anchorT).sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
  const anchorDay = jhbDay(input.anchorT);
  const firstDay = input.fromDay ?? (events[0] ? jhbDay(events[0].t) : anchorDay);
  const days = dayRange(firstDay < anchorDay ? firstDay : anchorDay, anchorDay);
  const endOfDay: Array<Map<string, number>> = new Array(days.length);
  const adjustments: LedgerEvent[] = [];
  const balances = new Map(input.anchor);
  let eventIndex = events.length - 1;

  for (let dayIndex = days.length - 1; dayIndex >= 0; dayIndex--) {
    const day = days[dayIndex] as string;
    endOfDay[dayIndex] = new Map(balances);
    while (eventIndex >= 0) {
      const event = events[eventIndex] as LedgerEvent;
      if (jhbDay(event.t) !== day) {
        if (jhbDay(event.t) > day) {
          eventIndex--;
          continue;
        }
        break;
      }
      const key = balanceKey(event.linkId, event.asset, event.debt === true);
      const before = (balances.get(key) ?? 0) - event.qty;
      if (before < -EPSILON) {
        adjustments.push({
          id: `adj:${event.id}`,
          t: event.t,
          exchange: event.exchange,
          linkId: event.linkId,
          type: "adjustment",
          asset: event.asset,
          qty: before,
          debt: event.debt,
          external: true,
          flagged: true,
          note: "Balance could not be explained by imported history",
        });
        balances.set(key, 0);
      } else {
        balances.set(key, Math.abs(before) < EPSILON ? 0 : before);
      }
      eventIndex--;
    }
  }
  return { days, endOfDay, opening: balances, adjustments };
}

/**
 * Compares the anchor with what the imported history implies from zero.
 * Large unexplained differences are flagged (above 2% and above $5).
 */
export function reconcile(
  anchor: Map<string, number>,
  events: LedgerEvent[],
  priceUsd: (asset: string) => number,
): Array<{ key: string; snapshotQty: number; ledgerQty: number; adjustmentQty: number; adjustmentUsd: number; flagged: boolean }> {
  const implied = new Map<string, number>();
  for (const event of events) {
    const key = balanceKey(event.linkId, event.asset, event.debt === true);
    implied.set(key, (implied.get(key) ?? 0) + event.qty);
  }
  const keys = new Set([...anchor.keys(), ...implied.keys()]);
  const rows = [];
  for (const key of keys) {
    const snapshotQty = anchor.get(key) ?? 0;
    const ledgerQty = implied.get(key) ?? 0;
    const adjustmentQty = snapshotQty - ledgerQty;
    const { asset } = parseBalanceKey(key);
    const adjustmentUsd = adjustmentQty * priceUsd(asset);
    const relative = Math.abs(snapshotQty) > EPSILON ? Math.abs(adjustmentQty / snapshotQty) : Math.abs(adjustmentQty) > EPSILON ? 1 : 0;
    rows.push({
      key,
      snapshotQty,
      ledgerQty,
      adjustmentQty,
      adjustmentUsd,
      flagged: relative > 0.02 && Math.abs(adjustmentUsd) > 5,
    });
  }
  return rows.sort((a, b) => Math.abs(b.adjustmentUsd) - Math.abs(a.adjustmentUsd));
}
