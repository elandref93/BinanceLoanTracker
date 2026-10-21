import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CSRF_COOKIE_NAME,
  clerkExchangeFailure,
  clerkSignInStatusMessage,
  csrfHeaders,
  fetchBrowserSession,
  parseBrowserSession,
  readCookieValue,
  SessionCheckError,
  sessionGate,
  sessionRetryDelayMs,
  shouldRetrySessionCheck,
} from "./browserSession";

describe("browser session client", () => {
  it("csrfHeaders_postWithCookie_echoesDoubleSubmitToken", () => {
    const header = `__Host-ledger_session=hidden; ${CSRF_COOKIE_NAME}=abc123`;
    assert.equal(readCookieValue(header, CSRF_COOKIE_NAME), "abc123");
    assert.deepEqual(csrfHeaders("POST", header), { "X-CSRF-Token": "abc123" });
    assert.deepEqual(csrfHeaders("GET", header), {});
    assert.deepEqual(csrfHeaders("POST", ""), {});
  });

  it("parseBrowserSession_tokenInBody_rejected", () => {
    assert.throws(() => parseBrowserSession({ sessionToken: "eyJ.eyJ.sig", user: { sub: "u" } }));
    assert.deepEqual(parseBrowserSession({ user: { sub: "u", email: null, name: "Ada" } }), {
      sub: "u",
      email: null,
      name: "Ada",
    });
  });

  it("clerkExchangeFailure_profileCodes_useTheSameMessage", async () => {
    const notAllowed = await clerkExchangeFailure({
      status: 403,
      async json() {
        return { error: "not_allowed" };
      },
    });
    const noProfile = await clerkExchangeFailure({
      status: 403,
      async json() {
        return { error: "no_profile" };
      },
    });
    assert.equal(notAllowed, "not_allowed");
    assert.equal(noProfile, "not_allowed");
    const message = clerkSignInStatusMessage(notAllowed);
    assert.equal(message, clerkSignInStatusMessage("ambiguous"));
    assert.equal(message?.toLowerCase().includes("profile"), false);
    assert.equal(message?.toLowerCase().includes("exist"), false);
  });

  it("clerkExchangeFailure_missingSigningKey_isNotAnAllowlistRejection", async () => {
    const missingKey = await clerkExchangeFailure({
      status: 503,
      async json() {
        return { error: "signing_unavailable" };
      },
    });
    assert.equal(missingKey, "signing_unavailable");
    const message = clerkSignInStatusMessage(missingKey);
    assert.equal(message, "The server signing key is missing, so no session was created.");
    assert.equal(message?.toLowerCase().includes("not allowed"), false);

    const genericUnauthorized = await clerkExchangeFailure({
      status: 401,
      async json() {
        return { error: "Unauthorized" };
      },
    });
    assert.equal(genericUnauthorized, "sign_in_failed");
    assert.equal(
      clerkSignInStatusMessage(genericUnauthorized)?.toLowerCase().includes("not allowed"),
      false,
    );
  });

  it("sessionGate_noUser_isSignedOut", () => {
    assert.equal(sessionGate({ pending: true, failed: false, user: null }), "pending");
    assert.equal(sessionGate({ pending: false, failed: false, user: null }), "signed-out");
    assert.equal(sessionGate({ pending: false, failed: false, user: { sub: "u" } }), "signed-in");
    assert.equal(sessionGate({ pending: false, failed: true, user: null }), "unreachable");
  });

  it("sessionGate_failedCheckAfterSignIn_staysSignedIn", () => {
    assert.equal(sessionGate({ pending: false, failed: true, user: null, hadUser: true }), "signed-in");
  });

  it("fetchBrowserSession_onlyA401MeansSignedOut", async () => {
    const respond = (status: number) => (async () => new Response(status === 200 ? '{"user":{"sub":"u"}}' : "{}", { status })) as typeof fetch;
    assert.equal(await fetchBrowserSession("", respond(401)), null);
    await assert.rejects(() => fetchBrowserSession("", respond(429)), SessionCheckError);
    await assert.rejects(() => fetchBrowserSession("", respond(503)), SessionCheckError);
    const offline = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    await assert.rejects(() => fetchBrowserSession("", offline), SessionCheckError);
    assert.equal((await fetchBrowserSession("", respond(200)))?.sub, "u");
  });

  it("shouldRetrySessionCheck_retriesTransientFailuresOnly", () => {
    assert.equal(shouldRetrySessionCheck(0, new SessionCheckError(null)), true);
    assert.equal(shouldRetrySessionCheck(0, new SessionCheckError(429)), true);
    assert.equal(shouldRetrySessionCheck(0, new SessionCheckError(503)), true);
    assert.equal(shouldRetrySessionCheck(0, new SessionCheckError(400)), false);
    assert.equal(shouldRetrySessionCheck(8, new SessionCheckError(503)), false);
    assert.equal(sessionRetryDelayMs(10), 30_000);
  });
});
