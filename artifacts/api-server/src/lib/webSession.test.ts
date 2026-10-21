import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeJwt } from "jose";

import {
  MOBILE_SESSION_LIFETIME_SECONDS,
  signSession,
  signWebSession,
  verifyWebSession,
} from "./sessionJwt";
import { WEB_SESSION_IDLE_MS, WEB_SESSION_IDLE_SECONDS, isWebSessionIdleExpired } from "./webSession";

process.env.SESSION_JWT_SECRET = "web-session-test-secret-32-characters-min";

describe("web session idle", () => {
  it("isWebSessionIdleExpired_twelveHours_isTheBoundary", () => {
    const last = 5_000;
    assert.equal(isWebSessionIdleExpired(last, last + WEB_SESSION_IDLE_MS - 1), false);
    assert.equal(isWebSessionIdleExpired(last, last + WEB_SESSION_IDLE_MS), true);
    assert.equal(WEB_SESSION_IDLE_MS < MOBILE_SESSION_LIFETIME_SECONDS * 1000, true);
  });

  it("signWebSession_idleIsTwelveHours_mobileBearerStaysThirtyDays", async () => {
    const nowMs = Date.now();
    const web = await signWebSession({ sub: "canonical-user", email: "a@example.com" }, nowMs);
    const mobile = await signSession({ sub: "canonical-user", email: "a@example.com" });
    const webClaims = decodeJwt(web);
    const mobileClaims = decodeJwt(mobile);
    assert.equal(webClaims.exp! - webClaims.iat!, WEB_SESSION_IDLE_SECONDS);
    assert.equal(webClaims.chn, "web");
    assert.equal(mobileClaims.exp! - mobileClaims.iat!, MOBILE_SESSION_LIFETIME_SECONDS);
    assert.equal(mobileClaims.chn, undefined);
    assert.equal(MOBILE_SESSION_LIFETIME_SECONDS, 60 * 60 * 24 * 30);
    const asCookie = await verifyWebSession(mobile);
    assert.equal(asCookie.ok, false);
  });
});
