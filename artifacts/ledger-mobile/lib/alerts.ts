import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { listAlertRules, ruleAppliesTo, type AlertRule } from "@/lib/alertRules";
import { haptic } from "@/lib/haptics";
import type { Loan } from "@workspace/api-client-react";

const ENABLED_KEY = "ledger.alerts.enabled.v1";
const FIRED_KEY = "ledger.alerts.fired.v2";

// Map of "<ruleId>:<loanId>" → true once we've fired for an up-crossing.
// Resets when the loan drops back under the rule's threshold.
type FiredMap = Record<string, true>;

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

function key(ruleId: string, loanId: string): string {
  return `${ruleId}:${loanId}`;
}

/**
 * For each user-defined alert rule, fire a local notification on UP-crossings
 * since the last check. Each (rule, loan) pair fires once and resets when the
 * loan's LTV drops back under the threshold. No-op on web or when alerts are
 * disabled.
 */
export async function checkAndNotifyLoans(loans: Loan[]): Promise<void> {
  if (Platform.OS === "web") return;
  if (!(await getAlertsEnabled())) return;

  const rules = await listAlertRules();
  if (rules.length === 0) return;

  const fired = await readFired();
  const next: FiredMap = {};
  const toNotify: { rule: AlertRule; loan: Loan }[] = [];

  for (const loan of loans) {
    for (const rule of rules) {
      if (!ruleAppliesTo(rule, loan.id)) continue;
      const k = key(rule.id, loan.id);
      const over = loan.ltv >= rule.ltv;
      if (over) {
        next[k] = true;
        if (!fired[k]) toNotify.push({ rule, loan });
      }
      // when over=false, we simply omit k → resets, so a future crossing fires.
    }
  }

  await writeFired(next);

  // A foreground crossing buzzes the device; in background, haptics are a
  // no-op and the local notif itself supplies the alert.
  if (toNotify.length > 0) haptic.warning();
  for (const { rule, loan } of toNotify) {
    const pair = `${loan.collateral.asset}/${loan.asset}`;
    const label = rule.label ?? `${rule.ltv}% LTV`;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `${label} · ${pair}`,
        body: `LTV ${loan.ltv.toFixed(1)}% reached your ${rule.ltv}% threshold.`,
        data: { loanId: loan.id, ruleId: rule.id },
      },
      trigger: null,
    });
  }
}
