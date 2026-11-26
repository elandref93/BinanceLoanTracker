param(
    # API host, not the site. This probe is Azure's /api/healthz path on the App
    # Service. For the user-facing site use
    # https://blt-ledger-edge.southafricanorth.cloudapp.azure.com/ instead.
    [string]$Url     = 'https://binance-loan-tracker-backend.azurewebsites.net/api/healthz',
    [int]   $Tries   = 30,
    [int]   $DelaySec = 10
)
$ErrorActionPreference = 'Continue'
for ($i = 1; $i -le $Tries; $i++) {
    try {
        $r = Invoke-WebRequest -Uri $Url -TimeoutSec 15 -UseBasicParsing
        '[{0,2}/{1}] HTTP {2}  {3}' -f $i, $Tries, $r.StatusCode, $r.Content
        if ($r.StatusCode -eq 200) { exit 0 }
    } catch {
        '[{0,2}/{1}] {2}' -f $i, $Tries, $_.Exception.Message
    }
    Start-Sleep -Seconds $DelaySec
}
Write-Host "Healthz never returned 200 after $Tries attempts."
exit 1
