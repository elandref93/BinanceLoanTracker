import { allowedSignInEmail } from "./allowedSignInEmail";
import { normalizeLedgerEmail } from "./microsoftLinkDecision";

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
  const allowed = allowedSignInEmail();
  if (allowed.length === 0) return false;
  return normalized === allowed;
}
