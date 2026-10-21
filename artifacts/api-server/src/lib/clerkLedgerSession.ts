/**
 * Clerk web sign-in may mint a Ledger cookie only for an Apple sign-in
 * (`oauth_apple`) whose verified address is the single allowed email.
 * That address is pinned to the existing production storage key. A web Apple
 * `sub` is not stored and is not hashed into a new account filename.
 * Every other strategy or account is rejected with no session.
 */

import { CLERK_PROFILE_STORAGE_KEY } from "./profileStorageKey";

export const CLERK_SIGN_IN_EMAIL = "elandrefourie18@gmail.com";

export { CLERK_PROFILE_STORAGE_KEY };

/** Web Sign in with Apple. Email, password, and other social strategies are rejected. */
export const CLERK_APPLE_STRATEGY = "oauth_apple";

export type ClerkEmailAddress = {
  id: string;
  emailAddress: string;
  verification: { status: string } | null;
};

export type ClerkEmailSource = {
  primaryEmailAddressId: string | null;
  emailAddresses: readonly ClerkEmailAddress[];
};

export type ClerkLedgerCandidate = {
  canonicalSub: string;
  normalizedEmail: string;
};

export type ClerkLedgerDecision =
  | { outcome: "session"; canonicalSub: string; email: string }
  | { outcome: "rejected"; reason: "not_allowed" | "no_profile" | "ambiguous" };

export function clerkVerifiedEmail(user: ClerkEmailSource): {
  email?: string;
  emailVerified: boolean;
} {
  const primary = user.emailAddresses.find((item) => item.id === user.primaryEmailAddressId);
  if (!primary || primary.verification?.status !== "verified") {
    return { emailVerified: false };
  }
  return { email: primary.emailAddress, emailVerified: true };
}

/**
 * The allowlisted address opens the existing storage key. `appleSub` is never
 * written and never becomes a user id, including when it differs from the
 * original TestFlight Apple user.
 */
export function clerkProfileForAppleSignIn(appleSub: string): {
  storageKey: string;
  createdUser: false;
} {
  void appleSub;
  return { storageKey: CLERK_PROFILE_STORAGE_KEY, createdUser: false };
}

/**
 * True only for an Apple Clerk session, the single allowed address after trim
 * and lowercase, and only when Clerk has verified that address. That address
 * always opens the pinned storage key. Candidate Apple subs are not adopted.
 * Any other strategy is rejected before a Ledger cookie can be set.
 */
export function decideClerkLedgerSession(input: {
  email?: string;
  emailVerified: boolean;
  strategy: string | null;
  /** Web Apple `sub`, if known. Not stored and not used as a filename. */
  appleSub?: string;
  candidates: readonly ClerkLedgerCandidate[];
}): ClerkLedgerDecision {
  if (input.strategy !== CLERK_APPLE_STRATEGY) {
    return { outcome: "rejected", reason: "not_allowed" };
  }
  if (input.emailVerified !== true || typeof input.email !== "string") {
    return { outcome: "rejected", reason: "not_allowed" };
  }
  const email = input.email.trim().toLowerCase();
  if (email.length === 0 || email !== CLERK_SIGN_IN_EMAIL) {
    return { outcome: "rejected", reason: "not_allowed" };
  }

  // Candidates are the on-disk email bindings. A different Apple sub in that
  // list is not adopted and does not create a user. The session user id is
  // the pinned storage key either way.
  void input.candidates;
  const profile = clerkProfileForAppleSignIn(input.appleSub ?? "");
  return { outcome: "session", canonicalSub: profile.storageKey, email };
}
