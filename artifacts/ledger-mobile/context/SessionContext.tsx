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
} from "@/lib/session";
import { hydrateFromServer } from "@/lib/accountStore";
import { setSyncTokenGetter } from "@/lib/accountSync";
import { hydrateSettings } from "@/lib/settingsStore";
import { setSettingsTokenGetter } from "@/lib/settingsSync";
import { checkAndApplyUpdate } from "@/lib/otaUpdates";
import { reportError, reportMessage } from "@/lib/crashReporting";

interface SessionContextValue {
  /** True once the hydration from secure storage has completed. */
  isLoaded: boolean;
  /** Whether the user currently has a stored session. */
  isSignedIn: boolean;
  /** Stable user info from the session JWT (null when signed out). */
  user: SessionUser | null;
  /** Returns the bearer token to attach to /api/* requests, or null. */
  getToken: () => Promise<string | null>;
  /** Run the Apple Sign In flow and persist the resulting session. */
  signInWithApple: () => Promise<Session>;
  /** Clear the persisted session and update local state. */
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // Ref mirror — read inside getToken() to avoid stale closures when the
  // session changes after the consumer first captured the function reference
  // (e.g. setAuthTokenGetter sees the new token immediately after sign-in
  // without us having to re-register it).
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

  // Register the token getter with accountSync so it can authenticate the
  // cross-device sync requests, and pull the remote copy whenever the
  // signed-in user changes (sign-in, sign-out, or initial hydrate).
  useEffect(() => {
    setSyncTokenGetter(getToken);
    setSettingsTokenGetter(getToken);
    if (session) {
      reportMessage("[session] hydrate start", { op: "session.hydrate" });
      void hydrateFromServer().catch((e) => {
        reportError(e, { op: "accounts.hydrate" });
      });
      void hydrateSettings().catch((e) => {
        reportError(e, { op: "settings.hydrate" });
      });
    }
    return () => {
      setSyncTokenGetter(null);
      setSettingsTokenGetter(null);
    };
  }, [session, getToken]);

  const signInWithApple = useCallback(async () => {
    reportMessage("[session] apple sign-in start", { op: "session.signIn" });
    let next: Session;
    try {
      next = await performAppleSignIn();
    } catch (e) {
      // Log but DO NOT swallow — rethrow so the UI still surfaces the failure.
      reportError(e, { op: "session.signIn" });
      throw e;
    }
    setSession(next);
    reportMessage("[session] apple sign-in success", { op: "session.signIn" });
    // Stage the latest OTA bundle on login. Runs in the background and only
    // DOWNLOADS the update — it never calls reloadAsync() (which crashes
    // natively on this build and traps the device on the old bundle). The
    // staged update applies on the next cold launch. No-op in dev / Expo Go.
    void checkAndApplyUpdate();
    return next;
  }, []);

  const signOut = useCallback(async () => {
    reportMessage("[session] sign-out", { op: "session.signOut" });
    try {
      await clearStoredSession();
    } catch (e) {
      reportError(e, { op: "session.signOut" });
      throw e;
    }
    setSession(null);
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      isLoaded,
      isSignedIn: session !== null,
      user: session?.user ?? null,
      getToken,
      signInWithApple,
      signOut,
    }),
    [isLoaded, session, getToken, signInWithApple, signOut],
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
