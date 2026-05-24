import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { LIQ_LTV, WARNING_LTV } from "@/utils/risk";
import type { Loan } from "@workspace/api-client-react";

const ENABLED_KEY = "ledger.alerts.enabled.v1";
const SEEN_KEY = "ledger.alerts.seen.v1";

type Tier = "warn" | "liq";

type SeenMap = Record<string, Tier | null>;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function getAlertsEnabled(): Promise<boolean> {
  const v = await SecureStore.getItemAsync(ENABLED_KEY);
  return v === "1";
}

export async function setAlertsEnabled(enabled: boolean): Promise<boolean> {
  if (enabled) {
    const granted = await ensurePermissions();
    if (!granted) return false;
  }
  await SecureStore.setItemAsync(ENABLED_KEY, enabled ? "1" : "0");
  return true;
}

async function ensurePermissions(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const req = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  return req.granted;
}

async function readSeen(): Promise<SeenMap> {
  try {
    const raw = await SecureStore.getItemAsync(SEEN_KEY);
    return raw ? (JSON.parse(raw) as SeenMap) : {};
  } catch {
    return {};
  }
}

async function writeSeen(seen: SeenMap): Promise<void> {
  await SecureStore.setItemAsync(SEEN_KEY, JSON.stringify(seen));
}

function tierFor(ltv: number): Tier | null {
  if (ltv >= LIQ_LTV) return "liq";
  if (ltv >= WARNING_LTV) return "warn";
  return null;
}

function tierRank(t: Tier | null): number {
  return t === "liq" ? 2 : t === "warn" ? 1 : 0;
}

/**
 * Fire a local notification for each loan that crossed *up* into a worse tier
 * since the last check. No-op when alerts are disabled, on web, or when the
 * loan was already at that tier on the previous refresh.
 */
export async function checkAndNotifyLoans(loans: Loan[]): Promise<void> {
  if (Platform.OS === "web") return;
  if (!(await getAlertsEnabled())) return;

  const seen = await readSeen();
  const next: SeenMap = {};
  const toNotify: { loan: Loan; tier: Tier }[] = [];

  for (const loan of loans) {
    const tier = tierFor(loan.ltv);
    next[loan.id] = tier;
    const prev = seen[loan.id] ?? null;
    if (tier && tierRank(tier) > tierRank(prev)) {
      toNotify.push({ loan, tier });
    }
  }

  await writeSeen(next);

  for (const { loan, tier } of toNotify) {
    const pair = `${loan.collateral.asset}/${loan.asset}`;
    const title =
      tier === "liq"
        ? `Liquidation risk: ${pair}`
        : `LTV warning: ${pair}`;
    const body =
      tier === "liq"
        ? `LTV ${loan.ltv.toFixed(1)}% is at or above the liquidation threshold (${LIQ_LTV}%).`
        : `LTV ${loan.ltv.toFixed(1)}% crossed the ${WARNING_LTV}% warning line.`;
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: { loanId: loan.id, tier },
      },
      trigger: null,
    });
  }
}
