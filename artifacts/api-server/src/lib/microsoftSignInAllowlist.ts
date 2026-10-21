import { normalizeLedgerEmail } from "./microsoftLinkDecision";

/**
 * The only verified Microsoft email that may receive a Ledger session.
 * Checked on the API for both the browser cookie and the mobile bearer.
 * The React sign-in page is not this control.
 */
export const MICROSOFT_SIGN_IN_EMAIL = "elandrefourie18@gmail.com";

/**
 * True only when the verified `email` claim, after trim and lowercase,
 * is the single allowed address. A missing or unverified claim does not match.
 */
export function isAllowedMicrosoftSignIn(input: {
  email?: string;
  emailVerified: boolean;
}): boolean {
  if (input.emailVerified !== true) return false;
  if (typeof input.email !== "string") return false;
  const normalized = normalizeLedgerEmail(input.email);
  if (normalized.length === 0) return false;
  return normalized === MICROSOFT_SIGN_IN_EMAIL;
}
