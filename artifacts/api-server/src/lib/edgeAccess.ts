import { createHmac, timingSafeEqual, X509Certificate } from "node:crypto";
import type { Request } from "express";

/** Networks that may open Ledger without a device certificate. */
export const DEFAULT_ALLOWED_CLIENT_IPS = ["102.65.11.235", "102.36.24.176"] as const;

/** Headers set by our TLS proxy. The MAC is what makes them trustworthy. */
export const LEDGER_CLIENT_CERT_HEADER = "x-ledger-client-cert";
export const LEDGER_CLIENT_IP_HEADER = "x-ledger-client-ip";
export const LEDGER_CERT_MAC_HEADER = "x-ledger-cert-mac";

const CERT_HEADER_MAX = 20_000;
const PROXY_SECRET_MIN = 32;

export function edgeGateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.EDGE_ACCESS_GATE?.trim().toLowerCase();
  if (flag === "on") return true;
  if (flag === "off") return false;
  return env.NODE_ENV === "production";
}

export function allowedClientIps(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.ALLOWED_CLIENT_IPS;
  const source = raw === undefined ? DEFAULT_ALLOWED_CLIENT_IPS.join(",") : raw;
  return source
    .split(",")
    .map((item) => normalizeIp(item))
    .filter((item) => item.length > 0);
}

/**
 * Azure App Service sends one X-Forwarded-For hop as `address:port`.
 * The port is the client's ephemeral source port, so it has to come off
 * before the allowlist comparison. Bracketed IPv6 keeps its colons.
 */
export function normalizeIp(value: string): string {
  let ip = value.trim();
  const bracketed = ip.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) {
    ip = bracketed[1] ?? "";
  }
  ip = ip.replace(/^::ffff:/i, "");
  const v4WithPort = ip.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (v4WithPort) {
    ip = v4WithPort[1] ?? "";
  }
  return ip.toLowerCase();
}

export function isAllowedClientIp(ip: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const normalized = normalizeIp(ip);
  if (normalized.length === 0) return false;
  return allowedClientIps(env).includes(normalized);
}

/** Hex serial, no separators, no leading zeros. */
export function normalizeSerial(serial: string): string {
  const hex = serial.toLowerCase().replace(/[^0-9a-f]/g, "").replace(/^0+/, "");
  return hex.length > 0 ? hex : "0";
}

export function revokedCertSerials(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(
    (env.EDGE_REVOKED_CERT_SERIALS ?? "")
      .split(",")
      .map((item) => normalizeSerial(item))
      .filter((item) => item.length > 0 && item !== "0"),
  );
}

/**
 * App settings store the CA as one line with the two characters `\` and `n`
 * between PEM lines. OpenSSL needs real newlines.
 */
export function decodeConfiguredPem(value: string): string {
  return value.trim().replace(/^\uFEFF/, "").replace(/\\n/g, "\n");
}

/**
 * Azure forwards the leaf as base64 DER in X-ARR-ClientCert. A proxy or an
 * older front end may URL-encode that value, turn `+` into a space, or send
 * a PEM. The certificate bytes are not logged by callers.
 */
