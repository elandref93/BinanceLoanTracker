/**
 * en-ZA number and date formatting.
 * Thousands are grouped with a no-break space so an amount never wraps across
 * lines, decimals use a comma, and negatives use the minus sign (U+2212).
 * Dates are pinned to Africa/Johannesburg on a 24-hour clock.
 */

export const JOHANNESBURG_TIME_ZONE = "Africa/Johannesburg";
export const NBSP = "\u00A0";
export const MINUS = "\u2212";

function isFiniteNum(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function groupWithSpaces(value: number, dp: number): string {
  if (!isFiniteNum(value)) value = 0;
  const fixed = Math.abs(value).toFixed(dp);
  const negative = value < 0 && Number(fixed) !== 0;
  const [intPart, frac] = fixed.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${negative ? MINUS : ""}${grouped}${frac ? `,${frac}` : ""}`;
}

/** Plain number with en-ZA grouping. Invalid input renders as a dash. */
export function fmtNum(value: number, dp = 2): string {
  if (!isFiniteNum(value)) return "—";
  return groupWithSpaces(value, dp);
}

export function fmtUsd(
  value: number,
  opts: { compact?: boolean; whole?: boolean } = {},
): string {
  if (!isFiniteNum(value)) return "—";
  if (opts.compact) return fmtCompact(value, "$");
  const dp = opts.whole ? 0 : 2;
  return withSymbol("$", value, dp);
}

export function fmtPct(value: number, dp = 1): string {
  if (!isFiniteNum(value)) return "—";
  return `${groupWithSpaces(value, dp)}%`;
}

/** "+1,6%" or "−1,6%". Zero renders without a sign. */
export function fmtSignedPct(value: number, dp = 1): string {
  if (!isFiniteNum(value)) return "—";
  const body = groupWithSpaces(Math.abs(value), dp);
  if (Number(Math.abs(value).toFixed(dp)) === 0) return `${body}%`;
  return `${value > 0 ? "+" : MINUS}${body}%`;
}

export function qtyDecimals(asset: string): number {
  const symbol = asset.toUpperCase();
  if (symbol === "BTC" || symbol === "XBT") return 4;
  if (symbol === "ETH") return 3;
  return 2;
}

export function fmtQty(value: number, asset: string): string {
  if (!isFiniteNum(value)) return `—${NBSP}${asset}`;
  return `${groupWithSpaces(value, qtyDecimals(asset))}${NBSP}${asset}`;
}

export function fmtAge(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const ms = now - then;
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

let usdToZar = 18.5;

export function getUsdToZar(): number {
  return usdToZar;
}

export function setUsdToZar(rate: number): void {
  if (Number.isFinite(rate) && rate > 0) usdToZar = rate;
}

function withSymbol(symbol: string, value: number, dp: number): string {
  const body = groupWithSpaces(value, dp);
  return body.startsWith(MINUS) ? `${MINUS}${symbol}${body.slice(1)}` : `${symbol}${body}`;
}

/**
 * Short form for summaries: R412,3 k, R1,32 m, R2,40 bn. Amounts under
 * 100 000 stay whole so small balances keep their precision.
 */
export function fmtCompact(value: number, symbol: string): string {
  if (!isFiniteNum(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? MINUS : "";
  if (abs < 100_000) return withSymbol(symbol, value, 0);
  if (abs < 1_000_000) return `${sign}${symbol}${groupWithSpaces(abs / 1_000, 1)}${NBSP}k`;
  if (abs < 1_000_000_000) {
    const m = abs / 1_000_000;
    return `${sign}${symbol}${groupWithSpaces(m, m < 10 ? 2 : 1)}${NBSP}m`;
  }
  return `${sign}${symbol}${groupWithSpaces(abs / 1_000_000_000, 2)}${NBSP}bn`;
}

export function fmtMoney(
  usd: number,
  currency: "USD" | "ZAR",
  opts: { compact?: boolean; whole?: boolean } = {},
): string {
  if (!isFiniteNum(usd)) return "—";
  if (currency === "USD") return fmtUsd(usd, opts);
  const zar = usd * usdToZar;
  if (opts.compact) return fmtCompact(zar, "R");
  return withSymbol("R", zar, opts.whole ? 0 : 2);
}

export function fmtDisplayMoney(
  value: number,
  currency: "USD" | "ZAR",
  opts: { whole?: boolean; compact?: boolean } = {},
): string {
  if (!isFiniteNum(value)) return "—";
  const symbol = currency === "USD" ? "$" : "R";
  if (opts.compact) return fmtCompact(value, symbol);
  return withSymbol(symbol, value, opts.whole ? 0 : 2);
}

/** "+R38 210" or "−R12 400". Zero renders without a sign. */
export function fmtSignedMoney(
  value: number,
  currency: "USD" | "ZAR",
  opts: { whole?: boolean; compact?: boolean } = {},
): string {
  if (!isFiniteNum(value)) return "—";
  const body = fmtDisplayMoney(Math.abs(value), currency, opts);
  const dp = opts.whole || opts.compact ? 0 : 2;
  if (Number(Math.abs(value).toFixed(dp)) === 0) return body;
  return `${value > 0 ? "+" : MINUS}${body}`;
}

function johannesburgParts(
  value: Date | string | number,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormatPart[] | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-ZA", {
    ...options,
    timeZone: JOHANNESBURG_TIME_ZONE,
  }).formatToParts(date);
}

function formatParts(parts: Intl.DateTimeFormatPart[]): string {
  return parts.map((part) => part.value).join("");
}

/** Calendar date in Africa/Johannesburg, for example "10 Oct 2026". */
export function fmtDate(value: Date | string | number): string {
  const parts = johannesburgParts(value, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  return parts ? formatParts(parts) : "—";
}

/** Short day label, for example "10 Oct". */
export function fmtDayMonth(value: Date | string | number): string {
  const parts = johannesburgParts(value, { month: "short", day: "numeric" });
  return parts ? formatParts(parts) : "—";
}

/** 24-hour time in Africa/Johannesburg, for example "08:15". */
export function fmtTime(value: Date | string | number): string {
  const parts = johannesburgParts(value, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return parts ? formatParts(parts) : "—";
}

/** Date and 24-hour time in Africa/Johannesburg. */
export function fmtDateTime(value: Date | string | number): string {
  const parts = johannesburgParts(value, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return parts ? formatParts(parts) : "—";
}
