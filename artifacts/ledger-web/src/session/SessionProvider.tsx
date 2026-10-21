import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Navigate, Outlet } from "react-router";

import {
  fetchBrowserSession,
  logoutBrowser,
  sessionGate,
  sessionRetryDelayMs,
  shouldRetrySessionCheck,
  type BrowserUser,
} from "@/session/browserSession";
import { FullScreenMessage } from "@/ui/FullScreenMessage";

type BrowserSessionValue = {
  isPending: boolean;
  isError: boolean;
  /** False while the last session check failed for a reason other than 401. */
  reachable: boolean;
  user: BrowserUser | null;
  expired: boolean;
  retry: () => void;
  signOut: () => Promise<boolean>;
};

const BrowserSessionContext = createContext<BrowserSessionValue | null>(null);

export function BrowserSessionProvider(props: { apiBaseUrl: string; children: ReactNode }) {
  const queryClient = useQueryClient();
  const lastUser = useRef<BrowserUser | null>(null);
  const [expired, setExpired] = useState(false);
  const query = useQuery({
    queryKey: ["browser-session"],
    queryFn: () => fetchBrowserSession(props.apiBaseUrl),
    retry: shouldRetrySessionCheck,
    retryDelay: sessionRetryDelayMs,
    // Focus refetches at most once a minute so app switching on iPhone stays
    // well inside the API rate limit.
    staleTime: 60_000,
    gcTime: Infinity,
    refetchOnWindowFocus: true,
    refetchInterval: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (query.data) {
      lastUser.current = query.data;
      setExpired(false);
      return;
    }
    if (query.isSuccess && query.data === null && lastUser.current) {
      lastUser.current = null;
      setExpired(true);
    }
  }, [query.data, query.isSuccess]);

  async function signOut(): Promise<boolean> {
    const cookieHeader = typeof document === "undefined" ? "" : document.cookie;
    let cleared = false;
    try {
      cleared = await logoutBrowser(props.apiBaseUrl, cookieHeader);
    } catch {
      cleared = false;
    }
    if (!cleared) return false;
    lastUser.current = null;
    setExpired(false);
    queryClient.clear();
    return true;
  }

  // A failed check keeps the last confirmed user so screens stay up while retrying.
  const user = query.data ?? (query.isError ? lastUser.current : null);
  const value: BrowserSessionValue = {
    isPending: query.isPending,
    isError: query.isError,
    reachable: !query.isError,
    user,
    expired,
    retry: () => {
      void query.refetch();
    },
    signOut,
  };

  return (
    <BrowserSessionContext.Provider value={value}>{props.children}</BrowserSessionContext.Provider>
  );
}

export function useBrowserSession(): BrowserSessionValue {
  const value = useContext(BrowserSessionContext);
  if (!value) {
    throw new Error("Browser session is unavailable");
  }
  return value;
}

export function RequireSession() {
  const session = useBrowserSession();
  const gate = sessionGate({
    pending: session.isPending,
    failed: session.isError,
    user: session.user,
  });
  if (gate === "pending") {
    return <FullScreenMessage tone="loading" title="Opening Ledger" />;
  }
  if (gate === "unreachable") {
    return (
      <FullScreenMessage
        tone="offline"
        title="Can't reach Ledger"
        body="Retrying automatically. You are still signed in if you were before."
        action={{ label: "Try again", onClick: session.retry }}
      />
    );
  }
  if (gate === "signed-out") {
    const to = session.expired ? "/sign-in?error=session_expired" : "/sign-in";
    return <Navigate to={to} replace />;
  }
  return <Outlet />;
}
