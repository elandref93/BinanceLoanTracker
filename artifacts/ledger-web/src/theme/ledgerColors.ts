/**
 * Dark Ledger palette as named design tokens. index.css must repeat these hex
 * values so Tailwind can emit utilities; a test keeps the two in step.
 *
 * Three palettes never mix: cyan is only for things you can tap, gain/loss
 * colours are only for money movement, risk colours are only for LTV bands,
 * and asset colours are only for allocation.
 */
export const ledgerColors = {
  text: "#E6F1F7",
  tint: "#00F0FF",
  background: "#06090C",
  foreground: "#E6F1F7",
  card: "#0E141A",
  cardElevated: "#131B23",
  cardForeground: "#E6F1F7",
  primary: "#00F0FF",
  primaryForeground: "#06090C",
  secondary: "#131B23",
  secondaryForeground: "#E6F1F7",
  muted: "#0E141A",
  mutedForeground: "#8A9BA8",
  subtle: "#5B6B77",
  accent: "#00F0FF",
  accentForeground: "#06090C",
  destructive: "#FF4D6D",
  destructiveForeground: "#FFFFFF",
  ok: "#1FB6A6",
  warn: "#F5A524",
  danger: "#FF4D6D",
  gain: "#22C55E",
  loss: "#F43F5E",
  border: "#1B242C",
  borderStrong: "#26323C",
  input: "#1B242C",
  radiusPx: 14,
} as const;

/** Allocation colours. Deliberately distinct from the risk and gain/loss hues. */
export const assetPalette = [
  "#00C2FF",
  "#7C6AEF",
  "#3B82F6",
  "#EC4899",
  "#A3E635",
  "#F59E0B",
  "#14B8A6",
  "#E879F9",
] as const;

/** Brand colours for well-known assets so BTC is always orange-ish and so on. */
const KNOWN_ASSET_COLORS: Record<string, string> = {
  BTC: "#F7931A",
  ETH: "#8C8CF7",
  USDT: "#26A17B",
  USDC: "#2775CA",
  BNB: "#F3BA2F",
  SOL: "#9945FF",
  XRP: "#9AA4AD",
  ZAR: "#007749",
  USD: "#5B8C5A",
};

export function assetColor(asset: string, index = 0): string {
  const symbol = asset.toUpperCase() === "XBT" ? "BTC" : asset.toUpperCase();
  return KNOWN_ASSET_COLORS[symbol] ?? assetPalette[index % assetPalette.length] ?? assetPalette[0];
}
