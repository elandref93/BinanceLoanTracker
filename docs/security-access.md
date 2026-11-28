# Who can open Ledger

Ledger has one public address:

`https://blt-ledger-edge.southafricanorth.cloudapp.azure.com/`

Use that name. Do not use the numeric address, and do not use either of the hosts below. A request is answered only when it comes from an allowed network or presents a client certificate this deployment issued. Sign in with Apple is the next lock, after that gate. It is not the thing that hides the site.

## Addresses that are not the site

- `https://binance-loan-tracker-backend.azurewebsites.net/` is **not** a site address and answers nothing. It is the API host behind the edge, and it refuses **every** path, `/api/healthz` included, unless the request carries the edge's signed attestation. The health probe lives on the public address above instead, so the retired host is silent even to a scanner.
- `https://blt-ledger-edge.southafricanorth.azurecontainer.io/` no longer exists. The container instance that answered on it is gone and the name does not resolve. Nothing points at it any more.
- `20.164.41.232` is the edge machine's address, not a site address. The edge refuses a TLS handshake for any name it was not configured with, and a browser sends no name for an address literal, so `https://20.164.41.232/` fails to connect instead of warning that the certificate belongs to a different name. A plain-HTTP request to the address is closed without a response.

## Allowed networks

These two addresses may open the site without a certificate:

- `102.65.11.235`
- `102.36.24.176`

The list is the `ALLOWED_CLIENT_IPS` setting on the API. It is not a substitute for a phone identity.

A normal mobile network does not give an iPhone a stable address. The address the internet sees is shared by other subscribers on that carrier and changes as the phone moves. Do not add a cellular address to this list, and do not allow a whole carrier range. On a mobile network the iPhone and iPad use a client certificate instead.

If either allowed address is a dynamic line, it will change. The site then looks down from that network until `ALLOWED_CLIENT_IPS` is updated.

## Client certificates

A client certificate is checked during TLS, before Ledger HTML is sent. Safari on iPhone and iPad presents a certificate that was installed with a configuration profile. The same certificate works on cellular, home Wi-Fi, and any other network. TLS advertises the issuing authority as `CN=Ledger Device CA`, so a phone with the profile installed can pick it in the Safari certificate prompt.

Each device gets its own certificate. The private CA stays in `secrets/access/` on the machine that issued it. That directory is gitignored. The CA private key is not an Azure app setting and is not committed.

Issue or rotate devices with:

```bash
node scripts/issue-device-certs.mjs
```

That writes, under `secrets/access/`:

- `ca.crt` — public CA. This PEM is the `EDGE_CLIENT_CA_PEM` setting.
- `iphone.mobileconfig` and `ipad.mobileconfig` — install these (AirDrop or open the file on the device).
- `install.txt` — the profile password, which the device needs once while installing.

On the device: Settings, then the downloaded profile, Install. Enter the profile password from `install.txt`. The private key stays in the keychain, behind the device passcode. The first visit, Safari asks to use the certificate. Later visits use it for this host.

Open Ledger at `https://blt-ledger-edge.southafricanorth.cloudapp.azure.com/` only. When Safari asks, choose the Ledger certificate. That certificate is what admits the phone on cellular and on home Wi-Fi.

## How the gate decides

The API treats the two network addresses and a valid device certificate as separate passes. It strips a trailing source port before the address comparison. A pass counts only when the edge signs the address and certificate with `EDGE_CERT_PROXY_SECRET`. TLS ends on a virtual machine in South Africa North, so the edge sees the visitor's socket address directly. A home visit from an allowlisted address opens the site with no certificate. A device certificate still opens it from any other network.

The web app and `/api` stay on one host. The session cookie is `__Host-` and is not sent to a different API host.

The public name is a label on the edge machine, not a second deployment. There is one copy of the app, and the App Service hostname is reachable only as the edge's back end.

## Revoking a device

1. Read the certificate serial (hex, no colons) from `secrets/access/<device>.crt`.
2. Add it to `EDGE_REVOKED_CERT_SERIALS` (comma-separated) and restart the API.
3. Delete the profile on the device if you still have it: Settings, General, VPN & Device Management.

A lost phone is cut off when the serial is revoked, even if the profile is still installed. Revocation is by serial, so it does not need a new CA and does not touch the other devices.

## What stays private

No CA private key, device private key, profile password, session secret, edge proxy secret, or the sign-in address belongs in git or in this document. The sign-in address is the `LEDGER_SIGN_IN_EMAIL` setting on the API only.
