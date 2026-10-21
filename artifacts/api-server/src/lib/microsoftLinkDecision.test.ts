import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decideMicrosoftLink,
  selectMicrosoftLinkEmail,
  type MicrosoftLinkCandidate,
} from "./microsoftLinkDecision";

const ada = "ada@example.com";
const appleSub = "apple-sub-001";
const otherSub = "apple-sub-002";
const entraOid = "entra-oid-999";

function candidate(canonicalSub: string, normalizedEmail: string): MicrosoftLinkCandidate {
  return { canonicalSub, normalizedEmail };
}

describe("selectMicrosoftLinkEmail", () => {
  it("selectMicrosoftLinkEmail_preferredUsernameOnly_isNotVerified", () => {
    assert.deepEqual(
      selectMicrosoftLinkEmail({
        preferred_username: "ada@example.com",
        email_verified: true,
      }),
      { email: undefined, emailVerified: false },
    );
  });

  it("selectMicrosoftLinkEmail_verifiedEmailClaim_isLinkable", () => {
    assert.deepEqual(
      selectMicrosoftLinkEmail({
        email: "Ada@Example.com",
        email_verified: "true",
        preferred_username: "other@contoso.com",
      }),
      { email: "Ada@Example.com", emailVerified: true },
    );
  });

  it("selectMicrosoftLinkEmail_missingVerifiedClaim_isNotVerified", () => {
    assert.deepEqual(selectMicrosoftLinkEmail({ email: ada }), {
      email: ada,
      emailVerified: false,
    });
  });
});

describe("decideMicrosoftLink", () => {
  it("decideMicrosoftLink_singleVerifiedEmail_usesCanonicalNotEntraOid", () => {
    const decision = decideMicrosoftLink({
      entraObjectId: entraOid,
      email: "  Ada@Example.com ",
      emailVerified: true,
      candidates: [candidate(appleSub, ada)],
    });
    assert.deepEqual(decision, {
      outcome: "linked",
      canonicalSub: appleSub,
      normalizedEmail: ada,
      source: "verified_email",
    });
    assert.notEqual(decision.outcome === "linked" ? decision.canonicalSub : "", entraOid);
  });

  it("decideMicrosoftLink_noMatch_doesNotMintOid", () => {
    const decision = decideMicrosoftLink({
      entraObjectId: entraOid,
      email: ada,
      emailVerified: true,
      candidates: [],
    });
    assert.deepEqual(decision, { outcome: "unlinked", reason: "no_match" });
  });

  it("decideMicrosoftLink_multipleCanonicals_doesNotGuess", () => {
    const decision = decideMicrosoftLink({
      entraObjectId: entraOid,
      email: ada,
      emailVerified: true,
      candidates: [candidate(appleSub, ada), candidate(otherSub, ada)],
    });
    assert.deepEqual(decision, { outcome: "unlinked", reason: "multiple_matches" });
  });

  it("decideMicrosoftLink_unverifiedEmail_doesNotLink", () => {
    const decision = decideMicrosoftLink({
      entraObjectId: entraOid,
      email: ada,
      emailVerified: false,
      candidates: [candidate(appleSub, ada)],
    });
    assert.deepEqual(decision, { outcome: "unlinked", reason: "email_unverified" });
  });

  it("decideMicrosoftLink_duplicateRowsForOneCanonical_countsAsOne", () => {
    const decision = decideMicrosoftLink({
      entraObjectId: entraOid,
      email: ada,
      emailVerified: true,
      candidates: [candidate(appleSub, ada), candidate(appleSub, "  ADA@example.com ")],
    });
    assert.equal(decision.outcome, "linked");
    if (decision.outcome === "linked") {
      assert.equal(decision.canonicalSub, appleSub);
    }
  });

  it("decideMicrosoftLink_storedAlias_keptWhenEmailMissing", () => {
    const decision = decideMicrosoftLink({
      entraObjectId: entraOid,
      emailVerified: false,
      existingAliasCanonical: appleSub,
      candidates: [],
    });
    assert.deepEqual(decision, {
      outcome: "linked",
      canonicalSub: appleSub,
      normalizedEmail: null,
      source: "stored_alias",
    });
  });

  it("decideMicrosoftLink_aliasConflictsWithDifferentEmailMatch_doesNotGuess", () => {
    const decision = decideMicrosoftLink({
      entraObjectId: entraOid,
      email: ada,
      emailVerified: true,
      existingAliasCanonical: otherSub,
      candidates: [candidate(appleSub, ada)],
    });
    assert.deepEqual(decision, { outcome: "unlinked", reason: "alias_conflict" });
  });

  it("decideMicrosoftLink_selfAliasWithRealMatch_prefersCanonicalProfile", () => {
    const decision = decideMicrosoftLink({
      entraObjectId: entraOid,
      email: ada,
      emailVerified: true,
      existingAliasCanonical: entraOid,
      candidates: [candidate(appleSub, ada)],
    });
    assert.deepEqual(decision, {
      outcome: "linked",
      canonicalSub: appleSub,
      normalizedEmail: ada,
      source: "verified_email",
    });
  });

  it("decideMicrosoftLink_selfAliasWithoutMatch_doesNotMintOid", () => {
    const decision = decideMicrosoftLink({
      entraObjectId: entraOid,
      email: ada,
      emailVerified: true,
      existingAliasCanonical: entraOid,
      candidates: [],
    });
    assert.deepEqual(decision, { outcome: "unlinked", reason: "no_match" });
  });
});
