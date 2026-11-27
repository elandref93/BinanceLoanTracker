param(
    # The only URL that serves Ledger. The App Service hostname
    # (binance-loan-tracker-backend.azurewebsites.net) denies every path, so it
    # is not probeable; use the edge instead.
    [string]$Url     = 'https://blt-ledger-edge.southafricanorth.cloudapp.azure.com/api/healthz',
    # Proves the edge -> API channel, not just the edge.
    [string]$Channel = 'https://blt-ledger-edge.southafricanorth.cloudapp.azure.com/api/edge-healthz',
    [int]   $Tries   = 30,
    [int]   $DelaySec = 10
)
$ErrorActionPreference = 'Continue'
for ($i = 1; $i -le $Tries; $i++) {
    try {
        $r = Invoke-WebRequest -Uri $Url -TimeoutSec 15 -UseBasicParsing
        '[{0,2}/{1}] HTTP {2}  {3}' -f $i, $Tries, $r.StatusCode, $r.Content
        if ($r.StatusCode -eq 200) {
            if ($Channel) {
                try {
                    $c = Invoke-WebRequest -Uri $Channel -TimeoutSec 15 -UseBasicParsing
                    "      edge -> API channel: HTTP $($c.StatusCode)  $($c.Content)"
                } catch {
                    "      edge -> API channel: $($_.Exception.Message)"
                }
            }
            exit 0
        }
    } catch {
        '[{0,2}/{1}] {2}' -f $i, $Tries, $_.Exception.Message
    }
    Start-Sleep -Seconds $DelaySec
}
Write-Host "Healthz never returned 200 after $Tries attempts."
exit 1
