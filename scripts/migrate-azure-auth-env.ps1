# One-shot migration script: swaps Azure App Service env vars from Clerk-era
# (CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY) to native Apple Sign In + session
# JWT (APPLE_BUNDLE_ID, SESSION_JWT_SECRET).
#
# Idempotent — safe to re-run; the random SESSION_JWT_SECRET is generated only
# if one isn't already set. Once you've run it once, re-running won't rotate
# the secret (which would invalidate every existing user session).

param(
    [string]$ResourceGroup = 'ubuntu',
    [string]$WebApp        = 'binance-loan-tracker-backend',
    [string]$BundleId      = 'com.ubuntu.life.ledger'
)

$ErrorActionPreference = 'Stop'

function New-HexSecret {
    param([int]$Bytes = 32)
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $buf = New-Object byte[] $Bytes
        $rng.GetBytes($buf)
        return -join ($buf | ForEach-Object { $_.ToString('x2') })
    } finally {
        $rng.Dispose()
    }
}

Write-Host "-> Reading current app settings on $WebApp ..."
$current = az webapp config appsettings list `
    --resource-group $ResourceGroup `
    --name $WebApp `
    -o json | ConvertFrom-Json

$names    = $current | ForEach-Object { $_.name }
$existing = @{}
foreach ($s in $current) { $existing[$s.name] = $s.value }

# Keep SESSION_JWT_SECRET stable across re-runs to avoid invalidating sessions.
$sessionSecret = if ($existing.ContainsKey('SESSION_JWT_SECRET') -and $existing['SESSION_JWT_SECRET']) {
    Write-Host '   keeping existing SESSION_JWT_SECRET (re-run safe)'
    $existing['SESSION_JWT_SECRET']
} else {
    $generated = New-HexSecret -Bytes 32
    Write-Host '   generated new SESSION_JWT_SECRET (64 hex chars / 256 bits)'
    $generated
}

Write-Host "-> Adding APPLE_BUNDLE_ID + SESSION_JWT_SECRET ..."
az webapp config appsettings set `
    --resource-group $ResourceGroup `
    --name $WebApp `
    --settings "APPLE_BUNDLE_ID=$BundleId" "SESSION_JWT_SECRET=$sessionSecret" `
    --output none
if ($LASTEXITCODE -ne 0) { throw "az appsettings set failed (exit $LASTEXITCODE)" }

# Remove the old Clerk vars only if they exist; deleting non-existent
# settings still returns 0 but emits a noisy warning.
$toDelete = @()
if ($names -contains 'CLERK_PUBLISHABLE_KEY') { $toDelete += 'CLERK_PUBLISHABLE_KEY' }
if ($names -contains 'CLERK_SECRET_KEY')      { $toDelete += 'CLERK_SECRET_KEY' }

if ($toDelete.Count -gt 0) {
    Write-Host "-> Removing obsolete Clerk env vars: $($toDelete -join ', ')"
    az webapp config appsettings delete `
        --resource-group $ResourceGroup `
        --name $WebApp `
        --setting-names @toDelete `
        --output none
    if ($LASTEXITCODE -ne 0) { throw "az appsettings delete failed (exit $LASTEXITCODE)" }
} else {
    Write-Host '-> No Clerk env vars present (already cleaned up)'
}

Write-Host '-> Final relevant env vars on Azure:'
az webapp config appsettings list `
    --resource-group $ResourceGroup `
    --name $WebApp `
    -o json | ConvertFrom-Json |
    Where-Object { $_.name -in 'APPLE_BUNDLE_ID', 'SESSION_JWT_SECRET', 'CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY', 'NODE_ENV', 'WEBSITES_PORT' } |
    ForEach-Object {
        $masked = if ($_.name -eq 'SESSION_JWT_SECRET' -and $_.value) {
            $_.value.Substring(0, 6) + '…' + $_.value.Substring($_.value.Length - 4)
        } else { $_.value }
        [pscustomobject]@{ Name = $_.name; Value = $masked }
    } |
    Format-Table -AutoSize

Write-Host ''
Write-Host '-> Note: Azure App Service auto-restarts the container when'
Write-Host '         appsettings change. Allow ~30-60 s for the new env to land.'
