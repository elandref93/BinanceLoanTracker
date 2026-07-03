import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { getAlertsEnabled } from "@/lib/alerts";
import { haptic } from "@/lib/haptics";
import type {
  LoanAnnotation,
  LoanAnnotationMap,
} from "@/lib/loanAnnotations";

const FIRED_KEY = "ledger.alerts.rateFired.v1";

// Map of loanId → true once we've fired for a down-crossing. Resets when the
// live rate rises back above the documented conversion rate.
type FiredMap = Record<string, true>;

export function isStableBorrowAsset(asset: string): boolean {
  const a = asset.toUpperCase();
  return a === "USDC" || a === "USDT";
}

/**
 * ZAR per 1 borrowed stablecoin — the rate recorded when the asset was
 * converted to rands on Luno. Explicit `sellRate` wins; otherwise derived
 * from total ZAR received ÷ outstanding debt.
 */
export function documentedConversionRate(
  annotation: LoanAnnotation,
  debt: number,
): number | null {
  if (annotation.sellRate != null && annotation.sellRate > 0) {
    return annotation.sellRate;
  }
  if (
    annotation.borrowedValueZar != null &&
    annotation.borrowedValueZar > 0 &&
    debt > 0
  ) {
    return annotation.borrowedValueZar / debt;
  }
  return null;
}

/** Live Luno ZAR quote for a stablecoin borrow asset (USDT uses USDCZAR). */
export function lunoZarRateForAsset(
  asset: string,
  tickers: Map<string, number>,
): number | null {
  const a = asset.toUpperCase();
  if (a === "USDC" || a === "USDT") {
    const px = tickers.get("USDCZAR") ?? tickers.get(`${a}ZAR`) ?? 0;
    return px > 0 ? px : null;
  }
  const px = tickers.get(`${a}ZAR`) ?? 0;
  return px > 0 ? px : null;
}

export type RepaymentRateEval = {
  shouldNotify: boolean;
  documented: number | null;
  live: number | null;
  /** True when a custom target rate suppresses auto alerts. */
  suppressed: boolean;
};

export function evaluateRepaymentRateAlert(
  loan: { asset: string; debt: number },
  annotation: LoanAnnotation,
  tickers: Map<string, number>,
): RepaymentRateEval {
  if (
    annotation.targetRepaymentUsdcZarRate != null &&
    annotation.targetRepaymentUsdcZarRate > 0
  ) {
    return {
      shouldNotify: false,
      documented: documentedConversionRate(annotation, loan.debt),
      live: lunoZarRateForAsset(loan.asset, tickers),
      suppressed: true,
    };
  }
  if (!isStableBorrowAsset(loan.asset)) {
    return {
      shouldNotify: false,
      documented: null,
      live: null,
      suppressed: false,
    };
  }
  const documented = documentedConversionRate(annotation, loan.debt);
  const live = lunoZarRateForAsset(loan.asset, tickers);
  if (
    documented == null ||
    live == null ||
    documented <= 0 ||
    live <= 0
  ) {
    return { shouldNotify: false, documented, live, suppressed: false };
  }
  return {
    shouldNotify: live <= documented,
    documented,
    live,
    suppressed: false,
  };
}

async function readFired(): Promise<FiredMap> {
  try {
    const raw = await SecureStore.getItemAsync(FIRED_KEY);
    return raw ? (JSON.parse(raw) as FiredMap) : {};
  } catch {
    return {};
  }
}

async function writeFired(fired: FiredMap): Promise<void> {
  await SecureStore.setItemAsync(FIRED_KEY, JSON.stringify(fired));
}

type LoanForRateAlert = {
  id: string;
  asset: string;
  debt: number;
  collateral: { asset: string };
};

/**
 * Notify when Luno USDC/ZAR falls on or below the documented conversion rate
 * for a stablecoin loan. Skips loans with a custom target repayment rate.
 * Each loan fires once per down-crossing and resets when price recovers.
 */
export async function checkAndNotifyRepaymentRates(
  loans: LoanForRateAlert[],
  tickers: Map<string, number>,
  annotations: LoanAnnotationMap,
): Promise<void> {
  if (Platform.OS === "web") return;
  if (!(await getAlertsEnabled())) return;

  const fired = await readFired();
  const next: FiredMap = {};
  const toNotify: {
    loan: LoanForRateAlert;
    documented: number;
    live: number;
  }[] = [];

  for (const loan of loans) {
    const annotation = annotations[loan.id] ?? {};
    const evalResult = evaluateRepaymentRateAlert(loan, annotation, tickers);
    if (
      evalResult.documented == null ||
      evalResult.live == null ||
      evalResult.suppressed
    ) {
      continue;
    }
    const k = loan.id;
    if (evalResult.shouldNotify) {
      next[k] = true;
      if (!fired[k]) {
        toNotify.push({
          loan,
          documented: evalResult.documented,
          live: evalResult.live,
        });
      }
    }
  }

  await writeFired(next);

  if (toNotify.length > 0) haptic.success();
  for (const { loan, documented, live } of toNotify) {
    const pair = `${loan.collateral.asset}/${loan.asset}`;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `Favorable ${loan.asset}/ZAR · ${pair}`,
        body: `Luno ${loan.asset} is R${live.toFixed(2)} — at or below your conversion rate of R${documented.toFixed(2)}. You can repay with fewer rands per ${loan.asset}.`,
        data: { loanId: loan.id, kind: "repayment-rate" },
      },
      trigger: null,
    });
  }
}
