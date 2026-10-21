import assert from "node:assert/strict";
import crypto from "node:crypto";
import { describe, it } from "node:test";

import {
  CLERK_APPLE_STRATEGY,
  CLERK_PROFILE_STORAGE_KEY,
  CLERK_SIGN_IN_EMAIL,
  clerkProfileForAppleSignIn,
  clerkVerifiedEmail,
  decideClerkLedgerSession,
} from "./clerkLedgerSession";
import { SigningKeyMissingError } from "./sessionJwt";
import { userStorageKey } from "./userWriteLock";

describe("SigningKeyMissingError", () => {
  it("SigningKeyMissingError_missingKey_isNotAnAllowlistRejection", () => {
    const err = new SigningKeyMissingError();
    assert.equal(err.code, "signing_unavailable");
    assert.equal(err.message.toLowerCase().includes("not allowed"), false);
    assert.equal(/[a-f0-9]{32,}/i.test(err.message), false);
  });
});

describe("decideClerkLedgerSession", () => {
  it("decideClerkLedgerSession_trimmedMixedCase_allowsOnlyThatVerifiedAddress", () => {
    const decision = decideClerkLedgerSession({
      email: "  ElandReFourie18@Gmail.com ",
      emailVerified: true,
      strategy: CLERK_APPLE_STRATEGY,
      candidates: [{ canonicalSub: "apple-user", normalizedEmail: CLERK_SIGN_IN_EMAIL }],
    });
    assert.deepEqual(decision, {
      outcome: "session",
      canonicalSub: CLERK_PROFILE_STORAGE_KEY,
      email: CLERK_SIGN_IN_EMAIL,
    });
  });

  it("decideClerkLedgerSession_allowedEmail_usesBc2c2dKeyAndDoesNotCreateUser", () => {
    const appleSub = "web-apple-sub-different-from-testflight";
    const profile = clerkProfileForAppleSignIn(appleSub);
    assert.equal(profile.createdUser, false);
    assert.equal(profile.storageKey, CLERK_PROFILE_STORAGE_KEY);
    assert.match(profile.storageKey, /bc2c2d$/);
    assert.equal(profile.storageKey.length, 64);
    assert.notEqual(profile.storageKey, appleSub);
    const hashedAppleSub = crypto.createHash("sha256").update(appleSub).digest("hex");
    assert.notEqual(profile.storageKey, hashedAppleSub);
    assert.equal(userStorageKey(profile.storageKey), profile.storageKey);
    assert.equal(userStorageKey(appleSub), hashedAppleSub);

    const decision = decideClerkLedgerSession({
      email: CLERK_SIGN_IN_EMAIL,
      emailVerified: true,
      strategy: CLERK_APPLE_STRATEGY,
      appleSub,
      candidates: [{ canonicalSub: appleSub, normalizedEmail: CLERK_SIGN_IN_EMAIL }],
    });
    assert.deepEqual(decision, {
      outcome: "session",
      canonicalSub: CLERK_PROFILE_STORAGE_KEY,
      email: CLERK_SIGN_IN_EMAIL,
    });
  });

  it("decideClerkLedgerSession_otherOrUnverified_rejectsWithNoSession", () => {
    assert.equal(
      decideClerkLedgerSession({
        email: "other.person@example.com",
        emailVerified: true,
        strategy: CLERK_APPLE_STRATEGY,
        candidates: [{ canonicalSub: "apple-user", normalizedEmail: "other.person@example.com" }],
      }).outcome,
      "rejected",
    );
    const unverified = decideClerkLedgerSession({
      email: CLERK_SIGN_IN_EMAIL,
      emailVerified: false,
      strategy: CLERK_APPLE_STRATEGY,
      candidates: [{ canonicalSub: "apple-user", normalizedEmail: CLERK_SIGN_IN_EMAIL }],
    });
    assert.equal(unverified.outcome, "rejected");
    if (unverified.outcome === "rejected") assert.equal(unverified.reason, "not_allowed");
    const blank = decideClerkLedgerSession({
      email: "   ",
      emailVerified: true,
      strategy: CLERK_APPLE_STRATEGY,
      candidates: [],
    });
    assert.equal(blank.outcome, "rejected");
    if (blank.outcome === "rejected") assert.equal(blank.reason, "not_allowed");
  });

  it("decideClerkLedgerSession_allowedEmailWithoutCandidates_stillUsesStorageKey", () => {
    const missing = decideClerkLedgerSession({
      email: CLERK_SIGN_IN_EMAIL,
      emailVerified: true,
      strategy: CLERK_APPLE_STRATEGY,
      candidates: [],
    });
    assert.deepEqual(missing, {
      outcome: "session",
      canonicalSub: CLERK_PROFILE_STORAGE_KEY,
      email: CLERK_SIGN_IN_EMAIL,
    });
    const otherSubs = decideClerkLedgerSession({
      email: CLERK_SIGN_IN_EMAIL,
      emailVerified: true,
      strategy: CLERK_APPLE_STRATEGY,
      appleSub: "another-apple-sub",
      candidates: [
        { canonicalSub: "one", normalizedEmail: CLERK_SIGN_IN_EMAIL },
        { canonicalSub: "two", normalizedEmail: CLERK_SIGN_IN_EMAIL },
      ],
    });
    assert.deepEqual(otherSubs, {
      outcome: "session",
      canonicalSub: CLERK_PROFILE_STORAGE_KEY,
      email: CLERK_SIGN_IN_EMAIL,
    });
    assert.equal(clerkProfileForAppleSignIn("another-apple-sub").createdUser, false);
  });

  it("decideClerkLedgerSession_nonAppleStrategy_rejectsWithNoLedgerCookie", () => {
    const candidates = [{ canonicalSub: "apple-user", normalizedEmail: CLERK_SIGN_IN_EMAIL }];
    const strategies = ["password", "email_code", "email_link", "oauth_google", "oauth_github", "oauth_microsoft", null];
    for (const strategy of strategies) {
      const decision = decideClerkLedgerSession({
        email: CLERK_SIGN_IN_EMAIL,
        emailVerified: true,
        strategy,
        candidates,
      });
      assert.equal(decision.outcome, "rejected");
      if (decision.outcome === "rejected") assert.equal(decision.reason, "not_allowed");
    }
  });
});

describe("clerkVerifiedEmail", () => {
  it("clerkVerifiedEmail_primaryVerified_returnsThatAddress", () => {
    assert.deepEqual(
      clerkVerifiedEmail({
        primaryEmailAddressId: "em_1",
        emailAddresses: [
          {
            id: "em_1",
            emailAddress: "ElandReFourie18@Gmail.com",
            verification: { status: "verified" },
          },
          {
            id: "em_2",
            emailAddress: "other.person@example.com",
            verification: { status: "verified" },
          },
        ],
      }),
      { email: "ElandReFourie18@Gmail.com", emailVerified: true },
    );
  });

  it("clerkVerifiedEmail_unverifiedPrimary_isNotVerified", () => {
    assert.deepEqual(
      clerkVerifiedEmail({
        primaryEmailAddressId: "em_1",
        emailAddresses: [
          {
            id: "em_1",
            emailAddress: CLERK_SIGN_IN_EMAIL,
            verification: { status: "unverified" },
          },
        ],
      }),
      { emailVerified: false },
    );
  });
});
