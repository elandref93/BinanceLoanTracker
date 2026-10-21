import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { requestLiveRefresh } from "@/portfolio/portfolioApi";

type RefreshValue = {
  refresh: () => Promise<void>;
  refreshing: boolean;
  /** When the server last computed the figures on screen. */
  asOf: string | null;
  reportAsOf: (iso: string | null | undefined) => void;
};

const RefreshContext = createContext<RefreshValue | null>(null);

const LIVE_REFRESH_MIN_AGE_MS = 2 * 60 * 1000;
const RESUME_REFRESH_AFTER_MS = 60 * 1000;

/**
 * One refresh path for the button, pull-to-refresh, the R shortcut, and app
 * resume. It re-reads every visible query and, when the server figures are
 * older than two minutes, asks the server for a new snapshot first. The
 * server rate-limits that request, so this stays gentle.
 */
export function RefreshProvider(props: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const fetching = useIsFetching({ predicate: (query) => query.queryKey[0] !== "browser-session" });
  const [asOf, setAsOf] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const hiddenAt = useRef<number | null>(null);
  const asOfRef = useRef<string | null>(null);
  asOfRef.current = asOf;

  const refresh = useCallback(async () => {
    setManual(true);
    try {
      const age = asOfRef.current ? Date.now() - Date.parse(asOfRef.current) : Infinity;
      if (!Number.isFinite(age) || age > LIVE_REFRESH_MIN_AGE_MS) {
        await requestLiveRefresh().catch(() => undefined);
      }
      await queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] !== "browser-session",
        refetchType: "active",
      });
    } finally {
      setManual(false);
    }
  }, [queryClient]);

  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === "hidden") {
        hiddenAt.current = Date.now();
        return;
      }
      const since = hiddenAt.current;
      hiddenAt.current = null;
      if (since != null && Date.now() - since > RESUME_REFRESH_AFTER_MS) void refresh();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [refresh]);

  const value = useMemo<RefreshValue>(
    () => ({
      refresh,
      refreshing: manual || fetching > 0,
      asOf,
      reportAsOf: (iso) => {
        if (typeof iso !== "string" || !Number.isFinite(Date.parse(iso))) return;
        setAsOf((prev) => (prev && Date.parse(prev) >= Date.parse(iso) ? prev : iso));
      },
    }),
    [asOf, fetching, manual, refresh],
  );

  return <RefreshContext.Provider value={value}>{props.children}</RefreshContext.Provider>;
}

export function useRefresh(): RefreshValue {
  const value = useContext(RefreshContext);
  if (!value) throw new Error("Refresh is unavailable");
  return value;
}

/** Reports a server timestamp to the freshness chip whenever it changes. */
export function useReportAsOf(iso: string | null | undefined): void {
  const { reportAsOf } = useRefresh();
  useEffect(() => {
    reportAsOf(iso);
  }, [iso, reportAsOf]);
}
