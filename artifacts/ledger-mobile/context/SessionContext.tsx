import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  clearStoredSession,
  loadStoredSession,
  signInWithApple as performAppleSignIn,
  type Session,
  type SessionUser,
  type AppleLinkWarning,
} from "@/lib/session";
import {
  hydrateFromServer,
  pushLocalAccountsToServer,
} from "@/lib/accountStore";
import type { PushRemoteResult } from "@/lib/accountSync";
import { setSyncTokenGetter } from "@/lib/accountSync";
import { hydrateSettings } from "@/lib/settingsStore";
import { setSettingsTokenGetter } from "@/lib/settingsSync";
import {
  hydrateLoanAnnotations,
  setLoanAnnotationsTokenGetter,
} from "@/lib/loanAnnotations";
import {
  setCredentialsTokenGetter,
  uploadCredentials,
} from "@/lib/serverCredentials";
import { setAuthFailureHandler } from "@/lib/authEvents";
import { checkAndApplyUpdate } from "@/lib/otaUpdates";
import { reportError, reportMessage } from "@/lib/crashReporting";
import type { AccountsHydrateStatus } from "@/lib/syncDiagnostics";

interface SessionContextValue {
  /** True once the hydration from secure storage has completed. */
  isLoaded: boolean;
  /** Whether the user currently has a stored session. */
  isSignedIn: boolean;
  /** Stable user info from the session JWT (null when signed out). */
  user: SessionUser | null;
  /**
   * True once the first server-side account hydration after sign-in has
   * settled (success OR failure). Gates the onboarding redirect so a fresh
   * device doesn't flash "connect your account" before the synced profile
   * (stored server-side under the same Apple ID) has been pulled down.
   */
  accountsHydrated: boolean;
  /** Outcome of the latest account sync pull/push after sign-in or retry. */
  accountsHydrateStatus: AccountsHydrateStatus;
  /** Human-readable error when accountsHydrateStatus is "error". */
  accountsHydrateError: string | null;
  /**
   * Set after Apple Sign In when the server could not link this Expo Go
   * identity to an existing TestFlight user (no email / Hide My Email).
   */
  linkWarning: AppleLinkWarning | null;
  /** Returns the bearer token to attach to /api/* requests, or null. */
  getToken: () => Promise<string | null>;
  /** Run the Apple Sign In flow and persist the resulting session. */
  signInWithApple: () => Promise<Session>;
  /** Clear the persisted session and update local state. */
  signOut: () => Promise<void>;
  /** Re-run server account hydrate (pull or push-if-empty). */
  retryAccountSync: () => Promise<void>;
  /** Force-push local accounts to the server (Settings "Sync now"). */
  syncNow: () => Promise<PushRemoteResult>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [accountsHydrateStatus, setAccountsHydrateStatus] =
    useState<AccountsHydrateStatus>("pending");
  const [accountsHydrateError, setAccountsHydrateError] = useState<string | null>(
    null,
  );

  const accountsHydrated = accountsHydrateStatus !== "pending";

  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;

  useEffect(() => {
    let cancelled = false;
    loadStoredSession()
      .then((s) => {
        if (!cancelled) {
          setSession(s);
          setIsLoaded(true);
        }
      })
      .catch((e) => {
        reportError(e, { op: "session.loadStored" });
        if (!cancelled) setIsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const getToken = useCallback(async () => {
    return sessionRef.current?.sessionToken ?? null;
  }, []);

  const runAccountHydrate = useCallback(async () => {
    setAccountsHydrateStatus("pending");
    setAccountsHydrateError(null);
    try {
      const result = await hydrateFromServer();
      // eslint-disable-next-line no-console
      console.log("[sync] accounts hydrate", result);
      setAccountsHydrateStatus(result.status);
      setAccountsHydrateError(result.errorMessage ?? null);
      if (result.status === "ok" || result.status === "empty") {
        void uploadCredentials();
      }
    } catch (e) {
      reportError(e, { op: "accounts.hydrate" });
      setAccountsHydrateStatus("error");
      setAccountsHydrateError(
        e instanceof Error ? e.message : "Could not sync accounts",
      );
    }
  }, []);

  useEffect(() => {
    setSyncTokenGetter(getToken);
    setSettingsTokenGetter(getToken);
    setCredentialsTokenGetter(getToken);
    setLoanAnnotationsTokenGetter(getToken);
    if (!session) {
      setAccountsHydrateStatus("pending");
      setAccountsHydrateError(null);
      // Leave getters registered. Nulling them on cleanup races in-flight
      // hydrates (React Strict Mode remount) and looks like a 401/sign-out.
      return;
    }
    reportMessage("[session] hydrate start", { op: "session.hydrate" });
    void runAccountHydrate();
    void hydrateSettings().catch((e) => {
      reportError(e, { op: "settings.hydrate" });
    });
    void hydrateLoanAnnotations().catch((e) => {
      reportError(e, { op: "annotations.hydrate" });
    });
  }, [session, getToken, runAccountHydrate]);

  const retryAccountSync = useCallback(async () => {
    if (!sessionRef.current) return;
    await runAccountHydrate();
  }, [runAccountHydrate]);

  const syncNow = useCallback(async () => {
    return pushLocalAccountsToServer();
  }, []);

  const signInWithApple = useCallback(async () => {
    reportMessage("[session] apple sign-in start", { op: "session.signIn" });
    let next: Session;
    try {
      next = await performAppleSignIn();
    } catch (e) {
      reportError(e, { op: "session.signIn" });
      throw e;
    }
    setSession(next);
    reportMessage("[session] apple sign-in success", { op: "session.signIn" });
    void checkAndApplyUpdate();
    return next;
  }, []);

  const signOutInFlight = useRef(false);
  const signOut = useCallback(async () => {
    if (signOutInFlight.current || sessionRef.current === null) return;
    signOutInFlight.current = true;
    reportMessage("[session] sign-out", { op: "session.signOut" });
    try {
      await clearStoredSession();
      setSession(null);
    } catch (e) {
      reportError(e, { op: "session.signOut" });
      throw e;
    } finally {
      signOutInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    setAuthFailureHandler(() => {
      void signOut();
    });
    return () => setAuthFailureHandler(null);
  }, [signOut]);

  const value = useMemo<SessionContextValue>(
    () => ({
      isLoaded,
      isSignedIn: session !== null,
      user: session?.user ?? null,
      accountsHydrated,
      accountsHydrateStatus,
      accountsHydrateError,
      linkWarning: session?.linkWarning ?? null,
      getToken,
      signInWithApple,
      signOut,
      retryAccountSync,
      syncNow,
    }),
    [
      isLoaded,
      session,
      accountsHydrated,
      accountsHydrateStatus,
      accountsHydrateError,
      getToken,
      signInWithApple,
      signOut,
      retryAccountSync,
      syncNow,
    ],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

/** Access the current session (token + user) and auth actions. */
export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error(
      "useSession must be used inside <SessionProvider>. Check app/_layout.tsx.",
    );
  }
  return ctx;
}
