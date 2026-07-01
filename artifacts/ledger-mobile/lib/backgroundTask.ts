import * as BackgroundFetch from "expo-background-fetch";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";

import { loadStoredSession } from "@/lib/session";
import { checkAndNotifyLoans } from "@/lib/alerts";
import {
  getBinanceLinks,
  getLunoLinks,
  listContainers,
} from "@/lib/accountStore";
import { toBase64 } from "@/lib/encoding";
import { recordLtvSample } from "@/lib/ltvHistory";
import { recordLoanSnapshots } from "@/lib/loanSnapshots";
import { publishWidgetSnapshot } from "@/lib/widgetRefresh";
import {
  buildSnapshot,
  weightedApr,
  type AccountBreakdown,
} from "@/lib/widgetSnapshot";
import { DEFAULT_TARGET_LTV } from "@/utils/risk";

// Must match app.json → infoPlist.BGTaskSchedulerPermittedIdentifiers.
export const BACKGROUND_REFRESH_TASK = "com.ubuntu.life.ledger.refresh";

// 15 minutes is iOS's effective floor; the OS may extend it.
const MIN_INTERVAL_SECONDS = 15 * 60;

type LoanLite = {
  id: string;
  accountId: string;
  apr: number;
  ltv: number;
  debtUsd: number;
  collateral: { valueUsd: number; asset: string };
};

// Base64-encoded JSON of the linked accounts' credentials, matching the
// foreground builder in app/(tabs)/_layout.tsx. The /api/loans route is
// stateless — it can only fetch from Binance with the keys passed per request
// via these headers, so the headless task MUST send them too or the server
// returns zero loans.
function accountsHeader(
  links: Array<{ id: string; name: string; apiKey: string; apiSecret: string }>,
): string {
  return toBase64(
    JSON.stringify(
      links.map((l) => ({
        id: l.id,
        name: l.name,
        apiKey: l.apiKey,
        apiSecret: l.apiSecret,
      })),
    ),
  );
}

async function runRefresh(): Promise<BackgroundFetch.BackgroundFetchResult> {
  try {
    const domain = process.env.EXPO_PUBLIC_DOMAIN;
    if (!domain) return BackgroundFetch.BackgroundFetchResult.NoData;
    const session = await loadStoredSession();
    if (!session) return BackgroundFetch.BackgroundFetchResult.NoData;

    // Without linked Binance keys there's nothing to compute — and crucially we
    // must NOT fall through to the "zero out the widget" path below, which would
    // wipe the last-known figures whenever this ran credential-less.
    const [binanceLinks, lunoLinks] = await Promise.all([
      getBinanceLinks(),
      getLunoLinks(),
    ]);
    if (binanceLinks.length === 0) {
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }
    const headers: Record<string, string> = {
      authorization: `Bearer ${session.sessionToken}`,
      "X-Binance-Accounts": accountsHeader(binanceLinks),
    };
    if (lunoLinks.length > 0) {
      headers["X-Luno-Accounts"] = accountsHeader(lunoLinks);
    }
    const res = await fetch(`https://${domain}/api/loans`, { headers });
    if (!res.ok) return BackgroundFetch.BackgroundFetchResult.Failed;
    const body = (await res.json()) as { loans?: LoanLite[] };
    const loans = body.loans ?? [];
    if (loans.length === 0) {
      // No open loans: still refresh the widget so it zeroes out instead of
      // showing stale debt/LTV from before the loans were closed.
      await publishWidgetSnapshot([], DEFAULT_TARGET_LTV, [], {
        domain,
        sessionToken: session.sessionToken,
      });
      return BackgroundFetch.BackgroundFetchResult.NewData;
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
    // Per-account (Personal / Trust container) breakdown for the large widget.
    // The headless task can't read the RiskSettings context, so per-account
    // targets fall back to the default; the foreground write (on every app
    // open / refresh) carries the user-configured targets.
    let accountBreakdown: AccountBreakdown[] = [];
    try {
      const containers = await listContainers();
      accountBreakdown = containers.map((c) => {
        const ids = new Set(c.links.map((l) => l.id));
        const ls = loans.filter((l) => ids.has(l.accountId));
        const debt = ls.reduce((s, l) => s + l.debtUsd, 0);
        const col = ls.reduce((s, l) => s + l.collateral.valueUsd, 0);
        return {
          label: c.name,
          type: c.type,
          ltv: col > 0 ? (debt / col) * 100 : 0,
          debtUsd: debt,
          collateralUsd: col,
          targetLtv: DEFAULT_TARGET_LTV,
          loanCount: ls.length,
          weightedAprPct: weightedApr(ls),
        };
      });
    } catch {
      // Best-effort: if the account store can't be read, ship aggregate-only.
    }
    // The full Loan type is wider; the snapshot/alert helpers only use the
    // fields present here. Cast through unknown to placate the structural
    // check — bg-fetch keeps the JS bundle as cold-start small as possible.
    const fullLoans = loans as unknown as Parameters<typeof buildSnapshot>[0];
    await publishWidgetSnapshot(
      fullLoans,
      DEFAULT_TARGET_LTV,
      accountBreakdown,
      {
        domain,
        sessionToken: session.sessionToken,
      },
    );
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
