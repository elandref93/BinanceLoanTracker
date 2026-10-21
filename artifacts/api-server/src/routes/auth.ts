import { Router, type IRouter } from "express";

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

router.post("/logout", (_req, res) => {
  clearBrowserSession(res);
  res.status(204).end();
});

export default router;
