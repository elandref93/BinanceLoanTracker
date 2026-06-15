import type { LunoTransaction } from "@workspace/api-client-react";

import { displayAsset } from "./lunoPricing";

// Luno settles both legs of a trade at the same instant within one account, so
// a ZAR→asset buy appears as correlated wallet-ledger rows: ZAR outflow(s) and
// asset inflow(s) sharing the same account + timestamp. We group every row by
// account+timestamp and aggregate, then derive the effective buy rate from the
// grouped totals (sum ZAR out ÷ sum asset in). Aggregating avoids reusing a
// single ZAR leg across multiple fills/fee rows that share one timestamp.
//
// Within a group: an asset inflow funded by a ZAR outflow is a buy. An asset
// outflow with no ZAR inflow in the same group is a transfer out (typically the
// move to Binance) rather than a sell back into ZAR.

export type LunoBuy = {
  ts: string;
  accountName: string;
  /** Asset units received. */
  assetQty: number;
  /** ZAR spent (positive). */
  zarSpent: number;
  /** ZAR per asset unit. */
  rate: number;
};

export type LunoMove = {
  ts: string;
  accountName: string;
  /** Asset units moved out (positive). */
  assetQty: number;
  description: string;
};

export type LunoFunding = {
  buys: LunoBuy[];
  moves: LunoMove[];
};

/** Minimal container shape for scoping Luno txs to a Personal/Trust profile. */
export type LunoContainerLinks = {
  links: Array<{ id: string; exchange: string }>;
};

/**
 * Keep only Luno wallet-ledger rows belonging to the given profile container.
 * Loans are tied to a Binance link id; the matching Luno link shares the same
 * container (Personal or Trust).
 */
export function filterLunoTxsForContainer(
  txs: LunoTransaction[],
  container: LunoContainerLinks | undefined | null,
): LunoTransaction[] {
  if (!container) return [];
  const lunoLinkIds = new Set(
    container.links
      .filter((l) => l.exchange === "luno")
      .map((l) => l.id),
  );
  if (lunoLinkIds.size === 0) return [];
  return txs.filter((t) => lunoLinkIds.has(t.accountId));
}

type Group = {
  ts: string;
  accountName: string;
  assetIn: number;
  assetOut: number;
  zarIn: number;
  zarOut: number;
  outDescriptions: string[];
};

/**
 * Classify Luno wallet-ledger transactions into the ZAR→asset buys and the
 * subsequent transfers out for a single borrowed asset. `txs` should include
 * both the asset wallet and ZAR wallet rows so buys can be paired. Results are
 * newest-first.
 */
