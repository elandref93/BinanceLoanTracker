$ErrorActionPreference = 'Stop'

$xml = az webapp deployment list-publishing-profiles `
  --resource-group ubuntu `
  --name binance-loan-tracker-backend `
  --xml | Out-String

$xml = $xml.Trim()

$bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($xml)
$utf8Path = 'C:\Development\BinanceLoanTracker\publish-profile.xml'
[System.IO.File]::WriteAllBytes($utf8Path, $bytes)

Write-Host ("Publish profile written ({0} bytes, no BOM)" -f $bytes.Length)

$xml | gh secret set AZURE_WEBAPP_PUBLISH_PROFILE --repo elandref93/BinanceLoanTracker
Write-Host 'AZURE_WEBAPP_PUBLISH_PROFILE secret updated'
