import type { ExchangeKind } from "./accountModel";

export function validateBinanceKey(apiKey: string): string | null {
  const trimmed = apiKey.trim();
  if (!trimmed) return "API key is required";
  if (trimmed.length < 16) return "API key looks too short";
  if (!/^[A-Za-z0-9]+$/.test(trimmed)) return "API key must be letters and numbers only";
  return null;
}

export function validateBinanceSecret(apiSecret: string): string | null {
  const trimmed = apiSecret.trim();
  if (!trimmed) return "API secret is required";
  if (trimmed.length < 16) return "API secret looks too short";
  if (!/^[A-Za-z0-9]+$/.test(trimmed)) return "API secret must be letters and numbers only";
  return null;
}

export function validateLunoKeyId(keyId: string): string | null {
  const trimmed = keyId.trim();
  if (!trimmed) return "Key ID is required";
  if (trimmed.length < 8) return "Key ID looks too short";
  if (!/^[a-z0-9]+$/i.test(trimmed)) return "Key ID must be letters and numbers only";
  return null;
}

export function validateLunoKeySecret(keySecret: string): string | null {
  const trimmed = keySecret.trim();
  if (!trimmed) return "Key secret is required";
  if (trimmed.length < 16) return "Key secret looks too short";
  if (!/^[A-Za-z0-9+/=_-]+$/.test(trimmed)) return "Key secret has unexpected characters";
  return null;
}

export function validateExchangeCredentials(
  exchange: ExchangeKind,
  apiKey: string,
  apiSecret: string,
): string | null {
  if (exchange === "binance") {
    return validateBinanceKey(apiKey) ?? validateBinanceSecret(apiSecret);
  }
  return validateLunoKeyId(apiKey) ?? validateLunoKeySecret(apiSecret);
}
