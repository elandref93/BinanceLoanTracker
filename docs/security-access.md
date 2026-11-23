# Who can open Ledger

The site is not a public login page. A request is answered only when it comes from an allowed network or presents a client certificate this deployment issued. Sign in with Apple is the next lock, after that gate. It is not the thing that hides the site.

## Allowed networks

These two addresses may open the site without a certificate:

- `102.65.11.235`
- `102.36.24.176`

The list is the `ALLOWED_CLIENT_IPS` setting on the API. It is not a substitute for a phone identity.

A normal mobile network does not give an iPhone a stable address. The address the internet sees is shared by other subscribers on that carrier and changes as the phone moves. Do not add a cellular address to this list, and do not allow a whole carrier range. On a mobile network the iPhone and iPad use a client certificate instead.

If either allowed address is a dynamic line, it will change. The site then looks down from that network until `ALLOWED_CLIENT_IPS` is updated.

## Client certificates

A client certificate is checked during TLS, before Ledger HTML is sent. Safari on iPhone and iPad presents a certificate that was installed with a configuration profile. The same certificate works on cellular, home Wi-Fi, and any other network.

Each device gets its own certificate. The private CA stays in `secrets/access/` on the machine that issued it. That directory is gitignored. The CA private key is not an Azure app setting and is not committed.

Issue or rotate devices with:

```bash
node scripts/issue-device-certs.mjs
```

That writes, under `secrets/access/`:

- `ca.crt` — public CA. This PEM is the `EDGE_CLIENT_CA_PEM` setting.
- `iphone.mobileconfig` and `ipad.mobileconfig` — install these (AirDrop or open the file on the device).
- `install.txt` — the profile password. It is required once, when the profile is installed.

On the device: Settings, then the downloaded profile, Install. The private key stays in the keychain, behind the device passcode. The first visit, Safari asks to use the certificate. Later visits use it for this host.

At home, Safari may still ask. Cancelling is fine when the address is one of the two above. On a mobile network, choose the Ledger certificate. Cancelling there does not open the site.

Azure App Service asks for a certificate but does not require one (`clientCertMode` Optional). The API then allows the request when the source address is on the list or the certificate chains to `EDGE_CLIENT_CA_PEM`, is inside its dates, and its serial is not revoked. Platform IP rules cannot express that “or”, so the main site is not locked to those two addresses at the Azure network filter. Doing so would drop the phone before the certificate was considered. The Kudu/SCM site is locked to those two addresses. It is an admin back door, not the app.

`/api/healthz` is the only path excluded, so Azure can probe it. The body is `{ "status": "ok" }` or `{ "status": "degraded" }`. It does not list which settings are missing. `/api/readyz` is behind the same gate as the rest of the API.

The default `*.azurewebsites.net` hostname uses this same gate. It is not a second, open copy of the site.

The web app and `/api` stay on one host. The session cookie is `__Host-` and is not sent to a different API host.

## Revoking a device

1. Read the certificate serial (hex, no colons) from `secrets/access/<device>.crt`.
2. Add it to `EDGE_REVOKED_CERT_SERIALS` (comma-separated) and restart the API.
3. Delete the profile on the device if you still have it: Settings, General, VPN & Device Management.

A lost phone is cut off when the serial is revoked, even if the profile is still installed.

## What stays private

No CA private key, device private key, profile password, session secret, or Apple allowlist address belongs in git or in this document. The allowlist address is `LEDGER_SIGN_IN_EMAIL` on the API only.
