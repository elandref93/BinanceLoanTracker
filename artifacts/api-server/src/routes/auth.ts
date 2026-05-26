import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  AppleTokenVerificationError,
  verifyAppleIdentityToken,
} from "../lib/appleVerifier";
import { signSession } from "../lib/sessionJwt";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Hard cap on the identityToken size — legitimate Apple identity tokens are
// well under 4 KB. Anything larger is either a bug or an attack.
const MAX_APPLE_TOKEN_BYTES = 8 * 1024;

const AppleSignInBody = z.object({
  // The JWT returned by AppleAuthentication.signInAsync() on the device.
  identityToken: z.string().min(1).max(MAX_APPLE_TOKEN_BYTES),
  // Apple only returns the user's full name on the FIRST sign-in. The mobile
  // app forwards it so we can populate the session JWT for UI affordances
  // like "Hi <name>". Subsequent sign-ins will not include this field.
  name: z
    .object({
      givenName: z.string().max(100).nullable().optional(),
      familyName: z.string().max(100).nullable().optional(),
    })
    .optional(),
});

const AppleSignInResponse = z.object({
  sessionToken: z.string(),
  user: z.object({
    sub: z.string(),
    email: z.string().nullable(),
    name: z.string().nullable(),
  }),
});

router.post("/apple", async (req, res) => {
  const parsed = AppleSignInBody.safeParse(req.body);
  if (!parsed.success) {
    logger.warn(
      { issues: parsed.error.issues.map((i) => i.code) },
      "rejected /api/auth/apple — invalid request body",
    );
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const audience = process.env.APPLE_BUNDLE_ID;
  if (!audience) {
    logger.error("APPLE_BUNDLE_ID env var is not set — cannot verify tokens");
    res.status(500).json({ error: "Server is not configured for Apple Sign In" });
    return;
  }

  let appleClaims;
  try {
    appleClaims = await verifyAppleIdentityToken(
      parsed.data.identityToken,
      audience,
    );
  } catch (err) {
    if (err instanceof AppleTokenVerificationError) {
      // Token problems are client-driven (stale/forged/wrong app), so this
      // is a 401, not a 500. We log the reason but never log the token.
      logger.warn(
        { reason: err.reason, msg: err.message },
        "Apple identity token verification failed",
      );
      res.status(401).json({ error: "Invalid Apple identity token" });
      return;
    }
    // Anything else is genuinely a server bug.
    logger.error({ err }, "Unexpected error verifying Apple identity token");
    res.status(500).json({ error: "Internal error verifying token" });
    return;
  }

  // Apple only returns the user's name on first sign-in. If the body included
  // it, prefer that over what's in the token (the token never carries name).
  const fullName =
    parsed.data.name &&
    (parsed.data.name.givenName || parsed.data.name.familyName)
      ? [parsed.data.name.givenName, parsed.data.name.familyName]
          .filter((s): s is string => Boolean(s))
          .join(" ")
          .trim()
      : null;

  const sessionToken = await signSession({
    sub: appleClaims.sub,
    email: appleClaims.email,
    name: fullName ?? undefined,
  });

  logger.info(
    {
      sub: appleClaims.sub,
      hasEmail: Boolean(appleClaims.email),
      hasName: Boolean(fullName),
      isPrivateEmail: appleClaims.isPrivateEmail,
    },
    "Apple Sign In succeeded — session token issued",
  );

  const body = AppleSignInResponse.parse({
    sessionToken,
    user: {
      sub: appleClaims.sub,
      email: appleClaims.email ?? null,
      name: fullName,
    },
  });
  res.status(200).json(body);
});

export default router;
