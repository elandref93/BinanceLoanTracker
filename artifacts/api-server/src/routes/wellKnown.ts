import { Router, type IRouter } from "express";
import { getOidcIssuer, getPublicJwks } from "../lib/sessionJwt";

/**
 * Public OIDC discovery + JWKS endpoints.
 *
 * These let Azure App Service Authentication ("Easy Auth") validate the app's
 * OWN session JWTs at the platform edge: we register this backend as a custom
 * OpenID Connect provider, and Easy Auth fetches the discovery document + JWKS
 * from here to verify token signatures and the issuer.
 *
 * They MUST be reachable without authentication, so they are mounted at the
 * root (outside the `/api` requireAuth gate). On Azure, also add these paths to
 * the auth `globalValidation.excludedPaths` so Easy Auth doesn't gate its own
 * metadata fetch.
 */
const router: IRouter = Router();

router.get("/.well-known/openid-configuration", (_req, res) => {
  const issuer = getOidcIssuer();
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json({
    issuer,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    // Not used for bearer-token validation, but OIDC metadata consumers expect
    // these to be present and well-formed https URLs.
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    response_types_supported: ["id_token", "token"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    scopes_supported: ["openid"],
    token_endpoint_auth_methods_supported: ["client_secret_post"],
  });
});

router.get("/.well-known/jwks.json", async (_req, res) => {
  const jwks = await getPublicJwks();
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json(jwks);
});

export default router;
