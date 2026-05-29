import { Platform } from "react-native";
import { ExtensionStorage } from "@bacons/apple-targets";

import type { Loan } from "@workspace/api-client-react";
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
};

export type LoanSnapshot = {
  aggregateLtv: number;
  totalDebtUsd: number;
  totalCollateralUsd: number;
  netEquityUsd: number;
  loanCount: number;
  closestAsset: string | null;
  closestLtv: number | null;
  priceDropPctToLiq: number | null;
  targetLtv: number;
  accounts: AccountBreakdown[];
  updatedAt: string;
};

export function buildSnapshot(
  loans: Loan[],
  targetLtv: number = DEFAULT_TARGET_LTV,
  accounts: AccountBreakdown[] = [],
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
    closestAsset: worst?.collateral.asset ?? null,
    closestLtv: worst?.ltv ?? null,
    priceDropPctToLiq: worst ? priceDropPctTo(worst, LIQ_LTV) : null,
    targetLtv,
    accounts,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Persists `snapshot` into the shared App Group so the WidgetKit extension
 * (see `targets/widget/`) can read it via UserDefaults(suiteName:), then asks
 * WidgetCenter to reload so the change shows up immediately rather than on the
 * widget's own ~15-minute timeline.
 *
 * Uses `ExtensionStorage` from `@bacons/apple-targets` (the same native module
 * that backs the widget targets). It is a safe no-op in Expo Go / on Android,
 * where the native module isn't present.
 */
export async function writeWidgetSnapshot(
  snapshot: LoanSnapshot,
): Promise<void> {
  if (Platform.OS !== "ios") return;
  try {
    const storage = new ExtensionStorage(APP_GROUP);
    storage.set(KEY, JSON.stringify(snapshot));
    // Force the home-screen, lock-screen and watch complications to refetch
    // the snapshot now instead of waiting for the next timeline tick.
    ExtensionStorage.reloadWidget();
  } catch (err) {
    // Don't crash the JS thread — widgets keep their last value — but log so a
    // broken App Group entitlement is visible in dev instead of a stuck widget.
    // eslint-disable-next-line no-console
    console.warn("[widgetSnapshot] failed to write App Group snapshot", err);
  }
}
