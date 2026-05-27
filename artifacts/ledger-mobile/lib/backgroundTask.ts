import * as BackgroundFetch from "expo-background-fetch";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";

import { loadStoredSession } from "@/lib/session";
import { checkAndNotifyLoans } from "@/lib/alerts";
import { recordLtvSample } from "@/lib/ltvHistory";
import { recordLoanSnapshots } from "@/lib/loanSnapshots";
import { buildSnapshot, writeWidgetSnapshot } from "@/lib/widgetSnapshot";
import { DEFAULT_TARGET_LTV } from "@/utils/risk";

// Must match app.json → infoPlist.BGTaskSchedulerPermittedIdentifiers.
export const BACKGROUND_REFRESH_TASK = "com.ubuntu.life.ledger.refresh";

// 15 minutes is iOS's effective floor; the OS may extend it.
const MIN_INTERVAL_SECONDS = 15 * 60;

type LoanLite = {
  id: string;
  apr: number;
  ltv: number;
  debtUsd: number;
  collateral: { valueUsd: number; asset: string };
};

async function runRefresh(): Promise<BackgroundFetch.BackgroundFetchResult> {
  try {
    const domain = process.env.EXPO_PUBLIC_DOMAIN;
    if (!domain) return BackgroundFetch.BackgroundFetchResult.NoData;
    const session = await loadStoredSession();
    if (!session) return BackgroundFetch.BackgroundFetchResult.NoData;
    const res = await fetch(`https://${domain}/api/loans`, {
      headers: { authorization: `Bearer ${session.sessionToken}` },
    });
    if (!res.ok) return BackgroundFetch.BackgroundFetchResult.Failed;
    const body = (await res.json()) as { loans?: LoanLite[] };
    const loans = body.loans ?? [];
    if (loans.length === 0) {
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }
    const totalDebt = loans.reduce((s, l) => s + l.debtUsd, 0);
    const totalCol = loans.reduce((s, l) => s + l.collateral.valueUsd, 0);
    const agg = totalCol > 0 ? (totalDebt / totalCol) * 100 : 0;
    await recordLtvSample(agg);
    await recordLoanSnapshots(
      loans.map((l) => ({
        id: l.id,
        apr: l.apr,
        ltv: l.ltv,
        debtUsd: l.debtUsd,
      })),
    );
    // The full Loan type is wider; the snapshot/alert helpers only use the
    // fields present here. Cast through unknown to placate the structural
    // check — bg-fetch keeps the JS bundle as cold-start small as possible.
    const fullLoans = loans as unknown as Parameters<typeof buildSnapshot>[0];
    await writeWidgetSnapshot(buildSnapshot(fullLoans, DEFAULT_TARGET_LTV));
    await checkAndNotifyLoans(fullLoans);
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
}

// Defining the task at module scope is required — TaskManager looks it up by
// name when the OS wakes the app in the background.
if (!TaskManager.isTaskDefined(BACKGROUND_REFRESH_TASK)) {
  TaskManager.defineTask(BACKGROUND_REFRESH_TASK, runRefresh);
}

/** Idempotent: safe to call on every cold start. */
export async function registerBackgroundRefresh(): Promise<void> {
  if (Platform.OS !== "ios") return;
  try {
    const status = await BackgroundFetch.getStatusAsync();
    if (status === BackgroundFetch.BackgroundFetchStatus.Restricted ||
        status === BackgroundFetch.BackgroundFetchStatus.Denied) {
      return;
    }
    const registered = await TaskManager.isTaskRegisteredAsync(
      BACKGROUND_REFRESH_TASK,
    );
    if (registered) return;
    await BackgroundFetch.registerTaskAsync(BACKGROUND_REFRESH_TASK, {
      minimumInterval: MIN_INTERVAL_SECONDS,
      stopOnTerminate: false,
      startOnBoot: true,
    });
  } catch {
    // Best-effort: simulator / Expo Go can't register, which is fine.
  }
}
