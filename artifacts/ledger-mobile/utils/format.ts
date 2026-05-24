export function fmtUsd(value: number, opts: { compact?: boolean } = {}): string {
  if (opts.compact && Math.abs(value) >= 1000) {
    return `$${(value / 1000).toFixed(1)}k`;
  }
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
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
  opts: { compact?: boolean } = {},
): string {
  if (currency === "USD") return fmtUsd(usd, opts);
  const zar = usd * USD_TO_ZAR;
  if (opts.compact && Math.abs(zar) >= 1000) {
    return `R${(zar / 1000).toFixed(1)}k`;
  }
  return `R${zar.toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
