/**
 * Accepts both comma and dot as a decimal mark and keeps the value as a
 * decimal string. A number conversion happens only when a caller asks for it,
 * so a long fractional quantity is not rounded through binary floating point
 * before it is stored.
 *
 * One separator means a decimal mark: "16,50" and "16.50" are the same value.
 * A repeated separator with no other mark is a thousands separator:
 * "1,234,567" and "1.234.567". When both marks appear, the rightmost is the
 * decimal mark and the other is thousands: "1,234.56" and "1.234,56".
 * Spaces are thousands separators.
 */

const SPACE = /[\s\u00A0\u202F]/g;

export function normalizeDecimalInput(raw: string): string | null {
  const compact = raw.trim().replace(SPACE, "");
  if (compact === "") return null;
  const match = /^(-?)([.,]?\d[\d.,]*)$/.exec(compact);
  if (!match) return null;
  const sign = match[1] ?? "";
  const body = match[2] ?? "";
  const lastComma = body.lastIndexOf(",");
  const lastDot = body.lastIndexOf(".");
  let canonical: string;

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalAt = Math.max(lastComma, lastDot);
    const decimalChar = body[decimalAt];
    const thousandsChar = decimalChar === "," ? "." : ",";
    const intPart = body.slice(0, decimalAt).split(thousandsChar).join("");
    const frac = body.slice(decimalAt + 1);
    if (!/^\d+$/.test(intPart) || !/^\d+$/.test(frac)) return null;
    if (intPart.includes(",") || intPart.includes(".")) return null;
    canonical = `${intPart}.${frac}`;
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? "," : ".";
    const parts = body.split(sep);
    if (parts.length === 2) {
      const whole = parts[0] === "" ? "0" : parts[0];
      const frac = parts[1];
      if (!frac || !/^\d+$/.test(whole) || !/^\d+$/.test(frac)) return null;
      canonical = `${whole}.${frac}`;
    } else {
      const [head, ...groups] = parts;
      if (!head || !/^\d+$/.test(head)) return null;
      if (groups.some((group) => !/^\d{3}$/.test(group))) return null;
      canonical = parts.join("");
    }
  } else if (!/^\d+$/.test(body)) {
    return null;
  } else {
    canonical = body;
  }

  if (!/^\d+(\.\d+)?$/.test(canonical)) return null;
  return `${sign}${canonical}`;
}

export function parseDecimalInput(raw: string): number | null {
  const canonical = normalizeDecimalInput(raw);
  if (canonical == null) return null;
  const value = Number(canonical);
  return Number.isFinite(value) ? value : null;
}
