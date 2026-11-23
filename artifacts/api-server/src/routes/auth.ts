import { Router, type IRouter } from "express";

import { revokeWebSession } from "../lib/sessionRevocation";
import { WEB_SESSION_ABSOLUTE_SECONDS } from "../lib/sessionJwt";
import { clearBrowserSession } from "../lib/requestAuth";

const router: IRouter = Router();

/**
 * Browser session status. The cookie is the only credential. This response
 * never includes a bearer token.
 */
router.get("/session", (req, res) => {
  if (req.authVia !== "cookie" || !req.sessionClaims) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.status(200).json({
    user: {
      sub: req.sessionClaims.sub,
      email: req.sessionClaims.email ?? null,
      name: req.sessionClaims.name ?? null,
    },
  });
});

router.post("/logout", async (req, res, next) => {
  try {
    // A cross-site form does not send the SameSite=Lax session cookie, so it
    // must not receive a clearing Set-Cookie either. CSRF already ran when
    // the cookie was present.
    if (req.authVia !== "cookie" || !req.sessionClaims) {
      res.status(204).end();
      return;
    }
    if (typeof req.sessionClaims.sid === "string" && typeof req.sessionClaims.abs === "number") {
      await revokeWebSession(req.sessionClaims.sid, (req.sessionClaims.abs + WEB_SESSION_ABSOLUTE_SECONDS) * 1000);
    }
    clearBrowserSession(res);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
