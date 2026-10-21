import { useClerk } from "@clerk/react-router";
import { useEffect } from "react";

let clerkSignOut: (() => Promise<void>) | null = null;

/** Rendered inside ClerkProvider so the shell can end the Clerk session too. */
export function ClerkSignOutRegistrar() {
  const clerk = useClerk();
  useEffect(() => {
    clerkSignOut = async () => {
      await clerk.signOut();
    };
    return () => {
      clerkSignOut = null;
    };
  }, [clerk]);
  return null;
}

/**
 * Ends the Ledger cookie first, then the Clerk session, so the Clerk bridge
 * cannot mint a new Ledger session in between. Returns false when the Ledger
 * cookie could not be cleared.
 */
export async function signOutEverywhere(ledgerSignOut: () => Promise<boolean>): Promise<boolean> {
  const cleared = await ledgerSignOut();
  if (!cleared) return false;
  if (clerkSignOut) {
    try {
      await clerkSignOut();
    } catch {
      // The Ledger cookie is already gone; a Clerk hiccup must not undo that.
    }
  }
  return true;
}
