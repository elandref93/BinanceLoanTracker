# Fetches ACR admin credentials from Azure and stores them as GitHub
# repository secrets so CI can `docker login` without any Azure-side auth.
# Idempotent: rerun any time the ACR password is rotated.
param(
    [string]$Acr      = 'binancetrackeracr',
    [string]$RepoSlug = 'elandref93/BinanceLoanTracker'
)

$ErrorActionPreference = 'Stop'

Write-Host "-> Fetching ACR admin credentials for $Acr ..."
$creds = az acr credential show --name $Acr --query '{user:username, pass:passwords[0].value}' -o json | ConvertFrom-Json
if (-not $creds.user -or -not $creds.pass) {
    throw "Could not read ACR credentials. Is admin enabled on $Acr?"
}

Write-Host "-> Storing ACR_USERNAME and ACR_PASSWORD in $RepoSlug ..."
# Pipe through stdin so the secret never appears on a process command line.
$creds.user | & gh secret set ACR_USERNAME --repo $RepoSlug --body -
if ($LASTEXITCODE -ne 0) { throw "gh secret set ACR_USERNAME failed (exit $LASTEXITCODE)" }
$creds.pass | & gh secret set ACR_PASSWORD --repo $RepoSlug --body -
if ($LASTEXITCODE -ne 0) { throw "gh secret set ACR_PASSWORD failed (exit $LASTEXITCODE)" }

Write-Host "-> Done. CI can now docker login $($Acr).azurecr.io"
