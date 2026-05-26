# Fetches ACR admin credentials from Azure and stores them as GitHub
# repository secrets so CI can `docker login` without any Azure-side auth.
# Idempotent: rerun any time the ACR password is rotated.
#
# IMPORTANT: We pass the secret value as a single argv slot via the `&` call
# operator (`gh secret set NAME --body $Value`). Piping the value to stdin
# (`--body -`) from PowerShell tends to introduce a UTF-16 BOM or trailing
# CRLF, which makes the secret look fine in the gh UI but silently breaks
# consumers (docker login, az login, etc.) with cryptic UNAUTHORIZED errors
# — exactly what happened the first time this script ran.
param(
    [string]$Acr      = 'binancetrackeracr',
    [string]$RepoSlug = 'elandref93/BinanceLoanTracker'
)

$ErrorActionPreference = 'Stop'

function Set-GhSecret {
    param([string]$Name, [string]$Value)
    # `--body $Value` via the `&` call operator passes the value as a single
    # argv slot, so PowerShell never invokes shell expansion on it. This
    # avoids the BOM/CRLF issues that piping to `--body -` would introduce.
    & gh secret set $Name --repo $RepoSlug --body $Value
    if ($LASTEXITCODE -ne 0) { throw "gh secret set $Name failed (exit $LASTEXITCODE)" }
}

Write-Host "-> Fetching ACR admin credentials for $Acr ..."
$creds = az acr credential show --name $Acr --query '{u:username, p:passwords[0].value}' -o json | ConvertFrom-Json
if (-not $creds.u -or -not $creds.p) {
    throw "Could not read ACR credentials. Is admin enabled on $Acr?"
}
Write-Host ("   username length: {0} | password length: {1}" -f $creds.u.Length, $creds.p.Length)

Write-Host "-> Storing ACR_USERNAME and ACR_PASSWORD in $RepoSlug ..."
Set-GhSecret -Name 'ACR_USERNAME' -Value $creds.u
Set-GhSecret -Name 'ACR_PASSWORD' -Value $creds.p

Write-Host "-> Done. CI can now docker login $($Acr).azurecr.io"
