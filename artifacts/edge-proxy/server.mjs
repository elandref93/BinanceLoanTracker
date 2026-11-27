import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { issueCertificate } from "./acme.mjs";

const CERT_DIR = process.env.EDGE_CERT_DIR || "/var/lib/edge-certs";
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/**
 * Headers that describe where a request came from and how it was addressed.
 * A client can type these inside TLS, so every one of them is dropped here and
 * the edge writes its own value. The backend builds absolute URLs (Clerk's
 * sign-in handshake redirect_url among them) from the addressed host, so a
 * client-set value is both a wrong-origin bug and a redirect-poisoning hole.
 */
const PROXY_OWNED_HEADERS = [
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
  "x-real-ip",
  "x-arr-clientcert",
  // Clerk treats this as an override for the request origin.
  "x-clerk-clerk-url",
  // Attestation: only this process may make these claims.
  "x-ledger-client-ip",
  "x-ledger-ip-mac",
  "x-ledger-client-cert",
  "x-ledger-cert-mac",
];

export function decodeConfiguredPem(value) {
  return value.trim().replace(/^\uFEFF/, "").replace(/\\n/g, "\n");
}

/** Must match ipAttestationMac in the API. */
export function ipAttestationMac(secret, ip) {
  return crypto.createHmac("sha256", secret).update(`ip\n${ip}`, "utf8").digest("hex");
}

/** Must match certAttestationMac in the API. Signs the certificate header alone. */
export function certAttestationMac(secret, certHeader) {
  return crypto
    .createHmac("sha256", secret)
    .update(`cert\n${certHeader}`, "utf8")
    .digest("hex");
}

/**
 * nginx hands over `$ssl_client_escaped_cert`: a URL-escaped PEM document, and
 * the literal `-` when the visitor presented no certificate. The API reads a
 * certificate from base64 DER, and a short header survives every hop. A PEM in
 * a header is ~1.4 KB and carries `%` and newlines that intermediaries rewrite,
 * which silently invalidated the MAC over it.
 *
 * Anything that does not parse as a certificate is dropped rather than
 * forwarded, so a broken header can never claim to be a device identity.
 */
export function toCertificateHeader(escapedPem) {
  const value = String(escapedPem ?? "").trim();
  if (value.length === 0 || value === "-") return "";
  let pem = value;
  if (value.includes("%")) {
    try {
      pem = decodeURIComponent(value);
    } catch {
      return "";
    }
  }
  if (!pem.includes("BEGIN CERTIFICATE")) return "";
  try {
    const der = new crypto.X509Certificate(decodeConfiguredPem(pem)).raw;
    return Buffer.from(der).toString("base64");
  } catch {
    return "";
  }
}


