/**
 * Format a number with a regular space as the thousands separator and a dot
 * as the decimal point — e.g. 1315000 → "1 315 000", 1234.5 → "1 234.50".
 * We do the grouping by hand instead of relying on a locale: Hermes' Intl is
 * inconsistent across iOS versions and some locales emit a narrow no-break
 * space that renders oddly. A plain space is predictable everywhere.
 */
function groupWithSpaces(value: number, dp: number): string {
  const sign = value < 0 ? "-" : "";
  const fixed = Math.abs(value).toFixed(dp);
  const [intPart, frac] = fixed.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${sign}${grouped}${frac ? `.${frac}` : ""}`;
}

export function fmtUsd(
  value: number,
  opts: { compact?: boolean; whole?: boolean } = {},
): string {
  if (opts.compact && Math.abs(value) >= 1000) {
    return `$${(value / 1000).toFixed(1)}k`;
  }
  const dp = opts.whole ? 0 : 2;
  return `$${groupWithSpaces(value, dp)}`;
}

export function fmtPct(value: number, dp = 1): string {
  return `${value.toFixed(dp)}%`;
}

export function fmtQty(value: number, asset: string): string {
  const dp = asset === "BTC" ? 4 : asset === "ETH" ? 3 : 2;
  return `${value.toFixed(dp)} ${asset}`;
}

export function fmtAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export const USD_TO_ZAR = 18.5;

export function fmtMoney(
  usd: number,
  currency: "USD" | "ZAR",
  opts: { compact?: boolean; whole?: boolean } = {},
): string {
  if (currency === "USD") return fmtUsd(usd, opts);
  const zar = usd * USD_TO_ZAR;
  if (opts.compact && Math.abs(zar) >= 1000) {
    return `R${(zar / 1000).toFixed(1)}k`;
  }
  const dp = opts.whole ? 0 : 2;
  return `R${groupWithSpaces(zar, dp)}`;
}

/**
 * Compact value formatter for the strategy calculator: K (thousand),
 * M (million), B (billion). Keeps one decimal place where it carries
 * signal (e.g. 1.2M) and drops it for clean magnitudes (e.g. 100K).
 * Honours the active display currency for the symbol + ZAR conversion.
 */
export function fmtCompactMoney(
  usd: number,
  currency: "USD" | "ZAR",
): string {
  const symbol = currency === "USD" ? "$" : "R";
  const value = currency === "USD" ? usd : usd * USD_TO_ZAR;
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const fmt = (n: number, suffix: string) => {
    // One decimal only when it adds information (not a whole magnitude).
    const rounded = Math.round(n * 10) / 10;
    const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    return `${sign}${symbol}${text}${suffix}`;
  };
  if (abs >= 1_000_000_000) return fmt(abs / 1_000_000_000, "B");
  if (abs >= 1_000_000) return fmt(abs / 1_000_000, "M");
  if (abs >= 1_000) return fmt(abs / 1_000, "K");
  return `${sign}${symbol}${groupWithSpaces(Math.round(abs), 0)}`;
}
