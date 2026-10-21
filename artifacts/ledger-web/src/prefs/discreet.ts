/**
 * Ledger-style discreet mode. Amounts become one fixed placeholder so the
 * length of a figure does not give the value away. Labels, names, and dates
 * stay. One hover depth is shared by every figure: entering any of them shows
 * them all, and leaving the last one hides them again.
 */

export const DISCREET_PLACEHOLDER = "••••";
const DISCREET_CACHE_KEY = "ledger-web-discreet";

/**
 * Currency figures and coin quantities. A ticker or currency code must be
 * uppercase, so a date such as "10 Oct" is left alone. Percents stay too.
 */
const AMOUNT_TOKEN =
  /[+\u2212-]?(?:R|\$)\u00A0?\d[\d\u00A0]*(?:,\d+)?(?:\u00A0(?:k|m|bn))?|[+\u2212-]?\d[\d\u00A0]*(?:,\d+)?(?:\u00A0| )[A-Z][A-Z0-9]{1,11}/g;

export type AmountPart = { amount: boolean; text: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Missing or any value other than true stays off, so balances stay visible. */
export function readStoredDiscreet(settings: unknown): boolean {
  return isRecord(settings) && settings.webDiscreet === true;
}

export function readDiscreetCache(): boolean | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(DISCREET_CACHE_KEY);
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    return null;
  }
  return null;
}

export function writeDiscreetCache(on: boolean): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(DISCREET_CACHE_KEY, on ? "1" : "0");
  } catch {
    // Private mode can reject storage. The server copy still persists the toggle.
  }
}

export function splitAmountParts(text: string): AmountPart[] {
  const parts: AmountPart[] = [];
  const pattern = new RegExp(AMOUNT_TOKEN.source, "g");
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ amount: false, text: text.slice(last, index) });
    parts.push({ amount: true, text: match[0] });
    last = index + match[0].length;
  }
  if (last < text.length) parts.push({ amount: false, text: text.slice(last) });
  if (parts.length === 0) parts.push({ amount: false, text });
  return parts;
}

/** Swap amount tokens for the placeholder. Words, dates, and percents stay. */
export function maskAmountsInText(text: string, hidden: boolean): string {
  if (!hidden) return text;
  return splitAmountParts(text)
    .map((part) => (part.amount ? DISCREET_PLACEHOLDER : part.text))
    .join("");
}

/**
 * Entering a figure increments the shared depth; leaving decrements it.
 * A batch that leaves one figure and enters another in the same turn stays revealed.
 */
export function foldHover(events: ReadonlyArray<"enter" | "leave">): boolean {
  let depth = 0;
  for (const event of events) {
    depth = event === "enter" ? depth + 1 : Math.max(0, depth - 1);
  }
  return depth > 0;
}
