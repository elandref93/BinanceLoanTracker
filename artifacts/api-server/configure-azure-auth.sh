#!/usr/bin/env bash
#
# Adds the app's own session-JWT issuer as a custom OpenID Connect provider to
# Azure App Service Easy Auth, WITHOUT removing the existing Microsoft (Entra ID)
# provider. Run this in Azure Cloud Shell (Bash).
#
# Usage:
#   ./configure-azure-auth.sh [RESOURCE_GROUP]
# If RESOURCE_GROUP is omitted it is auto-detected from the app name.

set -euo pipefail

APP="binance-loan-tracker-backend"
DISCOVERY="https://binance-loan-tracker-backend.azurewebsites.net/.well-known/openid-configuration"

RG="${1:-}"
if [ -z "$RG" ]; then
  RG="$(az webapp list --query "[?name=='$APP'].resourceGroup" -o tsv)"
fi
echo "App:            $APP"
echo "Resource group: $RG"

echo "==> Exporting current Easy Auth config (Microsoft provider preserved)..."
az webapp auth show -g "$RG" -n "$APP" > current-auth.json

echo "==> Merging in the custom OIDC provider + public metadata exclusions..."
jq --arg disc "$DISCOVERY" '
  .globalValidation.requireAuthentication = true
  | .globalValidation.unauthenticatedClientAction = "Return401"
  | .globalValidation.excludedPaths = [
      "/.well-known/openid-configuration",
      "/.well-known/jwks.json",
      "/api/auth/apple",
      "/api/healthz"
    ]
  | .identityProviders.customOpenIdConnectProviders.appsession = {
      registration: {
        clientId: "binance-loan-tracker-mobile",
        openIdConnectConfiguration: {
          wellKnownOpenIdConfiguration: $disc
        }
      },
      login: { nameClaimType: "sub" }
    }
' current-auth.json > merged-auth.json

echo "==> Applying merged config..."
az webapp auth set -g "$RG" -n "$APP" --body @merged-auth.json

echo "==> Done. Identity providers now configured:"
jq -r '.identityProviders | keys[]' merged-auth.json
