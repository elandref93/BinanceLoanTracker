# Flips the binance-loan-tracker-backend Web App from the built-in Node
# runtime (zip deploy) to "Web App for Containers" pulling from ACR.
#
# App settings (APPLE_BUNDLE_ID, SESSION_JWT_SECRET, NODE_ENV, WEBSITES_PORT,
# etc.) are preserved by the
# az CLI — only linuxFxVersion + container registry credentials change.
#
# Safe to re-run: az webapp config container set is idempotent.
param(
    [string]$ResourceGroup = 'ubuntu',
    [string]$WebApp        = 'binance-loan-tracker-backend',
    [string]$Acr           = 'binancetrackeracr',
    [string]$Image         = 'binance-loan-backend',
    [string]$Tag           = 'latest'
)

$ErrorActionPreference = 'Stop'
$registry = "$Acr.azurecr.io"
$fullImage = "$registry/$Image" + ":" + $Tag

Write-Host "-> Reading ACR admin credentials for $Acr ..."
$creds = az acr credential show --name $Acr --query '{u:username, p:passwords[0].value}' -o json | ConvertFrom-Json
if (-not $creds.u -or -not $creds.p) { throw "Could not read ACR admin credentials" }

Write-Host "-> Pointing $WebApp at $fullImage ..."
az webapp config container set `
    --resource-group $ResourceGroup `
    --name $WebApp `
    --container-image-name $fullImage `
    --container-registry-url "https://$registry" `
    --container-registry-user $creds.u `
    --container-registry-password $creds.p `
    --output none
if ($LASTEXITCODE -ne 0) { throw "az webapp config container set failed (exit $LASTEXITCODE)" }

# When App Service runs a container, a non-empty appCommandLine OVERRIDES the
# Dockerfile CMD. If the old zip-era value (`node ... /home/site/wwwroot/...`)
# lingers, the container will run that path on every restart and crash with
# MODULE_NOT_FOUND because our bundle lives at /app/dist inside the image.
# `--startup-file ''` is rejected by az CLI (empty string not allowed); the
# generic-configurations JSON path is the only thing that actually clears it.
Write-Host "-> Clearing legacy appCommandLine (forces Dockerfile CMD) ..."
$tmpJson = [System.IO.Path]::Combine($env:TEMP, "clear-app-command-$([guid]::NewGuid()).json")
'{"appCommandLine": ""}' | Set-Content -Path $tmpJson -Encoding utf8 -NoNewline
try {
    az webapp config set `
        --resource-group $ResourceGroup `
        --name $WebApp `
        --generic-configurations "@$tmpJson" `
        --output none
}
finally { Remove-Item $tmpJson -ErrorAction SilentlyContinue }

# Make sure WEBSITES_PORT matches the EXPOSE 8080 in the Dockerfile (the
# previous zip deploy may have set this already; this is just a safety net).
Write-Host "-> Ensuring WEBSITES_PORT=8080 app setting ..."
az webapp config appsettings set `
    --resource-group $ResourceGroup `
    --name $WebApp `
    --settings WEBSITES_PORT=8080 `
    --output none

Write-Host "-> Restarting $WebApp ..."
az webapp restart --resource-group $ResourceGroup --name $WebApp --output none

Write-Host "-> Done. Final config:"
az webapp config show `
    --resource-group $ResourceGroup `
    --name $WebApp `
    --query '{linuxFxVersion:linuxFxVersion, appCommandLine:appCommandLine, healthCheckPath:healthCheckPath, alwaysOn:alwaysOn}' `
    -o json
