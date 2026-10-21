// Ported from the mobile app. Binance API-key QR payloads come in several
// shapes. Accept anything that contains a 64-character key/secret pair.
// The raw text is not logged.

const KEY_RE = /[A-Za-z0-9]{64}/g;

const KEY_ALIASES = ["apikey", "api_key", "key", "accesskey", "access_key"];
const SECRET_ALIASES = [
  "apisecret",
  "api_secret",
  "secret",
  "secretkey",
  "secret_key",
];

export type ParsedQR = {
  apiKey?: string;
  apiSecret?: string;
};

function normaliseKey(k: string): string {
  return k.toLowerCase().replace(/[-_]/g, "");
}

function pickField(
  obj: Record<string, unknown>,
  aliases: string[],
): string | undefined {
  for (const [rawKey, value] of Object.entries(obj)) {
    if (typeof value !== "string") continue;
    const n = normaliseKey(rawKey);
    if (aliases.some((a) => normaliseKey(a) === n)) return value.trim();
  }
  return undefined;
}

export function parseBinanceQR(raw: string): ParsedQR {
  const text = raw.trim();
  if (!text) return {};

  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      const obj = Array.isArray(parsed) ? parsed[0] : parsed;
      if (obj && typeof obj === "object") {
        const apiKey = pickField(obj as Record<string, unknown>, KEY_ALIASES);
        const apiSecret = pickField(
          obj as Record<string, unknown>,
          SECRET_ALIASES,
        );
        if (apiKey || apiSecret) return { apiKey, apiSecret };
      }
    } catch {
      // fall through to other strategies
    }
  }

  try {
    const url = new URL(text);
    const obj: Record<string, string> = {};
    url.searchParams.forEach((v, k) => {
      obj[k] = v;
    });
    if (Object.keys(obj).length > 0) {
      const apiKey = pickField(obj, KEY_ALIASES);
      const apiSecret = pickField(obj, SECRET_ALIASES);
      if (apiKey || apiSecret) return { apiKey, apiSecret };
    }
  } catch {
    // not a URL
  }

  if (text.includes("=") && /[&\n;]/.test(text)) {
    const obj: Record<string, string> = {};
    for (const pair of text.split(/[&\n;]/)) {
      const idx = pair.indexOf("=");
      if (idx > 0) {
        obj[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
      }
    }
    const apiKey = pickField(obj, KEY_ALIASES);
    const apiSecret = pickField(obj, SECRET_ALIASES);
    if (apiKey || apiSecret) return { apiKey, apiSecret };
  }

  const tokens = text.match(KEY_RE) ?? [];
  if (tokens.length >= 2) {
    return { apiKey: tokens[0], apiSecret: tokens[1] };
  }
  if (tokens.length === 1) {
    return { apiKey: tokens[0] };
  }

  return {};
}
