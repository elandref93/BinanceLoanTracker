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

// Map of "<kind>:<loanId>" → true once fired for a down-crossing. Resets when
// the live rate rises back above the threshold.
type FiredMap = Record<string, true>;

export type RepaymentRateAlertKind = "conversion" | "target";

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
  kind: RepaymentRateAlertKind;
  shouldNotify: boolean;
  threshold: number | null;
  live: number | null;
};

function firedKey(kind: RepaymentRateAlertKind, loanId: string): string {
  return `${kind}:${loanId}`;
}

/**
 * Evaluate repayment-rate alerts for one loan. When a custom target rate is
 * set, only that threshold is monitored; otherwise the documented conversion
 * rate drives notifications.
 */
export function evaluateRepaymentRateAlerts(
  loan: { asset: string; debt: number },
  annotation: LoanAnnotation,
  tickers: Map<string, number>,
): RepaymentRateEval[] {
  if (!isStableBorrowAsset(loan.asset)) return [];

  const live = lunoZarRateForAsset(loan.asset, tickers);
  if (live == null || live <= 0) return [];

  const target = annotation.targetRepaymentUsdcZarRate;
  if (target != null && target > 0) {
    return [
      {
        kind: "target",
        shouldNotify: live <= target,
        threshold: target,
        live,
      },
    ];
  }

  const documented = documentedConversionRate(annotation, loan.debt);
  if (documented == null || documented <= 0) return [];

  return [
    {
      kind: "conversion",
      shouldNotify: live <= documented,
      threshold: documented,
      live,
    },
  ];
}

/** @deprecated Use evaluateRepaymentRateAlerts — kept for existing tests. */
export function evaluateRepaymentRateAlert(
  loan: { asset: string; debt: number },
  annotation: LoanAnnotation,
  tickers: Map<string, number>,
): RepaymentRateEval & { documented: number | null; suppressed: boolean } {
  const evals = evaluateRepaymentRateAlerts(loan, annotation, tickers);
  const conversion = evals.find((e) => e.kind === "conversion");
  const target = evals.find((e) => e.kind === "target");
  const active = conversion ?? target;
  const suppressed = target != null;
  return {
    kind: active?.kind ?? "conversion",
    shouldNotify: active?.shouldNotify ?? false,
    threshold: active?.threshold ?? null,
    live: active?.live ?? lunoZarRateForAsset(loan.asset, tickers),
    documented: documentedConversionRate(annotation, loan.debt),
    suppressed,
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

type PendingNotification = {
  loan: LoanForRateAlert;
  eval: RepaymentRateEval;
};

/**
 * Notify when Luno USDC/ZAR falls on or below either:
 * - the documented conversion rate (default), or
 * - a custom target repayment rate when one is set.
 * Each (kind, loan) pair fires once per down-crossing and resets when price
 * recovers.
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
  const toNotify: PendingNotification[] = [];

  for (const loan of loans) {
    const annotation = annotations[loan.id] ?? {};
    const evals = evaluateRepaymentRateAlerts(loan, annotation, tickers);
    for (const evalResult of evals) {
      if (evalResult.threshold == null || evalResult.live == null) continue;
      const k = firedKey(evalResult.kind, loan.id);
      if (evalResult.shouldNotify) {
        next[k] = true;
        if (!fired[k]) {
          toNotify.push({ loan, eval: evalResult });
        }
      }
    }
  }

  await writeFired(next);

  if (toNotify.length > 0) haptic.success();
  for (const { loan, eval: evalResult } of toNotify) {
    const pair = `${loan.collateral.asset}/${loan.asset}`;
    const live = evalResult.live!;
    const threshold = evalResult.threshold!;
    const isTarget = evalResult.kind === "target";
    await Notifications.scheduleNotificationAsync({
      content: {
        title: isTarget
          ? `Target ${loan.asset}/ZAR reached · ${pair}`
          : `Favorable ${loan.asset}/ZAR · ${pair}`,
        body: isTarget
          ? `Luno ${loan.asset} is R${live.toFixed(2)} — at or below your target repayment rate of R${threshold.toFixed(2)}.`
          : `Luno ${loan.asset} is R${live.toFixed(2)} — at or below your conversion rate of R${threshold.toFixed(2)}. You can repay with fewer rands per ${loan.asset}.`,
        data: {
          loanId: loan.id,
          kind: isTarget ? "repayment-target-rate" : "repayment-rate",
        },
      },
      trigger: null,
    });
  }
}
