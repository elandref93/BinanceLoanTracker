/**
 * Pure Microsoft → Ledger linking decision.
 *
 * A verified, normalized email may select a canonical user only when exactly
 * one existing profile has that email. Zero matches, several matches, or an
 * unverified address do not guess. The Entra object id is an alias at most;
 * it is never chosen as a new canonical user by this function.
 */

export type MicrosoftLinkCandidate = {
  canonicalSub: string;
  normalizedEmail: string;
};

export type MicrosoftLinkReason =
  | "email_missing"
  | "email_unverified"
  | "no_match"
  | "multiple_matches"
  | "alias_conflict";

export type MicrosoftLinkDecision =
  | {
      outcome: "linked";
      canonicalSub: string;
      normalizedEmail: string | null;
      source: "verified_email" | "stored_alias";
    }
  | {
      outcome: "unlinked";
      reason: MicrosoftLinkReason;
    };

export function normalizeLedgerEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Reads the linkable address from a verified Microsoft id_token payload.
 * `preferred_username` is a sign-in name, not proof of a verified email, so
 * it is ignored.
 */
export function selectMicrosoftLinkEmail(payload: {
  email?: unknown;
  email_verified?: unknown;
  preferred_username?: unknown;
}): { email?: string; emailVerified: boolean } {
  const email = typeof payload.email === "string" ? payload.email : undefined;
  const emailVerified =
    email !== undefined &&
    (payload.email_verified === true || payload.email_verified === "true");
  return { email, emailVerified };
}

function uniqueCanonicals(candidates: readonly MicrosoftLinkCandidate[]): string[] {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const id = candidate.canonicalSub.trim();
    if (id.length > 0) seen.add(id);
  }
  return [...seen];
}

export function decideMicrosoftLink(input: {
  entraObjectId: string;
  email?: string;
  emailVerified: boolean;
  existingAliasCanonical?: string;
  candidates: readonly MicrosoftLinkCandidate[];
}): MicrosoftLinkDecision {
  const entraObjectId = input.entraObjectId.trim();
  const rawEmail = input.email?.trim() ?? "";
  const hasEmail = rawEmail.length > 0;
  const normalizedEmail = hasEmail ? normalizeLedgerEmail(rawEmail) : null;
  const emailUsable = normalizedEmail !== null && input.emailVerified === true;

  const matches = emailUsable
    ? uniqueCanonicals(
        input.candidates.filter(
          (candidate) =>
            normalizeLedgerEmail(candidate.normalizedEmail) === normalizedEmail &&
            candidate.canonicalSub.trim().length > 0,
        ),
      )
    : [];

  const alias = input.existingAliasCanonical?.trim() || undefined;
  if (alias) {
    if (matches.length > 1) {
      return { outcome: "unlinked", reason: "multiple_matches" };
    }
    // An alias that is the Entra oid itself is the bug this decision exists
    // to stop. Prefer the single real profile, and do not keep the oid when
    // nothing else matches.
    if (alias === entraObjectId) {
      if (matches.length === 1) {
        return {
          outcome: "linked",
          canonicalSub: matches[0]!,
          normalizedEmail,
          source: "verified_email",
        };
      }
      if (!hasEmail) return { outcome: "unlinked", reason: "email_missing" };
      if (!emailUsable) return { outcome: "unlinked", reason: "email_unverified" };
      return { outcome: "unlinked", reason: "no_match" };
    }
    if (matches.length === 1 && matches[0] !== alias) {
      return { outcome: "unlinked", reason: "alias_conflict" };
    }
    return {
      outcome: "linked",
      canonicalSub: alias,
      normalizedEmail: emailUsable ? normalizedEmail : null,
      source: "stored_alias",
    };
  }

  if (!hasEmail) return { outcome: "unlinked", reason: "email_missing" };
  if (input.emailVerified !== true) {
    return { outcome: "unlinked", reason: "email_unverified" };
  }
  if (matches.length === 1) {
    return {
      outcome: "linked",
      canonicalSub: matches[0]!,
      normalizedEmail,
      source: "verified_email",
    };
  }
  if (matches.length === 0) return { outcome: "unlinked", reason: "no_match" };
  return { outcome: "unlinked", reason: "multiple_matches" };
}
