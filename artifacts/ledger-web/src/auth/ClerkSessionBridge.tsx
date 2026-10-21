import { useAuth, useClerk } from "@clerk/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { clerkExchangeFailure, csrfHeaders } from "@/session/browserSession";
import { useBrowserSession } from "@/session/SessionProvider";

/**
 * Turns a Clerk browser session into the Ledger HttpOnly cookie.
 * A rejected account is signed out of Clerk so no session remains.
 */
export function ClerkSessionBridge(props: { apiBaseUrl: string }) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { signOut } = useClerk();
  const session = useBrowserSession();
  const queryClient = useQueryClient();
  const signOutLedger = useRef(session.signOut);
  signOutLedger.current = session.signOut;
  const userSub = session.user?.sub ?? null;

  useEffect(() => {
    if (!isLoaded || isSignedIn || !userSub) return;
    void signOutLedger.current();
  }, [isLoaded, isSignedIn, userSub]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || userSub || session.isPending) return;
    let cancelled = false;
    void (async () => {
      const token = await getToken();
      if (!token || cancelled) return;
      const cookieHeader = typeof document === "undefined" ? "" : document.cookie;
      const response = await fetch(`${props.apiBaseUrl}/api/auth/clerk`, {
        method: "POST",
        credentials: "include",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
          ...csrfHeaders("POST", cookieHeader),
        },
      });
      if (cancelled) return;
      if (response.status === 204) {
        await queryClient.invalidateQueries({ queryKey: ["browser-session"] });
        return;
      }
      const reason = await clerkExchangeFailure(response);
      if (!cancelled) {
        await signOut({ redirectUrl: `/sign-in?error=${encodeURIComponent(reason)}` });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken, isLoaded, isSignedIn, props.apiBaseUrl, queryClient, session.isPending, signOut, userSub]);

  return null;
}
