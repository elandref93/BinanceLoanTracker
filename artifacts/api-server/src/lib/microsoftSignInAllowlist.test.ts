import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isAllowedMicrosoftSignIn, MICROSOFT_SIGN_IN_EMAIL } from "./microsoftSignInAllowlist";

describe("isAllowedMicrosoftSignIn", () => {
  it("isAllowedMicrosoftSignIn_trimmedMixedCase_allowsOnlyThatAddress", () => {
    assert.equal(
      isAllowedMicrosoftSignIn({
        email: "  ElandReFourie18@Gmail.com ",
        emailVerified: true,
      }),
      true,
    );
    assert.equal(
      isAllowedMicrosoftSignIn({
        email: MICROSOFT_SIGN_IN_EMAIL,
        emailVerified: true,
      }),
      true,
    );
    assert.equal(
      isAllowedMicrosoftSignIn({
        email: "other.person@example.com",
        emailVerified: true,
      }),
      false,
    );
    assert.equal(
      isAllowedMicrosoftSignIn({
        email: MICROSOFT_SIGN_IN_EMAIL,
        emailVerified: false,
      }),
      false,
    );
    assert.equal(
      isAllowedMicrosoftSignIn({
        email: undefined,
        emailVerified: true,
      }),
      false,
    );
    assert.equal(
      isAllowedMicrosoftSignIn({
        email: "   ",
        emailVerified: true,
      }),
      false,
    );
  });
});
