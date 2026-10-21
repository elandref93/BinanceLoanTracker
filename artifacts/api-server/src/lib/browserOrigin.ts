/**
 * Browser origins allowed to call the API with credentials.
 *
 * Production matches `ALLOWED_ORIGINS` exactly. Development and test also
 * accept http(s) origins whose host is loopback or an RFC1918 address, so a
 * phone on the LAN can finish Clerk sign-in through the Vite HTTPS proxy.
 * That proxy forwards the page Origin (`https://192.168.x.x:5173`) even
 * though the browser request itself is same-origin.
 */

const PRIVATE_ORIGIN_ENVS = new Set(["development", "test"]);

export function isPrivateLanHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "::1") return true;
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const octets = match.slice(1).map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet > 255)) return false;
  const [a, b] = octets;
  if (a === 127 || a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

export function isBrowserOriginAllowed(
  origin: string | undefined,
  allowedOrigins: readonly string[],
  nodeEnv: string | undefined,
): boolean {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  if (!nodeEnv || !PRIVATE_ORIGIN_ENVS.has(nodeEnv)) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.username.length > 0 || url.password.length > 0) return false;
  if (url.pathname !== "/" || url.search.length > 0 || url.hash.length > 0) return false;
  return isPrivateLanHostname(url.hostname);
}
