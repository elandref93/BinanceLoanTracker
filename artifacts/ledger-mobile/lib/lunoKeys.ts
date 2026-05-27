// Validation helpers + thin re-exports for Luno credentials.
//
// Storage lives in `accountStore` (per-container `ExchangeLink` of exchange:
// "luno"). Use `getLunoLinks()` from there to flatten for the header builder.

export function validateLunoKeyId(keyId: string): string | null {
  const trimmed = keyId.trim();
  if (!trimmed) return "Key ID is required";
  // Luno key_ids are 13 lowercase alphanumeric chars in practice, but we
  // accept the broader set so future format changes don't lock users out.
  if (trimmed.length < 8) return "Key ID looks too short";
  if (!/^[a-z0-9]+$/i.test(trimmed))
    return "Key ID must be letters and numbers only";
  return null;
}

export function validateLunoKeySecret(keySecret: string): string | null {
  const trimmed = keySecret.trim();
  if (!trimmed) return "Key secret is required";
  if (trimmed.length < 16) return "Key secret looks too short";
  // Luno secrets are base64-ish — allow + / = alongside alnum.
  if (!/^[A-Za-z0-9+/=_-]+$/.test(trimmed))
    return "Key secret has unexpected characters";
  return null;
}