function log(fields) {
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), ...fields })}\n`);
}

function storedCertUsable(hostname) {
  const certPath = path.join(CERT_DIR, "fullchain.pem");
  const keyPath = path.join(CERT_DIR, "privkey.pem");
  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) return null;
  try {
    const certPem = fs.readFileSync(certPath, "utf8");
    const keyPem = fs.readFileSync(keyPath, "utf8");
    const cert = new crypto.X509Certificate(certPem);
    const names = `${cert.subjectAltName ?? ""}\n${cert.subject}`;
    const named = names.includes(`DNS:${hostname}`) || names.includes(`CN=${hostname}`);
    const remains = cert.validToDate.getTime() - Date.now();
    if (!named || remains < 14 * 24 * 60 * 60 * 1000) return null;
    return { certPem, keyPem };
  } catch {
    return null;
  }
}

function rememberCert(certPem, keyPem) {
  fs.mkdirSync(CERT_DIR, { recursive: true });
  fs.writeFileSync(path.join(CERT_DIR, "fullchain.pem"), certPem, { mode: 0o600 });
  fs.writeFileSync(path.join(CERT_DIR, "privkey.pem"), keyPem, { mode: 0o600 });
}

function rewriteLocation(value, backendOrigin, publicOrigin) {
  if (typeof value !== "string" || !value.startsWith(backendOrigin)) return value;
  return publicOrigin + value.slice(backendOrigin.length);
}

function oneHeader(req, name) {
  const value = req.headers[name];
  const text = Array.isArray(value) ? value.join(",") : String(value ?? "");
  return text.replace(/[\r\n]/g, " ").trim().slice(0, 180);
}

/**
 * App Streams sends a request on a connection it kept idle, then holds the
 * socket without reading. No response deadline is applied at that layer, so a
 * client that reuses a connection sees zero bytes until it gives up. Answering
 * every request immediately keeps that failure from reaching the browser.
 */
const UPSTREAM_DEADLINE_MS = 20_000;

/** A connection per request. A pooled socket can be closed under us. */
const upstreamAgent = new https.Agent({
  keepAlive: false,
  maxSockets: 128,
});

/**
 * Retire this edge's cached TLS certificates while it still runs, so a renewal
 * replaces the file instead of leaving a certificate that expires in place.
 */
function scheduleCertRenewal(hostname) {
  const certPath = path.join(CERT_DIR, "fullchain.pem");
  const readRemaining = () => {
    try {
      const cert = new crypto.X509Certificate(fs.readFileSync(certPath, "utf8"));
      return cert.validToDate.getTime() - Date.now();
    } catch {
      return null;
    }
  };
  const tick = () => {
    const remains = readRemaining();
    if (remains === null) return;
    // Renew at 30 days; retry daily when the renewal window has opened.
    if (remains > 30 * 24 * 60 * 60 * 1000) return;
    void renewCertificate(hostname).catch(() => {});
  };
  const timer = setInterval(tick, 12 * 60 * 60 * 1000);
  timer.unref();
  return timer;
}

async function renewCertificate(hostname) {
  log({ op: "acme.renew.start", host: hostname });
  const material = await issueCertificate(hostname, (token, keyAuthorization) => {
    const dir = path.join(CERT_DIR, ".well-known", "acme-challenge");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, token), keyAuthorization);
  });
  rememberCert(material.certPem, material.keyPem);
  const reload = spawnSync("nginx", ["-s", "reload"], { stdio: ["ignore", "pipe", "pipe"] });
  if (reload.status !== 0) throw new Error("nginx reload failed");
  log({ op: "acme.renewed", host: hostname });
}

export function proxyRequest(req, res, options) {
  // nginx proved the private key during TLS and replaced these from the socket.
  // This process is bound to localhost, so the internet cannot set them.
  const ip = String(req.headers["x-edge-ip"] ?? "").trim();
  const certHeader = toCertificateHeader(req.headers["x-edge-cert"]);
  const host = oneHeader(req, "host");

  // A request that was answered, or that the client walked away from, must not
  // hold an upstream socket or a timer.
  let settled = false;
  const finish = (status, body) => {
    if (settled) return;
    settled = true;
    clearTimeout(deadline);
    if (res.headersSent) {
      res.end();
      return;
    }
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(body);
  };

  const deadline = setTimeout(() => {
    log({ op: "edge.upstream.timeout", path: (req.url || "").split("?")[0], peer: ip });
    finish(504, '{"error":"Gateway timeout"}');
  }, UPSTREAM_DEADLINE_MS);
  deadline.unref();

  const headers = { ...req.headers };
  for (const name of HOP_BY_HOP) delete headers[name];
  delete headers["x-edge-ip"];
  delete headers["x-edge-cert"];
  for (const name of PROXY_OWNED_HEADERS) delete headers[name];
  headers.host = options.backendHost;
  // The backend is addressed as its own hostname, so it has to be told the host
  // the visitor actually asked for. Clerk reads this to build the handshake
  // redirect_url; without it sign-in sends the browser to the App Service
  // hostname, where the edge gate answers 403.
  if (host) headers["x-forwarded-host"] = host;
  headers["x-forwarded-proto"] = "https";
  if (ip) headers["x-forwarded-for"] = ip;

  // Attestation headers. nginx strips every client-supplied copy, so a value
  // here is always this edge's own statement about its TCP peer.
  headers["x-ledger-client-ip"] = ip;
  headers["x-ledger-ip-mac"] = ipAttestationMac(options.secret, ip);
  if (certHeader) {
    headers["x-ledger-client-cert"] = certHeader;
    headers["x-ledger-cert-mac"] = certAttestationMac(options.secret, certHeader);
  }

  const upstream = https.request(
    {
      hostname: options.backendHost,
      port: 443,
      method: req.method,
      path: req.url,
      headers,
      servername: options.backendHost,
      agent: upstreamAgent,
      // Per-socket inactivity deadline, independent of the overall deadline.
      timeout: UPSTREAM_DEADLINE_MS,
    },
    (up) => {
      if (settled) {
        up.destroy();
        return;
      }
      settled = true;
      clearTimeout(deadline);
      const out = { ...up.headers };
      if (typeof out.location === "string") {
        out.location = rewriteLocation(out.location, options.backendOrigin, options.publicOrigin);
      } else if (Array.isArray(out.location)) {
        out.location = out.location.map((item) =>
          rewriteLocation(item, options.backendOrigin, options.publicOrigin),
        );
      }
      // The backend answers in one frame; a chunked reply to a browser that
      // already gave up only leaks a socket.
      out["content-type"] ??= "text/plain; charset=utf-8";
      res.writeHead(up.statusCode ?? 502, out);
      up.pipe(res);
      up.on("error", () => res.destroy());
    },
  );
  upstream.on("timeout", () => {
    upstream.destroy(new Error("backend timeout"));
  });
  upstream.on("error", () => {
    log({ op: "edge.upstream.error", path: (req.url || "").split("?")[0] });
    finish(502, '{"error":"Bad gateway"}');
  });
  res.on("close", () => {
    if (!settled) {
      settled = true;
      clearTimeout(deadline);
      upstream.destroy();
    }
  });
  req.on("aborted", () => upstream.destroy());
  req.pipe(upstream);
  log({
    op: "edge.proxy",
    path: (req.url || "").split("?")[0],
    clientCertPresent: certHeader.length > 0,
    peer: ip,
    forwardedFor: oneHeader(req, "x-forwarded-for"),
    realIp: oneHeader(req, "x-real-ip"),
    forwarded: oneHeader(req, "forwarded"),
  });
}

function requiredEnv(name) {
  const value = process.env[name]?.trim() ?? "";
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

function writePem(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value.endsWith("\n") ? value : `${value}\n`, { mode: 0o644 });
}

function ensureTemporaryCert(hostname) {
  if (fs.existsSync(path.join(CERT_DIR, "fullchain.pem")) && fs.existsSync(path.join(CERT_DIR, "privkey.pem"))) {
    return;
  }
  fs.mkdirSync(CERT_DIR, { recursive: true });
  const result = spawnSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048",
    "-keyout", path.join(CERT_DIR, "privkey.pem"),
    "-out", path.join(CERT_DIR, "fullchain.pem"),
    "-days", "1", "-nodes", "-subj", `/CN=${hostname}`,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) throw new Error("temporary certificate failed");
}

function startNginx() {
  const child = spawn("nginx", ["-g", "daemon off;"], { stdio: "inherit" });
  child.on("exit", (code) => {
    log({ op: "nginx.exit", code: code ?? 0 });
    process.exit(code ?? 1);
  });
  return child;
}

async function main() {
  const hostname = requiredEnv("EDGE_HOSTNAME");
  if (!/^[a-z0-9.-]+$/.test(hostname)) throw new Error("EDGE_HOSTNAME is not a dns name");
  const backendOrigin = requiredEnv("BACKEND_ORIGIN").replace(/\/+$/, "");
  const backendHost = new URL(backendOrigin).hostname;
  const secret = requiredEnv("EDGE_CERT_PROXY_SECRET");
  if (secret.length < 32) throw new Error("EDGE_CERT_PROXY_SECRET is too short");
  const caPem = decodeConfiguredPem(requiredEnv("EDGE_CLIENT_CA_PEM"));
  if (!caPem.includes("BEGIN CERTIFICATE")) throw new Error("EDGE_CLIENT_CA_PEM is not a certificate");
  const publicOrigin = `https://${hostname}`;
  writePem(path.join(CERT_DIR, "ca.crt"), caPem);

  const local = http.createServer((req, res) => {
    // This process listens on loopback only, behind nginx. Its liveness probe is
    // answered here rather than sent to the API: CI and a browser must be able
    // to ask the single public URL whether the edge is up without a certificate
    // or an allowlisted address, and the App Service gate does not exempt
    // /api/healthz any more.
    const pathOnly = (req.url || "").split("?")[0];
    if (pathOnly === "/api/healthz") {
      const body = JSON.stringify({ status: "ok" });
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(body);
      return;
    }
    // /api/readyz is NOT answered here: it travels to the API through the gate,
    // so it proves the edge -> API channel with the edge's own attestation.
    proxyRequest(req, res, { backendHost, backendOrigin, publicOrigin, secret });
  });
  // Node closes an idle connection after 5s by default. nginx holds its
  // upstream connection longer than that and will reuse a socket this process
  // has already closed, writing the next request into a dying socket: the
  // browser then sees zero bytes until it gives up. Keeping this above every
  // keep-alive window on the nginx side removes the race.
  local.keepAliveTimeout = 75_000;
  local.headersTimeout = 90_000;
  local.requestTimeout = 120_000;
  await new Promise((resolve, reject) => {
    local.once("error", reject);
    local.listen(8080, "127.0.0.1", resolve);
  });

  const hadCert = Boolean(storedCertUsable(hostname));
  if (!hadCert) ensureTemporaryCert(hostname);
  startNginx();
  let nginxUp = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const probe = await fetch("http://127.0.0.1/", { redirect: "manual" });
      await probe.body?.cancel();
      nginxUp = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (!nginxUp) throw new Error("nginx did not listen");

  if (!hadCert) {
    log({ op: "acme.start", host: hostname });
    const material = await issueCertificate(hostname, (token, keyAuthorization) => {
      const dir = path.join(CERT_DIR, ".well-known", "acme-challenge");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, token), keyAuthorization);
    });
    rememberCert(material.certPem, material.keyPem);
    const reload = spawnSync("nginx", ["-s", "reload"], { stdio: ["ignore", "pipe", "pipe"] });
    if (reload.status !== 0) throw new Error("nginx reload failed");
    log({ op: "acme.issued", host: hostname });
  } else {
    log({ op: "acme.reused", host: hostname });
  }
  // A 90-day certificate must be replaced before it expires, not after the
  // browser starts refusing the connection.
  scheduleCertRenewal(hostname);
  log({ op: "edge.listen", host: hostname });
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry && fileURLToPath(import.meta.url) === entry) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : "edge failed";
    log({ op: "edge.failed", message: message.slice(0, 240) });
    setTimeout(() => process.exit(1), 10 * 60 * 1000);
  });
}
