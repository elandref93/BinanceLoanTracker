# Ledger edge: the phone that cannot resolve cloudapp.azure.com

## The symptom

The Ledger web app opened fine at `https://binance-loan-tracker-backend.azurewebsites.net/`
on the user's iPhone, from home and office. After the move to the single URL
`https://blt-ledger-edge.southafricanorth.cloudapp.azure.com/` the same phone
showed **"Safari can't open the page because the server can't be found."**

## What was ruled out, and how

Measured 2026-11-27. Do not re-run these believing they are untested.

**IPv6 — no.** Neither name publishes an AAAA record, so the split cannot be
IPv4-only vs IPv6-only:

| name | A | AAAA |
| --- | --- | --- |
| blt-ledger-edge.southafricanorth.cloudapp.azure.com | 20.164.41.232 | none |
| binance-loan-tracker-backend.azurewebsites.net | CNAME -> waws-prod-jnb21-025-21b2.southafricanorth.cloudapp.azure.com -> 20.87.81.1 | none |

The old working App Service name CNAMEs into `*.southafricanorth.cloudapp.azure.com`
as well, so "cloudapp.azure.com is the broken zone" is not true either.

**Blocklists / family resolvers — no.** The edge name resolves correctly on
Cloudflare 1.1.1.1 and Family 1.1.1.3, Quad9 9.9.9.9, AdGuard 94.140.14.14,
CleanBrowsing 185.228.168.9, OpenDNS 208.67.222.222, Comodo 8.26.56.26 and
ControlD 76.76.2.0. Google DoH with `edns_client_subnet` set to both allowlisted
egress /24s (102.65.11.235, 102.36.24.176) also returns 20.164.41.232. No
NXDOMAIN, no block page, nothing filtered.

**Server unreachable — no.** Public check nodes (check-host.net, DE/RU/US)
reached `https://blt-ledger-edge.southafricanorth.cloudapp.azure.com/` and got a
TLS-terminated 403 in ~0.7 s. Ports 80 and 443 are open in the NSG.

**Certificate — fine.** Let's Encrypt cert, `CN=blt-ledger-edge.southafricanorth.cloudapp.azure.com`,
SAN covers exactly that name, `Verify return code: 0 (ok)`, valid to 2027-02-24.

Conclusion: the failure is **local to that phone's network path**, not something
this deployment can see from outside. The user does not accept the DNS-filtering
theory as proven, and correctly so — it was never demonstrated.

## The durable fix: a name the user already owns

`eapfs.co.za` is delegated to GoDaddy (ns19/ns20.domaincontrol.com) and already
resolves to Azure: apex and `www` both reach `20.87.81.1` (App Service
`eap-website`). It resolves on every filtering resolver tested. Add a name under
it and the phone has a hostname that is *not* on `cloudapp.azure.com`.

The single record, at GoDaddy:

```
Type: A    Name: ledger    Value: 20.164.41.232    TTL: 600
```

(Full name, if GoDaddy asks for it: `ledger.eapfs.co.za`.) Do not touch apex, NS,
MX, TXT/SPF, or `www` — `www` and the apex are live App Service custom domains.

## What the code now does

`EDGE_HOSTNAME` takes a comma-separated list. Every name is authorized
separately over HTTP-01 and lands on one certificate. `server.mjs` follows the
addressed host for redirects and Clerk's `redirect_url`, and only ever forwards
a *configured* name in `x-forwarded-host` (it becomes a redirect target, so a
client-chosen Host must not pass through). `storedCertUsable` demands every
configured name be on the certificate, so a half-covered cert is replaced rather
than served.

`/usr/local/bin/blt-edge-switch` runs from `blt-edge-switch.timer` every 5
minutes on the VM. It waits until `ledger.eapfs.co.za` resolves to the VM's own
IP, then adds it to `EDGE_HOSTNAME` and obtains the two-name certificate *without
removing the Azure label*, then writes `/var/lib/blt-edge/switch.done` and stops.
Adding the name before the record exists would fail the whole ACME order and
take the working certificate with it — hence the gate.

## Proof lines to re-check after switching

App Service log (`az webapp log tail -g ubuntu -n binance-loan-tracker-backend`):

```
edge.allowed path=/api/readyz clientIp=102.36.24.176 ... ipAllowed=true  certAllowed=false
edge.allowed path=/          clientIp=172.17.0.1     ... ipAllowed=false certAllowed=true
```

The second line is the device-certificate path from the VM's own non-allowlisted
egress. `https://binance-loan-tracker-backend.azurewebsites.net/` must stay 403
on every path, `/api/healthz` included.

## Traps

- **Docker Desktop is not running on this PC.** Build the edge image with
  `az acr build --registry binancetrackeracr --image binance-loan-edge:<tag> --file artifacts/edge-proxy/Dockerfile artifacts/edge-proxy`.
- **The VM is not logged in to ACR** after a fresh boot in some cases; log in
  with the registry admin credential via `--password-stdin`, never echo it.
- **`set -e` + `pipefail` kills a bash script** on `getent ahostsv4 <missing>`
  and on `[ -f x ] && exit 0`. Both bit the switch script; both are commented.
- **`az.cmd` splits `--query` on `|`** when run with pipes; parse JSON in
  PowerShell instead.
- **Norton Web/Mail Shield on this PC intercepts TLS** and reports bogus
  handshake failures for unusual Host headers. Get handshake data from the VM.
