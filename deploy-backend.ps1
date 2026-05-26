<#
.SYNOPSIS
  Local fallback deployment for the Binance Loan Tracker backend.

.DESCRIPTION
  Builds the api-server with pnpm, stages a clean deploy package
  (dist + minimal package.json) and zip-deploys it to the Azure Web App.

  CI is the recommended deployment path - this script exists only as a
  manual fallback when CI cannot run. It requires:
    - working pnpm (TLS-enabled environment)
    - az CLI logged in to the target subscription

.EXAMPLE
  ./deploy-backend.ps1
#>

param(
  [string]$ResourceGroup = "ubuntu",
  [string]$WebAppName = "binance-loan-tracker-backend"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $repoRoot

try {
  Write-Host "==> Installing workspace dependencies..." -ForegroundColor Cyan
  pnpm install --no-frozen-lockfile

  Write-Host "==> Building api-server bundle..." -ForegroundColor Cyan
  pnpm --filter @workspace/api-server run build

  $deployDir = Join-Path $repoRoot "deploy"
  if (Test-Path $deployDir) { Remove-Item $deployDir -Recurse -Force }
  New-Item -ItemType Directory -Path $deployDir | Out-Null

  Write-Host "==> Staging clean deployment package..." -ForegroundColor Cyan
  Copy-Item "artifacts/api-server/dist" -Destination (Join-Path $deployDir "dist") -Recurse

  $pkg = @{
    name = "binance-loan-tracker-backend"
    version = "0.0.0"
    private = $true
    type = "module"
    scripts = @{ start = "node --enable-source-maps ./dist/index.mjs" }
  } | ConvertTo-Json -Depth 5
  Set-Content -Path (Join-Path $deployDir "package.json") -Value $pkg -Encoding UTF8

  $zipPath = Join-Path $repoRoot "deploy.zip"
  if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
  Compress-Archive -Path (Join-Path $deployDir '*') -DestinationPath $zipPath -Force

  Write-Host "==> Deploying to Azure Web App: $WebAppName" -ForegroundColor Cyan
  az webapp deploy `
    --resource-group $ResourceGroup `
    --name $WebAppName `
    --src-path $zipPath `
    --type zip

  Write-Host "==> Restarting Web App..." -ForegroundColor Cyan
  az webapp restart --resource-group $ResourceGroup --name $WebAppName

  Write-Host "==> Done. Open https://$WebAppName.azurewebsites.net/healthz" -ForegroundColor Green
}
finally {
  Pop-Location
}