export function readClientCertificate(header: string): X509Certificate | null {
  if (header.length === 0 || header.length > CERT_HEADER_MAX) return null;
  let value = header.trim();
  if (value.includes("%")) {
    try {
      value = decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  try {
    if (value.includes("-----BEGIN")) {
      return new X509Certificate(decodeConfiguredPem(value));
    }
    const standard = value
      .replace(/ /g, "+")
      .replace(/[\r\n\t]/g, "")
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    return new X509Certificate(Buffer.from(standard, "base64"));
  } catch {
    return null;
  }
}

export function certificateIsTrusted(
  cert: X509Certificate,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  try {
    const caPem = decodeConfiguredPem(env.EDGE_CLIENT_CA_PEM ?? "");
    if (!caPem.includes("BEGIN CERTIFICATE")) return false;
    const ca = new X509Certificate(caPem);
    const now = Date.now();
    if (cert.validFromDate.getTime() > now) return false;
    if (cert.validToDate.getTime() <= now) return false;
    if (!cert.verify(ca.publicKey)) return false;
    return !revokedCertSerials(env).has(normalizeSerial(cert.serialNumber));
  } catch {
    return false;
  }
}

/** Same bytes the TLS proxy signs. Empty cert header means no certificate. */
export function attestationMac(secret: string, ip: string, certHeader: string): string {
  return createHmac("sha256", secret).update(`${ip}\n${certHeader}`, "utf8").digest("hex");
}

function headerText(req: Request, name: string): string {
  const value = req.header(name);
  if (Array.isArray(value)) return value[0] ?? "";
  return value?.trim() ?? "";
}

function macMatches(secret: string, ip: string, certHeader: string, presented: string): boolean {
  const expected = attestationMac(secret, ip, certHeader);
  const left = Buffer.from(expected);
  const right = Buffer.from(presented.trim().toLowerCase());
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * The TLS proxy saw this TCP peer and, when present, this client certificate.
 * Azure's front end replaces X-Forwarded-For with the proxy address, so the
 * phone address has to travel in the signed header instead.
 */
function readAttestation(
  req: Request,
  env: NodeJS.ProcessEnv,
): { ip: string; certHeader: string } | null {
  const secret = env.EDGE_CERT_PROXY_SECRET ?? "";
  if (secret.length < PROXY_SECRET_MIN) return null;
  const ip = headerText(req, LEDGER_CLIENT_IP_HEADER);
  const mac = headerText(req, LEDGER_CERT_MAC_HEADER);
  if (!ip || !mac || ip.length > 128 || mac.length > 128) return null;
  if (ip.includes("\n") || ip.includes("\r")) return null;
  const certHeader = headerText(req, LEDGER_CLIENT_CERT_HEADER);
  if (certHeader.length > CERT_HEADER_MAX) return null;
  if (!macMatches(secret, ip, certHeader, mac)) return null;
  return { ip, certHeader };
}

function platformTrustsClientCert(env: NodeJS.ProcessEnv): boolean {
  return env.EDGE_TRUST_CLIENT_CERT === "1" || Boolean(env.WEBSITE_SITE_NAME?.trim());
}

/**
 * Production and any host that has the proxy secret accept user traffic only
 * from the TLS edge. A matching source address or an Azure client-certificate
 * header is not a second door. Local runs without either setting keep the
 * direct check so tests and dev do not need the proxy.
 */
function attestationRequired(env: NodeJS.ProcessEnv): boolean {
  const secret = env.EDGE_CERT_PROXY_SECRET ?? "";
  return secret.length >= PROXY_SECRET_MIN || platformTrustsClientCert(env);
}

export interface EdgeAccessDecision {
  allowed: boolean;
  ipAllowed: boolean;
  certAllowed: boolean;
  clientCertPresent: boolean;
  /** Address compared with the allowlist, port already removed. */
  clientIp: string;
}

/**
 * ipAllowed and certAllowed are independent. A home address may pass with
 * certAllowed false. A valid device certificate may pass with ipAllowed false.
 * On Azure, or whenever the proxy secret is set, neither fact opens the API
 * unless the edge's MAC is valid. That is what stops the App Service hostname
 * being a second copy of the site.
 */
export function evaluateEdgeAccess(
  req: Request,
  env: NodeJS.ProcessEnv = process.env,
): EdgeAccessDecision {
  const attested = readAttestation(req, env);
  const requireEdge = attestationRequired(env);
  const clientIp = normalizeIp(
    attested?.ip ?? req.ip ?? req.socket?.remoteAddress ?? "",
  );
  const ipAllowed = isAllowedClientIp(clientIp, env);

  let clientCertPresent = false;
  let cert: X509Certificate | null = null;
  if (attested) {
    if (attested.certHeader.length > 0) {
      clientCertPresent = true;
      cert = readClientCertificate(attested.certHeader);
    }
  } else if (!requireEdge) {
    const header = headerText(req, "x-arr-clientcert");
    if (header.length > 0) {
      clientCertPresent = true;
      if (platformTrustsClientCert(env)) cert = readClientCertificate(header);
    }
  } else {
    const header = headerText(req, "x-arr-clientcert");
    if (header.length > 0) clientCertPresent = true;
  }
  const certAllowed = cert ? certificateIsTrusted(cert, env) : false;
  const identityAllowed = ipAllowed || certAllowed;
  return {
    allowed: requireEdge ? attested !== null && identityAllowed : identityAllowed,
    ipAllowed,
    certAllowed,
    clientCertPresent,
    clientIp,
  };
}

/**
 * True when the edge-attested certificate chains to our CA.
 * On Azure the platform certificate header is not a substitute for that
 * attestation. Off Azure, and only when no proxy secret is configured, a
 * platform header is still read so local checks can exercise the parser.
 */
export function clientCertificateAllowed(req: Request, env: NodeJS.ProcessEnv = process.env): boolean {
  return evaluateEdgeAccess(req, env).certAllowed;
}

export function requestMayPassEdge(req: Request, env: NodeJS.ProcessEnv = process.env): boolean {
  return evaluateEdgeAccess(req, env).allowed;
}

/** What the gate compared. Never includes the certificate body. */
export function describeEdgeClient(req: Request): {
  clientIp: string;
  socketIp: string;
  forwardedHops: number;
  forwardedIps: string[];
  clientCertPresent: boolean;
} {
  const header = req.headers["x-forwarded-for"];
  const raw = Array.isArray(header) ? header.join(",") : typeof header === "string" ? header : "";
  const forwardedIps = raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= 64)
    .slice(0, 8);
  const certHeader = req.headers["x-arr-clientcert"];
  const clientCertPresent = Array.isArray(certHeader)
    ? certHeader.some((value) => value.trim().length > 0)
    : typeof certHeader === "string" && certHeader.trim().length > 0;
  return {
    clientIp: normalizeIp(req.ip ?? req.socket?.remoteAddress ?? ""),
    socketIp: normalizeIp(req.socket?.remoteAddress ?? ""),
    forwardedHops: forwardedIps.length,
    forwardedIps,
    clientCertPresent,
  };
}
