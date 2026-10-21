import {
  useGetLunoTicker,
  useGetPortfolioAnalytics,
  useGetPortfolioAsset,
  useGetPortfolioAssets,
  useGetPortfolioImportStatus,
  useGetPortfolioLoans,
  useGetPortfolioOverview,
  useGetPortfolioPerformance,
  type CgtMethod,
  type LunoTicker,
  type PerformanceRange,
} from "@workspace/api-client-react";
import { keepPreviousData } from "@tanstack/react-query";
import { useEffect } from "react";

import { viewScope } from "@/prefs/preferences";
import { usePrefs } from "@/prefs/PreferencesProvider";
import { useBrowserSession } from "@/session/SessionProvider";
import { useReportAsOf } from "@/shell/RefreshProvider";

export function useScopeParam(): string | undefined {
  const { person, scope } = usePrefs();
  const view = viewScope(person, scope);
  return view === "all" ? undefined : view;
}

function useSignedIn(): boolean {
  return useBrowserSession().user != null;
}

/** A down API keeps polling. A 4xx is a finished answer, so it does not spin in the background. */
function retryWhileFailing(query: { state: { status: string; error: unknown } }): number | false {
  if (query.state.status !== "error") return false;
  const status = (query.state.error as { status?: unknown } | null)?.status;
  if (typeof status === "number" && status >= 400 && status < 500 && status !== 429) return false;
  return 5_000;
}

const recover = {
  refetchInterval: retryWhileFailing,
  refetchIntervalInBackground: true,
  refetchOnMount: "always" as const,
};

/** Net worth, P&L periods, allocation and movers. Also feeds the freshness chip and the ZAR rate. */
export function useOverview() {
  const scope = useScopeParam();
  const signedIn = useSignedIn();
  const query = useGetPortfolioOverview(scope ? { scope } : undefined, {
    query: { enabled: signedIn, placeholderData: keepPreviousData, ...recover } as never,
  });
  useReportAsOf(query.data?.asOf);
  useReportFx(query.data?.fxUsdToZar);
  return query;
}

export function usePerformance(range: PerformanceRange) {
  const scope = useScopeParam();
  const signedIn = useSignedIn();
  return useGetPortfolioPerformance(scope ? { range, scope } : { range }, {
    query: { enabled: signedIn, placeholderData: keepPreviousData, ...recover } as never,
  });
}

function useReportFx(rate: number | null | undefined): void {
  const { reportFx } = usePrefs();
  useEffect(() => {
    reportFx(rate);
  }, [rate, reportFx]);
}

/** Live Luno USDC/ZAR. Disabled until a holdings row actually owes USDC. */
export function useLunoUsdcTicker(enabled: boolean) {
  const signedIn = useSignedIn();
  return useGetLunoTicker(
    { pair: "USDCZAR" },
    {
      query: {
        enabled: signedIn && enabled,
        staleTime: 30_000,
        refetchInterval: signedIn && enabled ? 60_000 : false,
        retry: 1,
      },
    },
  );
}

export function lunoUsdcQuote(ticker: LunoTicker | undefined): { bid: number; ask: number; lastTrade: number } | null {
  if (!ticker) return null;
  return { bid: ticker.bid, ask: ticker.ask, lastTrade: ticker.lastTrade };
}

export function useAssets() {
  const scope = useScopeParam();
  const signedIn = useSignedIn();
  const query = useGetPortfolioAssets(scope ? { scope } : undefined, {
    query: { enabled: signedIn, placeholderData: keepPreviousData, ...recover } as never,
  });
  useReportAsOf(query.data?.asOf);
  useReportFx(query.data?.fxUsdToZar);
  return query;
}

/** Open loans with each profile's target, trigger prices and LTV history. */
export function useLoans(range: PerformanceRange, enabled = true) {
  const scope = useScopeParam();
  const signedIn = useSignedIn();
  const query = useGetPortfolioLoans(scope ? { scope, range } : { range }, {
    query: { enabled: signedIn && enabled, placeholderData: keepPreviousData, ...recover } as never,
  });
  useReportAsOf(query.data?.asOf);
  useReportFx(query.data?.fxUsdToZar);
  return query;
}

export function useAssetDetail(asset: string) {
  const scope = useScopeParam();
  const signedIn = useSignedIn();
  const encoded = encodeURIComponent(asset);
  const query = useGetPortfolioAsset(encoded, scope ? { scope } : undefined, {
    query: { enabled: signedIn && asset.length > 0, placeholderData: keepPreviousData, ...recover } as never,
  });
  useReportFx(query.data?.fxUsdToZar);
  return query;
}

const SOURCE_LABELS: Record<string, string> = {
  "earn-rewards": "Earn rewards",
  "margin-loans": "Margin loans",
  pay: "Pay",
};

export function historySourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source.replace(/-/g, " ");
}

/** Sources that failed or that this account cannot use. Names only. */
export function blockedHistorySources(sources: { source: string; state: string }[] | undefined): string[] {
  const names = new Set<string>();
  for (const source of sources ?? []) {
    if (source.state === "error" || source.state === "unavailable") names.add(historySourceLabel(source.source));
  }
  return [...names];
}

/** Polls every 15 seconds while the history import is still running. */
export function useImportStatus(enabled = true) {
  const signedIn = useSignedIn();
  return useGetPortfolioImportStatus({
    query: {
      enabled: signedIn && enabled,
      refetchInterval: (query: { state: { data?: { state?: string } } }) => {
        const state = query.state.data?.state;
        return state === "running" || state === "pending" || state === "partial" ? 15_000 : false;
      },
    } as never,
  });
}

/** Risk, interest, contributions, CGT and forecast inputs. FIFO is the default cost basis. */
export function useAnalytics(cgtMethod: CgtMethod = "fifo") {
  const scope = useScopeParam();
  const signedIn = useSignedIn();
  const query = useGetPortfolioAnalytics(scope ? { scope, cgtMethod } : { cgtMethod }, {
    query: { enabled: signedIn, placeholderData: keepPreviousData, ...recover } as never,
  });
  useReportAsOf(query.data?.asOf);
  useReportFx(query.data?.fxUsdToZar);
  return query;
}
