import { createClerkClient, verifyToken } from "@clerk/express";
import { Router, type IRouter } from "express";

import { listAppleEmailBindings } from "../lib/appleIdentities";
import { clerkVerifiedEmail, decideClerkLedgerSession } from "../lib/clerkLedgerSession";
import { logSubject, logger } from "../lib/logger";
import { clearBrowserSession } from "../lib/requestAuth";
import { SigningKeyMissingError, signWebSession } from "../lib/sessionJwt";
import { newCsrfToken, setCsrfCookie, setWebSessionCookie } from "../lib/webSession";

const router: IRouter = Router();
const BEARER = /^Bearer\s+(\S+)$/i;

function displayName(firstName: string | null, lastName: string | null): string | undefined {
  const name = [firstName, lastName]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ")
    .trim();
  return name.length > 0 ? name : undefined;
}

/**
 * Exchanges an Apple Clerk session for the existing Ledger browser cookie.
 * Email, password, and other social strategies are revoked with no cookie.
 * The mobile bearer path is unchanged.
 */
router.post("/", async (req, res) => {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    res.status(503).json({ error: "not_configured" });
    return;
  }

  const token = req.header("authorization")?.match(BEARER)?.[1];
  if (!token) {
    clearBrowserSession(res);
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const clerk = createClerkClient({ secretKey });
  let sessionId = "";
  try {
    const payload = await verifyToken(token, { secretKey });
    sessionId = typeof payload.sid === "string" ? payload.sid : "";
    const clerkUserId = typeof payload.sub === "string" ? payload.sub : "";
    if (clerkUserId.length === 0 || sessionId.length === 0) {
      await revokeClerkSession(clerk, sessionId);
      clearBrowserSession(res);
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const session = await clerk.sessions.getSession(sessionId);
    if (session.userId !== clerkUserId) {
      await revokeClerkSession(clerk, sessionId);
      clearBrowserSession(res);
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const client = await clerk.clients.getClient(session.clientId);
    const user = await clerk.users.getUser(clerkUserId);
    const verified = clerkVerifiedEmail({
      primaryEmailAddressId: user.primaryEmailAddressId,
      emailAddresses: user.emailAddresses.map((item) => ({
        id: item.id,
        emailAddress: item.emailAddress,
        verification: item.verification ? { status: item.verification.status } : null,
      })),
    });
    const decision = decideClerkLedgerSession({
      email: verified.email,
      emailVerified: verified.emailVerified,
      strategy: client.lastAuthenticationStrategy,
      candidates: await listAppleEmailBindings(),
    });
    if (decision.outcome !== "session") {
      await revokeClerkSession(clerk, sessionId);
      clearBrowserSession(res);
      logger.info(
        { op: "auth.clerk", reason: decision.reason, strategy: client.lastAuthenticationStrategy },
        "clerk sign-in rejected — no session issued",
      );
      res.status(403).json({ error: "not_allowed" });
      return;
    }

    const sessionToken = await signWebSession({
      sub: decision.canonicalSub,
      email: decision.email,
      name: displayName(user.firstName, user.lastName),
    });
    setWebSessionCookie(res, sessionToken);
    setCsrfCookie(res, newCsrfToken());
    logger.info(
      { op: "auth.clerk", user: logSubject(decision.canonicalSub) },
      "clerk sign-in issued a cookie session",
    );
    res.status(204).end();
  } catch (err) {
    await revokeClerkSession(clerk, sessionId);
    clearBrowserSession(res);
    if (err instanceof SigningKeyMissingError) {
      logger.warn(
        { op: "auth.clerk", reason: "signing_unavailable" },
        "clerk sign-in could not sign a session",
      );
      res.status(503).json({ error: "signing_unavailable" });
      return;
    }
    logger.warn({ err, op: "auth.clerk" }, "clerk sign-in token was rejected");
    res.status(401).json({ error: "Unauthorized" });
  }
});

async function revokeClerkSession(
  clerk: ReturnType<typeof createClerkClient>,
  sessionId: string,
): Promise<void> {
  if (sessionId.length === 0) return;
  try {
    await clerk.sessions.revokeSession(sessionId);
  } catch (err) {
    logger.warn({ err, op: "auth.clerk" }, "clerk session revoke failed — ledger cookie still withheld");
  }
}

export default router;
