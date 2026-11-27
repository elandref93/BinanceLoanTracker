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
];

export function decodeConfiguredPem(value) {
  return value.trim().replace(/^\uFEFF/, "").replace(/\\n/g, "\n");
}

/** Must match attestationMac in the API. Empty cert means the phone sent none. */
export function attestationMac(secret, ip, certHeader) {
  return crypto.createHmac("sha256", secret).update(`${ip}\n${certHeader}`, "utf8").digest("hex");
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

export function proxyRequest(req, res, options) {
  // nginx proved the private key during TLS and replaced these from the socket.
  // This process is bound to localhost, so the internet cannot set them.
  const ip = String(req.headers["x-edge-ip"] ?? "").trim();
  const certB64 = String(req.headers["x-edge-cert"] ?? "").trim();
  const host = oneHeader(req, "host");
  const headers = { ...req.headers };
  for (const name of HOP_BY_HOP) delete headers[name];
  delete headers["x-ledger-client-cert"];
  delete headers["x-ledger-client-ip"];
  delete headers["x-ledger-cert-mac"];
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
  headers["x-ledger-client-ip"] = ip;
  headers["x-ledger-cert-mac"] = attestationMac(options.secret, ip, certB64);
  if (certB64) headers["x-ledger-client-cert"] = certB64;

  const upstream = https.request(
    {
      hostname: options.backendHost,
      port: 443,
      method: req.method,
      path: req.url,
      headers,
      servername: options.backendHost,
      timeout: 60_000,
    },
    (up) => {
      const out = { ...up.headers };
      if (typeof out.location === "string") {
        out.location = rewriteLocation(out.location, options.backendOrigin, options.publicOrigin);
      } else if (Array.isArray(out.location)) {
        out.location = out.location.map((item) =>
          rewriteLocation(item, options.backendOrigin, options.publicOrigin),
        );
      }
      res.writeHead(up.statusCode ?? 502, out);
      up.pipe(res);
    },
  );
  upstream.on("timeout", () => upstream.destroy(new Error("backend timeout")));
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
    res.end('{"error":"Bad gateway"}');
  });
  req.on("aborted", () => upstream.destroy());
  req.pipe(upstream);
  log({
    op: "edge.proxy",
    path: (req.url || "").split("?")[0],
    clientCertPresent: certB64.length > 0,
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
    proxyRequest(req, res, { backendHost, backendOrigin, publicOrigin, secret });
  });
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
