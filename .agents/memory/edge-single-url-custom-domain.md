# Ledger edge: the phone that cannot open the Azure name

**Decision, 2026-11-27: there is no custom domain and none will be bought.**
The single public URL is `https://blt-ledger-edge.southafricanorth.cloudapp.azure.com/`.
Anything that assumed `eapfs.co.za` — the DNS record, the switch script, the
`ALLOWED_ORIGINS` entry — is retired.

## The symptom

The same iPhone opened `https://binance-loan-tracker-backend.azurewebsites.net/`
fine, from home and office. On the Azure edge name Safari says **"Safari can't
open the page because the server can't be found."** A Windows PC on the same two
networks loads the URL fine, and the PC holds *no* device certificate.

## Ruled out, with the measurement

| Hypothesis | Result |
| --- | --- |
| Name does not resolve | Resolves to 20.164.41.232 on 1.1.1.1, 1.1.1.3, 9.9.9.9, 8.8.8.8, 208.67.222.222, 94.140.14.14, 185.228.168.9, 76.76.2.0 and the authoritative `ns1-09.azure-dns.com` |
| IPv6 / AAAA split | No AAAA on the edge name, and none on the VM. Not an IP-family problem |
| DNSSEC | `azure.com` and `cloudapp.azure.com` are unsigned; no RRSIG anywhere, so nothing to fail validation |
| Stale negative cache | A TTL is 10 s, SOA negative TTL is 300 s. A cached NXDOMAIN cannot survive five minutes of retries |
| NSG blocking | `allow-http` (100) and `allow-https` (110) allow `*` inbound; no NIC-level rule overriding them |
| Broken TLS on the server | TLS 1.2 `ECDHE-RSA-AES256-GCM-SHA384` and TLS 1.3 `TLS_AES_128_GCM_SHA256`/`_256_GCM_SHA384` all negotiate, `Verify return code: 0`, SAN is exactly the edge name, valid to 2027-02-24 |
| Client-certificate path | Presenting the real `iphone` identity gives `client_verify=SUCCESS` and 200. No cert also works. The CA is `CN=Ledger Device CA`, CA:TRUE |
| The profile breaks the phone's networking | The `.mobileconfig` payloads are `com.apple.security.root` + `com.apple.security.pkcs12` only — no DNS, no proxy, no VPN payload |

**Correction:** the older note here said "TLS advertises CN=Ledger Device CA".
That is the *client* CA in `ssl_client_certificate`. The server certificate is a
Let's Encrypt leaf, `CN=blt-ledger-edge.southafricanorth.cloudapp.azure.com`.

## What the edge now does about it

Two diagnostics that answer **above the app gate and never proxied to the API**,
so a device that cannot pass the gate can still prove what it reached:

- `GET /edge-ping` over HTTPS → `edge ok <client ip> <iso time>`. Works with no
  certificate and from a non-allowlisted address. Success implies hostname,
  TLS and route are all fine, isolating the gate as the only remaining variable.
- `GET /edge-http-ping` over plain HTTP → echoes client address, Host, port,
  user agent, server time, and the line `ledger edge reachable over HTTP`.
  Matched **ahead of** `location /` so the 301 upgrade cannot hide it. Also
  served over TLS for a browser that upgrades the scheme first.

Both echo only what the socket and request already exposed, strip control
characters and markup, and reveal nothing about the deployment.

nginx now logs one line per request (`listener`, `peer`, `host`, `uri`, `status`,
`tls`, `cipher`, `sni`, `client_verify`) and runs `error_log` at `info`. **A
connection that never completes produces no access-log line at all** — the peer
address only appears in the "client closed connection while SSL handshaking"
error line, which is why `info` and not `warn` is the level to use when chasing
a device that cannot connect.

## Reading a capture

`tcpdump -ni eth0` on this VM sees both directions, and the public IP is
NAT'd onto eth0, so **a real visitor's source address appears as itself**
(confirmed: `102.36.24.176 -> 10.0.0.4.443`). The VM's own outbound traffic
appears as `10.0.0.4 -> 20.164.41.232`, which is easy to mistake for a visitor.
It is not.

`/usr/local/bin/blt-capture-report` on the VM summarises the running capture and
filters this PC, the VM and the Azure probe out, so a genuine phone attempt is
the only thing left visible.

## Traps

- **Docker Desktop is not running on this PC.** Build with
  `az acr build --registry binancetrackeracr --image binance-loan-edge:<tag> --file artifacts/edge-proxy/Dockerfile artifacts/edge-proxy`.
- **Recreating the container must keep the `edge-certs` volume.** Losing it
  throws away the valid Let's Encrypt certificate and forces a new ACME order.
  Copy env with `docker inspect` into a `--env-file`, never retype secrets.
- **`tcpdump -n` writes `host.port` with a dot**, not a colon. Stripping
  `:[0-9]+$` silently does nothing and makes every peer look like a bare IP.
- **Norton Web/Mail Shield on this PC intercepts TLS** and produces spurious
  handshake failures on the first attempt to a new host. Retry before believing
  a client-side TLS error; take handshake evidence from the VM.
- **`az.cmd` splits `--query` on `|`** when run with pipes; parse JSON in
  PowerShell instead.
- The old `blt-edge-switch.timer` is **disabled**. `blt-edge-renew.timer` on the
  same VM is still enabled and must stay that way, or the certificate lapses.
