# Local smoke test for the api-server Docker image. Builds (if --build), runs
# the container on host port 18080, probes /api/healthz, then tears down.
param(
    [string]$Image    = 'binance-loan-backend:test',
    [int]   $HostPort = 18080,
    [switch]$Build,
    [switch]$KeepRunning
)

$ErrorActionPreference = 'Stop'
$container = 'binance-backend-smoke'
Set-Location -Path 'C:\Development\BinanceLoanTracker'

# `docker rm -f` returns exit code 1 (with a Stop policy that's NativeCommandError)
# when the container doesn't exist. Wrap shells in a helper that swallows that.
function Invoke-DockerQuiet([string[]]$DockerArgs) {
    $oldEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & docker @DockerArgs *> $null
    $ErrorActionPreference = $oldEAP
}

if ($Build) {
    Write-Host "-> Building $Image ..."
    docker build -t $Image -f artifacts/api-server/Dockerfile .
    if ($LASTEXITCODE -ne 0) { throw "docker build failed (exit $LASTEXITCODE)" }
}

Invoke-DockerQuiet @('rm', '-f', $container)

Write-Host "-> Starting $container on host port $HostPort ..."
# The smoke test only hits public endpoints (/api/healthz), so the auth env
# vars need only be PRESENT, not real — the container would still fail to
# boot if they were missing entirely (cached config validation).
docker run -d --name $container `
    -p ${HostPort}:8080 `
    -e PORT=8080 `
    -e APPLE_BUNDLE_ID=com.ubuntu.life.ledger `
    -e SESSION_JWT_SECRET=smoke_test_secret_at_least_32_bytes_xxxxxxx `
    $Image | Out-Null
if ($LASTEXITCODE -ne 0) { throw "docker run failed (exit $LASTEXITCODE)" }

Start-Sleep -Seconds 3
docker ps --filter "name=$container" --format '{{.Status}} | {{.Ports}}'

Write-Host "-> Probing http://localhost:$HostPort/api/healthz ..."
$ok = $false
for ($i = 1; $i -le 15; $i++) {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:$HostPort/api/healthz" -TimeoutSec 5 -UseBasicParsing
        if ($r.StatusCode -eq 200) {
            Write-Host ("   OK on attempt {0}: {1}" -f $i, $r.Content)
            $ok = $true
            break
        }
    }
    catch {
        Write-Host ("   attempt {0} failed: {1}" -f $i, $_.Exception.Message)
    }
    Start-Sleep -Seconds 2
}

if (-not $ok) {
    Write-Host "-> Container logs (last 80 lines):"
    docker logs --tail 80 $container
    Invoke-DockerQuiet @('rm', '-f', $container)
    throw "healthz probe failed after 15 attempts"
}

if ($KeepRunning) {
    Write-Host "-> Container left running on port $HostPort. Stop with: docker rm -f $container"
} else {
    Invoke-DockerQuiet @('rm', '-f', $container)
    Write-Host "-> Container removed. Smoke test passed."
}
