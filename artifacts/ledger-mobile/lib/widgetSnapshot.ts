import { Platform } from "react-native";
import { ExtensionStorage } from "@bacons/apple-targets";

import type { Loan } from "@workspace/api-client-react";
import { reportError } from "@/lib/crashReporting";
import { displayAsset } from "@/lib/lunoPricing";
import { DEFAULT_TARGET_LTV, LIQ_LTV, priceDropPctTo } from "@/utils/risk";

const APP_GROUP = "group.com.ledger.shared";
const KEY = "ledger.snapshot.v1";

/** Per-account (Personal / Trust container) rollup shown in the large widget. */
export type AccountBreakdown = {
  label: string;
  type: string;
  ltv: number;
  debtUsd: number;
  collateralUsd: number;
  targetLtv: number;
  loanCount: number;
  /** Debt-weighted APR (percent) across the account's loans; null if no debt. */
  weightedAprPct: number | null;
};

/** Live Luno quotes written alongside loan health for widget market rows. */
export type MarketQuotes = {
  btcUsd: number | null;
  btcZar: number | null;
  /** Dominant borrowed asset by USD debt (e.g. USDC). */
  lendAsset: string | null;
  /** Luno {asset}ZAR last trade for the lend asset. */
  lendAssetZar: number | null;
};

export type LoanSnapshot = {
  aggregateLtv: number;
  totalDebtUsd: number;
  totalCollateralUsd: number;
  netEquityUsd: number;
  loanCount: number;
  /** Debt-weighted APR (percent) across all loans; null if no debt. */
  weightedAprPct: number | null;
  closestAsset: string | null;
  closestLtv: number | null;
  priceDropPctToLiq: number | null;
  targetLtv: number;
  accounts: AccountBreakdown[];
  markets: MarketQuotes | null;
  updatedAt: string;
};

/** Debt-weighted average APR (percent) across `loans`; null when no debt. */
export function weightedApr(
  loans: { apr: number; debtUsd: number }[],
): number | null {
  const debt = loans.reduce((s, l) => s + l.debtUsd, 0);
  if (debt <= 0) return null;
  return loans.reduce((s, l) => s + l.apr * l.debtUsd, 0) / debt;
}

/** Borrowed asset with the largest USD debt across open loans. */
export function dominantBorrowAsset(
  loans: { asset: string; debtUsd: number }[],
): string | null {
  if (loans.length === 0) return null;
  const byDebt = new Map<string, number>();
  for (const l of loans) {
    byDebt.set(l.asset, (byDebt.get(l.asset) ?? 0) + l.debtUsd);
  }
  let best = "";
  let bestDebt = 0;
  for (const [asset, debt] of byDebt) {
    if (debt > bestDebt) {
      best = asset;
      bestDebt = debt;
    }
  }
  return best || null;
}

/** Luno pairs the widget snapshot needs (BTC USD/ZAR + dominant lend asset ZAR). */
export function widgetMarketPairs(
  loans: { asset: string }[],
): string[] {
  const set = new Set<string>(["XBTUSDC", "XBTZAR"]);
  const lend = dominantBorrowAsset(
    loans as { asset: string; debtUsd: number }[],
  );
  if (lend) {
    const a = lend.toUpperCase();
    if (a === "USDC" || a === "USDT") {
      set.add("USDCZAR");
    } else {
      set.add(`${a}ZAR`);
    }
  }
  return Array.from(set);
}

export function buildMarketQuotes(
  loans: { asset: string; debtUsd: number }[],
  tickers: Map<string, number> | Record<string, number>,
): MarketQuotes {
  const map =
    tickers instanceof Map
      ? tickers
      : new Map(Object.entries(tickers as Record<string, number>));
  const lendAsset = dominantBorrowAsset(loans);
  let lendAssetZar: number | null = null;
  if (lendAsset) {
    const a = lendAsset.toUpperCase();
    if (a === "USDC" || a === "USDT") {
      lendAssetZar = map.get("USDCZAR") ?? map.get(`${a}ZAR`) ?? null;
    } else {
      lendAssetZar = map.get(`${a}ZAR`) ?? null;
    }
  }
  return {
    btcUsd: map.get("XBTUSDC") ?? null,
    btcZar: map.get("XBTZAR") ?? null,
    lendAsset: lendAsset ? displayAsset(lendAsset) : null,
    lendAssetZar,
  };
}

export function buildSnapshot(
  loans: Loan[],
  targetLtv: number = DEFAULT_TARGET_LTV,
  accounts: AccountBreakdown[] = [],
  markets: MarketQuotes | null = null,
): LoanSnapshot {
  const totalDebt = loans.reduce((s, l) => s + l.debtUsd, 0);
  const totalCol = loans.reduce((s, l) => s + l.collateral.valueUsd, 0);
  const agg = totalCol > 0 ? (totalDebt / totalCol) * 100 : 0;
  const worst = [...loans].sort((a, b) => b.ltv - a.ltv)[0] ?? null;
  return {
    aggregateLtv: agg,
    totalDebtUsd: totalDebt,
    totalCollateralUsd: totalCol,
    netEquityUsd: totalCol - totalDebt,
    loanCount: loans.length,
    weightedAprPct: weightedApr(loans),
    closestAsset: worst?.collateral.asset ?? null,
    closestLtv: worst?.ltv ?? null,
    priceDropPctToLiq: worst ? priceDropPctTo(worst, LIQ_LTV) : null,
    targetLtv,
    accounts,
    markets,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Persists `snapshot` into the shared App Group so the WidgetKit extension
 * (see `targets/widget/`) can read it via UserDefaults(suiteName:), then asks
 * WidgetCenter to reload so the change shows up immediately rather than on the
 * widget's own ~15-minute timeline.
 */
export async function writeWidgetSnapshot(
  snapshot: LoanSnapshot,
): Promise<void> {
  if (Platform.OS !== "ios") return;
  try {
    const storage = new ExtensionStorage(APP_GROUP);
    storage.set(KEY, JSON.stringify(snapshot));
    ExtensionStorage.reloadWidget();
  } catch (err) {
    reportError(err, { op: "widgetSnapshot.write" });
  }
}
