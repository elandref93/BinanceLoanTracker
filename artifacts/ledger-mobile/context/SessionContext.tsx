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
      .catch(() => {
        if (!cancelled) setIsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const getToken = useCallback(async () => {
    return sessionRef.current?.sessionToken ?? null;
  }, []);

  const signInWithApple = useCallback(async () => {
    const next = await performAppleSignIn();
    setSession(next);
    return next;
  }, []);

  const signOut = useCallback(async () => {
    await clearStoredSession();
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

/** Hook used in place of Clerk's `useAuth()` and `useUser()`. */
export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error(
      "useSession must be used inside <SessionProvider>. Check app/_layout.tsx.",
    );
  }
  return ctx;
}
