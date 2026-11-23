import { X509Certificate } from "node:crypto";
import type { Request } from "express";

/** Networks that may open Ledger without a device certificate. */
export const DEFAULT_ALLOWED_CLIENT_IPS = ["102.65.11.235", "102.36.24.176"] as const;

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

export function normalizeIp(value: string): string {
  return value.trim().replace(/^::ffff:/i, "").toLowerCase();
}

export function isAllowedClientIp(ip: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const normalized = normalizeIp(ip);
  if (normalized.length === 0) return false;
  return allowedClientIps(env).includes(normalized);
}

export function revokedCertSerials(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(
    (env.EDGE_REVOKED_CERT_SERIALS ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase().replace(/:/g, ""))
      .filter((item) => item.length > 0),
  );
}

/**
 * True when the platform-forwarded client certificate chains to our CA.
 * The header is trusted only on Azure, or when EDGE_TRUST_CLIENT_CERT=1,
 * because a client can otherwise send the header itself.
 */
export function clientCertificateAllowed(req: Request, env: NodeJS.ProcessEnv = process.env): boolean {
  const trustHeader = env.EDGE_TRUST_CLIENT_CERT === "1" || Boolean(env.WEBSITE_SITE_NAME?.trim());
  if (!trustHeader) return false;
  const caPem = env.EDGE_CLIENT_CA_PEM?.trim() ?? "";
  if (caPem.length === 0) return false;
  const header = req.header("x-arr-clientcert");
  if (!header) return false;
  try {
    const cert = new X509Certificate(Buffer.from(header, "base64"));
    const ca = new X509Certificate(caPem);
    if (cert.validTo && Date.parse(cert.validTo) <= Date.now()) return false;
    if (!cert.verify(ca.publicKey)) return false;
    const serial = cert.serialNumber.toLowerCase().replace(/:/g, "");
    return !revokedCertSerials(env).has(serial);
  } catch {
    return false;
  }
}

export function requestMayPassEdge(req: Request, env: NodeJS.ProcessEnv = process.env): boolean {
  const ip = normalizeIp(req.ip ?? req.socket.remoteAddress ?? "");
  return isAllowedClientIp(ip, env) || clientCertificateAllowed(req, env);
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
