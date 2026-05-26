# Wires the App Service's "continuous deployment" webhook into ACR so the
# webapp auto-pulls binance-loan-backend:latest whenever it's pushed. Once
# this is in place, CI's only job for deploy is `docker push` — no Azure
# credentials needed from GitHub Actions.
#
# Safe to re-run: az acr webhook create errors with "AlreadyExists" if the
# webhook is present; we look for the existing one and update it instead.
param(
    [string]$ResourceGroup = 'ubuntu',
    [string]$WebApp        = 'binance-loan-tracker-backend',
    [string]$Acr           = 'binancetrackeracr',
    [string]$Image         = 'binance-loan-backend',
    [string]$Tag           = 'latest',
    [string]$WebhookName   = 'backendAutoDeploy'
)

$ErrorActionPreference = 'Stop'

Write-Host "-> Enabling continuous deployment on $WebApp ..."
$webhookUri = az webapp deployment container config `
    --resource-group $ResourceGroup `
    --name $WebApp `
    --enable-cd true `
    --query CI_CD_URL -o tsv
if (-not $webhookUri) { throw "Could not obtain App Service CI_CD_URL" }
Write-Host "   webhook URI: <obtained>"

# Webhook names must be alphanumeric, 5-50 chars; the param default complies.
Write-Host "-> Finding webhook '$WebhookName' on ACR '$Acr' ..."
$existing = az acr webhook list --registry $Acr --query "[?name=='$WebhookName'].name" -o tsv

$scope    = "$($Image):$Tag"
$location = az acr show --name $Acr --query location -o tsv

if ($existing) {
    Write-Host "-> Updating existing webhook '$WebhookName' ..."
    az acr webhook update `
        --registry $Acr `
        --name $WebhookName `
        --uri $webhookUri `
        --actions push `
        --scope $scope `
        --output none
} else {
    Write-Host "-> Creating webhook '$WebhookName' ..."
    az acr webhook create `
        --registry $Acr `
        --name $WebhookName `
        --location $location `
        --uri $webhookUri `
        --actions push `
        --scope $scope `
        --output none
}

Write-Host "-> Done. Pushing $Image`:$Tag to $Acr.azurecr.io will trigger an App Service pull."
az acr webhook show --registry $Acr --name $WebhookName `
    --query '{name:name, status:status, actions:actions, scope:scope}' -o json
