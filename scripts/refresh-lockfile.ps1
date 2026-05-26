$ErrorActionPreference = 'Stop'
$env:CI = 'true'
Set-Location -Path 'C:\Development\BinanceLoanTracker'
pnpm install --no-frozen-lockfile --prefer-offline
