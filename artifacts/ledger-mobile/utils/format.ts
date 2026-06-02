/**
 * Format a number with a regular space as the thousands separator and a dot
 * as the decimal point — e.g. 1315000 → "1 315 000", 1234.5 → "1 234.50".
 * We do the grouping by hand instead of relying on a locale: Hermes' Intl is
 * inconsistent across iOS versions and some locales emit a narrow no-break
 * space that renders oddly. A plain space is predictable everywhere.
 */
// Guards every formatter against non-finite input (NaN / Infinity / undefined).
// Bad numbers reach here from divide-by-zero risk math or a transiently missing
// API field; without this they render as "NaN" / "$Infinity" or, worse, crash
// the screen via `undefined.toFixed`. Formatters return "—" for invalid values.
function isFiniteNum(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function groupWithSpaces(value: number, dp: number): string {
  if (!isFiniteNum(value)) value = 0;
  const sign = value < 0 ? "-" : "";
  const fixed = Math.abs(value).toFixed(dp);
  const [intPart, frac] = fixed.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${sign}${grouped}${frac ? `.${frac}` : ""}`;
}

export function fmtUsd(
  value: number,
  // `compact` is accepted for call-site compatibility but intentionally
  // ignored — values are always shown in full (no "k"/"M" abbreviation).
  opts: { compact?: boolean; whole?: boolean } = {},
): string {
  if (!isFiniteNum(value)) return "—";
  const dp = opts.whole ? 0 : 2;
  return `$${groupWithSpaces(value, dp)}`;
}

export function fmtPct(value: number, dp = 1): string {
  if (!isFiniteNum(value)) return "—";
  return `${value.toFixed(dp)}%`;
}

export function fmtQty(value: number, asset: string): string {
  if (!isFiniteNum(value)) return `— ${asset}`;
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

// Live USD→ZAR rate. Defaults to a sane fallback and is updated at runtime by
// lib/fxRate.ts from the current exchange rate (and remembered across launches).
let usdToZar = 18.5;

export function getUsdToZar(): number {
  return usdToZar;
}

export function setUsdToZar(rate: number): void {
  if (Number.isFinite(rate) && rate > 0) usdToZar = rate;
}

export function fmtMoney(
  usd: number,
  currency: "USD" | "ZAR",
  // `compact` accepted for compatibility but ignored — full numbers only.
  opts: { compact?: boolean; whole?: boolean } = {},
): string {
  if (!isFiniteNum(usd)) return "—";
  if (currency === "USD") return fmtUsd(usd, opts);
  const zar = usd * usdToZar;
  const dp = opts.whole ? 0 : 2;
  return `R${groupWithSpaces(zar, dp)}`;
}
