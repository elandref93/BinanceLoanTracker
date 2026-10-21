import type { LunoTransaction } from "@workspace/api-client-react";

/**
 * Luno buy/transfer classification ported from the mobile app.
 * Amounts come only from the wallet rows passed in.
 */

export type LunoBuy = {
  ts: string;
  accountName: string;
  assetQty: number;
  zarSpent: number;
  rate: number;
};

export type LunoMove = {
  ts: string;
  accountName: string;
  assetQty: number;
  description: string;
};

export type LunoFunding = {
  buys: LunoBuy[];
  moves: LunoMove[];
};

export type LunoContainerLinks = {
  links: Array<{ id: string; exchange: string }>;
};

export function displayAsset(asset: string): string {
  return asset.toUpperCase() === "XBT" ? "BTC" : asset.toUpperCase();
}

export function filterLunoTxsForContainer(
  txs: LunoTransaction[],
  container: LunoContainerLinks | undefined | null,
): LunoTransaction[] {
  if (!container) return [];
  const lunoLinkIds = new Set(
    container.links.filter((link) => link.exchange === "luno").map((link) => link.id),
  );
  if (lunoLinkIds.size === 0) return [];
  return txs.filter((tx) => lunoLinkIds.has(tx.accountId));
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

export function lunoFundingForAsset(txs: LunoTransaction[], assetSymbol: string): LunoFunding {
  const symbol = displayAsset(assetSymbol);
  if (!symbol) return { buys: [], moves: [] };

  const groups = new Map<string, Group>();
  for (const tx of txs) {
    const asset = displayAsset(tx.asset);
    const isAsset = asset === symbol;
    const isZar = asset === "ZAR";
    if (!isAsset && !isZar) continue;

    const key = `${tx.accountId}@${tx.ts}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        ts: tx.ts,
        accountName: tx.accountName,
        assetIn: 0,
        assetOut: 0,
        zarIn: 0,
        zarOut: 0,
        outDescriptions: [],
      };
      groups.set(key, group);
    }
    if (isAsset) {
      if (tx.amount > 0) group.assetIn += tx.amount;
      else if (tx.amount < 0) {
        group.assetOut += -tx.amount;
        if (tx.description) group.outDescriptions.push(tx.description);
      }
    } else if (tx.amount > 0) {
      group.zarIn += tx.amount;
    } else if (tx.amount < 0) {
      group.zarOut += -tx.amount;
    }
  }

  const buys: LunoBuy[] = [];
  const moves: LunoMove[] = [];
  for (const group of groups.values()) {
    if (group.assetIn > 0 && group.zarOut > 0) {
      buys.push({
        ts: group.ts,
        accountName: group.accountName,
        assetQty: group.assetIn,
        zarSpent: group.zarOut,
        rate: group.zarOut / group.assetIn,
      });
    }
    if (group.assetOut > 0 && group.zarIn === 0) {
      moves.push({
        ts: group.ts,
        accountName: group.accountName,
        assetQty: group.assetOut,
        description: group.outDescriptions[0] ?? "",
      });
    }
  }

  buys.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  moves.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  return { buys, moves };
}

export type RepaymentLike = {
  ts: string;
  amount: number;
};

const DAY_MS = 86_400_000;
const MATCH_WINDOW_DAYS = 60;
const FORWARD_SKEW_DAYS = 2;
const AMOUNT_PENALTY_DAYS = 14;
const MAX_AMOUNT_DEVIATION = 0.5;

export function matchRepaymentsToBuys(
  repayments: RepaymentLike[],
  buys: LunoBuy[],
): (LunoBuy | null)[] {
  const result: (LunoBuy | null)[] = repayments.map(() => null);
  const consumed = new Set<number>();
  const order = repayments
    .map((repayment, index) => ({ repayment, index }))
    .sort((a, b) => (a.repayment.ts < b.repayment.ts ? -1 : 1));

  for (const { repayment, index } of order) {
    const repayMs = new Date(repayment.ts).getTime();
    if (Number.isNaN(repayMs)) continue;
    let bestIdx = -1;
    let bestScore = Infinity;
    for (let buyIndex = 0; buyIndex < buys.length; buyIndex += 1) {
      if (consumed.has(buyIndex)) continue;
      const buy = buys[buyIndex];
      if (!buy) continue;
      const buyMs = new Date(buy.ts).getTime();
      if (Number.isNaN(buyMs)) continue;
      const gapDays = (repayMs - buyMs) / DAY_MS;
      if (gapDays < -FORWARD_SKEW_DAYS || gapDays > MATCH_WINDOW_DAYS) continue;
      const amountDiff =
        repayment.amount > 0 ? Math.abs(buy.assetQty - repayment.amount) / repayment.amount : 0;
      if (amountDiff > MAX_AMOUNT_DEVIATION) continue;
      const score = Math.abs(gapDays) + amountDiff * AMOUNT_PENALTY_DAYS;
      if (score < bestScore) {
        bestScore = score;
        bestIdx = buyIndex;
      }
    }
    if (bestIdx >= 0) {
      consumed.add(bestIdx);
      result[index] = buys[bestIdx] ?? null;
    }
  }
  return result;
}
