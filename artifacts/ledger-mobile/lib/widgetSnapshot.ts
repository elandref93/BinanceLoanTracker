import { NativeModules, Platform } from "react-native";

import type { Loan } from "@workspace/api-client-react";
import { DEFAULT_TARGET_LTV, LIQ_LTV, priceDropPctTo } from "@/utils/risk";

const APP_GROUP = "group.com.ledger.shared";
const KEY = "ledger.snapshot.v1";

export type LoanSnapshot = {
  aggregateLtv: number;
  totalDebtUsd: number;
  totalCollateralUsd: number;
  closestAsset: string | null;
  closestLtv: number | null;
  priceDropPctToLiq: number | null;
  targetLtv: number;
  updatedAt: string;
};

export function buildSnapshot(
  loans: Loan[],
  targetLtv: number = DEFAULT_TARGET_LTV,
): LoanSnapshot {
  const totalDebt = loans.reduce((s, l) => s + l.debtUsd, 0);
  const totalCol = loans.reduce((s, l) => s + l.collateral.valueUsd, 0);
  const agg = totalCol > 0 ? (totalDebt / totalCol) * 100 : 0;
  const worst = [...loans].sort((a, b) => b.ltv - a.ltv)[0] ?? null;
  return {
    aggregateLtv: agg,
    totalDebtUsd: totalDebt,
    totalCollateralUsd: totalCol,
    closestAsset: worst?.collateral.asset ?? null,
    closestLtv: worst?.ltv ?? null,
    priceDropPctToLiq: worst ? priceDropPctTo(worst, LIQ_LTV) : null,
    targetLtv,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Persists `snapshot` into the shared App Group so the WidgetKit extension
 * (see `ios-widget/`) can read it via UserDefaults(suiteName:).
 *
 * Implementation note: Expo Go has no access to app groups, so this is a
 * no-op there. In a dev build / TestFlight build it uses the native
 * `SharedGroupPreferences` bridge if installed, and falls back silently
 * if the bridge is missing (so the JS side can ship before the widget
 * target lands in Xcode).
 */
export async function writeWidgetSnapshot(
  snapshot: LoanSnapshot,
): Promise<void> {
  if (Platform.OS !== "ios") return;
  const mod = (NativeModules as Record<string, unknown>)
    .SharedGroupPreferences as
    | {
        setItem: (key: string, value: string, group: string) => Promise<void>;
      }
    | undefined;
  if (!mod?.setItem) return;
  try {
    await mod.setItem(KEY, JSON.stringify(snapshot), APP_GROUP);
  } catch {
    // Swallow — widgets will just keep their last value.
  }
}
