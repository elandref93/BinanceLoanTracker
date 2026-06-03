// Validation helpers + thin re-exports for Luno credentials.
//
// Storage lives in `accountStore` (per-container `ExchangeLink` of exchange:
// "luno"). Use `getLunoLinks()` from there to flatten for the header builder.

import { reportMessage } from "@/lib/crashReporting";

export function validateLunoKeyId(keyId: string): string | null {
  const trimmed = keyId.trim();
  let reason: string | null = null;
  let msg: string | null = null;
  if (!trimmed) {
    reason = "empty";
    msg = "Key ID is required";
  } else if (trimmed.length < 8) {
    // Luno key_ids are 13 lowercase alphanumeric chars in practice, but we
    // accept the broader set so future format changes don't lock users out.
    reason = "too-short";
    msg = "Key ID looks too short";
  } else if (!/^[a-z0-9]+$/i.test(trimmed)) {
    reason = "bad-charset";
    msg = "Key ID must be letters and numbers only";
  }
  if (msg) {
    reportMessage("[luno] key id validation failed", {
      op: "luno.validateKeyId",
      reason,
      keyLen: trimmed.length,
    });
  }
  return msg;
}

export function validateLunoKeySecret(keySecret: string): string | null {
  const trimmed = keySecret.trim();
  let reason: string | null = null;
  let msg: string | null = null;
  if (!trimmed) {
    reason = "empty";
    msg = "Key secret is required";
  } else if (trimmed.length < 16) {
    reason = "too-short";
    msg = "Key secret looks too short";
  } else if (!/^[A-Za-z0-9+/=_-]+$/.test(trimmed)) {
    // Luno secrets are base64-ish — allow + / = alongside alnum.
    reason = "bad-charset";
    msg = "Key secret has unexpected characters";
  }
  if (msg) {
    reportMessage("[luno] key secret validation failed", {
      op: "luno.validateKeySecret",
      reason,
      keyLen: trimmed.length,
    });
  }
  return msg;
}