export function lunoFundingForAsset(
  txs: LunoTransaction[],
  assetSymbol: string,
): LunoFunding {
  const symbol = displayAsset(assetSymbol);
  if (!symbol) return { buys: [], moves: [] };

  // Bucket rows by account+timestamp, aggregating asset and ZAR flow totals.
  const groups = new Map<string, Group>();
  for (const t of txs) {
    const a = displayAsset(t.asset);
    const isAsset = a === symbol;
    const isZar = a === "ZAR";
    if (!isAsset && !isZar) continue;

    const key = `${t.accountId}@${t.ts}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        ts: t.ts,
        accountName: t.accountName,
        assetIn: 0,
        assetOut: 0,
        zarIn: 0,
        zarOut: 0,
        outDescriptions: [],
      };
      groups.set(key, g);
    }
    if (isAsset) {
      if (t.amount > 0) g.assetIn += t.amount;
      else if (t.amount < 0) {
        g.assetOut += -t.amount;
        if (t.description) g.outDescriptions.push(t.description);
      }
    } else {
      if (t.amount > 0) g.zarIn += t.amount;
      else if (t.amount < 0) g.zarOut += -t.amount;
    }
  }

  const buys: LunoBuy[] = [];
  const moves: LunoMove[] = [];
  for (const g of groups.values()) {
    // Buy: asset received, funded by ZAR spent in the same instant.
    if (g.assetIn > 0 && g.zarOut > 0) {
      buys.push({
        ts: g.ts,
        accountName: g.accountName,
        assetQty: g.assetIn,
        zarSpent: g.zarOut,
        rate: g.zarOut / g.assetIn,
      });
    }
    // Transfer out: asset left the wallet with no ZAR coming in (so not a sell).
    if (g.assetOut > 0 && g.zarIn === 0) {
      moves.push({
        ts: g.ts,
        accountName: g.accountName,
        assetQty: g.assetOut,
        description: g.outDescriptions[0] ?? "",
      });
    }
  }

  buys.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  moves.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  return { buys, moves };
}

export type RepaymentLike = {
  /** ISO timestamp of the Binance repayment. */
  ts: string;
  /** Asset units repaid (positive). */
  amount: number;
};

const DAY_MS = 86_400_000;
// A buy must fall within this many days before a repayment to be a candidate —
// you buy on Luno, move to Binance, then repay, so the buy precedes the repay.
const MATCH_WINDOW_DAYS = 60;
// Small forward tolerance for clock skew / ordering (buy stamped slightly after).
const FORWARD_SKEW_DAYS = 2;
// A 100% asset-amount mismatch costs this many "days" of time distance, so
// timing and amount both steer the match without one dominating outright.
const AMOUNT_PENALTY_DAYS = 14;
// Reject a match when the buy's asset quantity differs from the repayment by
// more than this fraction — guards against confidently labeling an unrelated
// buy as "the" funding for a repayment.
const MAX_AMOUNT_DEVIATION = 0.5;

/**
 * Match each repayment to the nearest preceding Luno buy of the same asset,
 * scoring by time proximity and asset-amount similarity. Each buy is consumed
 * at most once. Returns matched buys aligned to the input `repayments` order
 * (null where no confident match exists). `buys` should be the asset's buys
 * from {@link lunoFundingForAsset}.
 */
export function matchRepaymentsToBuys(
  repayments: RepaymentLike[],
  buys: LunoBuy[],
): (LunoBuy | null)[] {
  const result: (LunoBuy | null)[] = repayments.map(() => null);
  const consumed = new Set<number>();
  // Assign oldest repayment first for stable, greedy matching.
  const order = repayments
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r.ts < b.r.ts ? -1 : 1));

  for (const { r, i } of order) {
    const repayMs = new Date(r.ts).getTime();
    if (Number.isNaN(repayMs)) continue;
    let bestIdx = -1;
    let bestScore = Infinity;
    for (let j = 0; j < buys.length; j++) {
      if (consumed.has(j)) continue;
      const b = buys[j];
      const buyMs = new Date(b.ts).getTime();
      if (Number.isNaN(buyMs)) continue;
      const gapDays = (repayMs - buyMs) / DAY_MS; // positive ⇒ buy before repay
      if (gapDays < -FORWARD_SKEW_DAYS || gapDays > MATCH_WINDOW_DAYS) continue;
      const amountDiff =
        r.amount > 0 ? Math.abs(b.assetQty - r.amount) / r.amount : 0;
      // Don't claim a match when the quantities are too far apart.
      if (amountDiff > MAX_AMOUNT_DEVIATION) continue;
      const score = Math.abs(gapDays) + amountDiff * AMOUNT_PENALTY_DAYS;
      if (score < bestScore) {
        bestScore = score;
        bestIdx = j;
      }
    }
    if (bestIdx >= 0) {
      consumed.add(bestIdx);
      result[i] = buys[bestIdx];
    }
  }
  return result;
}

/** Weighted-average ZAR→asset buy rate across all buys (null if none). */
export function averageBuyRate(buys: LunoBuy[]): number | null {
  let zar = 0;
  let asset = 0;
  for (const b of buys) {
    zar += b.zarSpent;
    asset += b.assetQty;
  }
  return asset > 0 ? zar / asset : null;
}
