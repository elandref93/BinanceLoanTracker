# Deploy api-server to Azure

The Dockerfile in this directory is **monorepo-aware**: it must be built from the
repository root, not from `artifacts/api-server/`, because it copies workspace
manifests (`pnpm-workspace.yaml`, `pnpm-lock.yaml`, `lib/*`) needed for the build.

## Prereqs
- Azure CLI installed and `az login` done
- An Azure subscription
- A resource group (create one with `az group create -n ledger-rg -l westeurope` if needed)

## 1. Build and push the image to Azure Container Registry

```bash
# From the repo root.
RG=ledger-rg
ACR=ledgeracr$RANDOM            # ACR names must be globally unique, lowercase

az acr create -g $RG -n $ACR --sku Basic --admin-enabled true
az acr build -g $RG -r $ACR -t api-server:latest -f artifacts/api-server/Dockerfile .
```

`az acr build` runs the Docker build *in Azure* — you don't need Docker installed locally.

## 2. Create the Web App for Containers

```bash
PLAN=ledger-plan
APP=ledger-api-$RANDOM           # must be globally unique; becomes <APP>.azurewebsites.net

az appservice plan create -g $RG -n $PLAN --is-linux --sku B1
az webapp create -g $RG -p $PLAN -n $APP \
  --deployment-container-image-name $ACR.azurecr.io/api-server:latest

# Wire ACR credentials so the web app can pull the image.
az webapp config container set -g $RG -n $APP \
  --container-image-name $ACR.azurecr.io/api-server:latest \
  --container-registry-url https://$ACR.azurecr.io \
  --container-registry-user $(az acr credential show -n $ACR --query username -o tsv) \
  --container-registry-password $(az acr credential show -n $ACR --query passwords[0].value -o tsv)
```

## 3. Configure required environment variables

The api-server needs these at runtime:

```bash
az webapp config appsettings set -g $RG -n $APP --settings \
  WEBSITES_PORT=8080 \
  APPLE_BUNDLE_ID='com.ubuntu.life.ledger' \
  SESSION_JWT_SECRET="$(openssl rand -hex 32)" \
  NODE_ENV=production
```

- `WEBSITES_PORT=8080` tells Azure which port the container listens on (matches `EXPOSE 8080` in the Dockerfile; the app reads `PORT` which Azure sets to 8080 by default for Linux containers).
- `APPLE_BUNDLE_ID` must exactly match the `bundleIdentifier` in `artifacts/ledger-mobile/app.json`. Apple sets the `aud` claim of every identity token to the requesting app's bundle ID, and the backend rejects any token whose `aud` doesn't match this env.
- `SESSION_JWT_SECRET` is the HMAC key used to sign session JWTs. Must be at least 32 characters of high-entropy randomness. **Never** commit it; **never** reuse the value from another environment. Rotating it invalidates every in-flight session and forces users to sign in again — which is the right behaviour after a suspected leak.

## 4. Verify

```bash
curl https://$APP.azurewebsites.net/healthz
# → 200
```

Then put `$APP.azurewebsites.net` (no scheme, no slash) into the Expo project
env var `EXPO_PUBLIC_DOMAIN` at <https://expo.dev/accounts/elandref/projects>.

## Updating

After code changes, just re-run step 1's `az acr build` and restart the web app:

```bash
az acr build -g $RG -r $ACR -t api-server:latest -f artifacts/api-server/Dockerfile .
az webapp restart -g $RG -n $APP
```

## Local test of the image (optional, requires Docker on your Mac)

```bash
docker build -t ledger-api -f artifacts/api-server/Dockerfile .
docker run --rm -p 8080:8080 \
  -e APPLE_BUNDLE_ID='com.ubuntu.life.ledger' \
  -e SESSION_JWT_SECRET="$(openssl rand -hex 32)" \
  ledger-api
curl http://localhost:8080/api/healthz
```
