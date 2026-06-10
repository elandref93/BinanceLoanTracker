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
