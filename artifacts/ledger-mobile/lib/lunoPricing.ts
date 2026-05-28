// Pair-coverage helpers for Luno. Centralized so the crypto tab, the
// dashboard tile, and the history sampler all agree on which pairs to
// quote and how to convert wallet balances into the user's display
// currency.
//
// Luno's pair universe is region-shaped: ZAR users get direct
// {crypto}ZAR pairs for everything. USD users go via {crypto}USDC
// since Luno doesn't price most assets directly in USD.

type Currency = string;

/** Wire asset → user-facing symbol. Luno calls Bitcoin XBT. */
export function displayAsset(asset: string): string {
  return asset.toUpperCase() === "XBT" ? "BTC" : asset.toUpperCase();
}

/**
 * Cash assets we treat as 1:1 with a display currency (no ticker
 * needed). XBT/ETH etc are NOT cash. USDC/USDT are stable-USD; we
 * count them at face value when the user is viewing USD.
 */
function isCash(asset: string, currency: Currency): boolean {
  const a = asset.toUpperCase();
  if (a === currency.toUpperCase()) return true;
  if (currency === "USD" && (a === "USDC" || a === "USDT")) return true;
  return false;
}

/**
 * Return the canonical Luno pair to price `asset` against `currency`,
 * or null if no sensible quote exists.
 *
 * - ZAR: direct `{asset}ZAR` (e.g. XBTZAR, ETHZAR, SOLZAR).
 * - USD: via `{asset}USDC` since Luno lists USDC, not USD.
 *   USDC/USDT themselves return null (they're cash, handled above).
 */
function pairFor(asset: string, currency: Currency): string | null {
  const a = asset.toUpperCase();
  const c = currency.toUpperCase();
  if (c === "ZAR") return `${a}ZAR`;
  if (c === "USD") {
    if (a === "USDC" || a === "USDT") return null;
    return `${a}USDC`;
  }
  return `${a}${c}`;
}

/**
 * For pairs Luno only lists in the opposite direction. Today the
 * meaningful case is converting ZAR cash to a USD-anchored display:
 * Luno has no `ZARUSDC` pair, but `USDCZAR` exists, and 1 ZAR ≈
 * 1 / USDCZAR.lastTrade USDC ≈ same in USD.
 *
 * Returned tuple is `(pair, kind)` where `kind` tells the caller how
 * to combine the price with the wallet balance.
 */
function inversePairFor(
  asset: string,
  currency: Currency,
): { pair: string } | null {
  const a = asset.toUpperCase();
  const c = currency.toUpperCase();
  if (c === "USD" && a === "ZAR") return { pair: "USDCZAR" };
  return null;
}

/**
 * Same as `pairsForAssets` but also includes inverse pairs needed for
 * the rare-but-real cases above (ZAR cash in USD view, etc.). The
 * server endpoint silently drops any pair it can't fetch.
 */
export function pairsForAssets(
  assets: string[],
  currency: Currency,
): string[] {
  const set = new Set<string>();
  for (const raw of assets) {
    const asset = raw.toUpperCase();
    if (isCash(asset, currency)) continue;
    const direct = pairFor(asset, currency);
    if (direct) set.add(direct);
    const inverse = inversePairFor(asset, currency);
    if (inverse) set.add(inverse.pair);
  }
  return Array.from(set);
}

/**
 * Quote a single asset/balance pair in the display currency using a
 * pre-fetched ticker map (pair → lastTrade). Returns 0 if we have no
 * way to price it (unknown pair / no ticker landed). Cash assets pass
 * straight through. Falls back to inverse pairs (1 / lastTrade) for
 * cases like ZAR-cash → USD via USDCZAR.
 */
export function quoteWalletInFiat(
  asset: string,
  balance: number,
  tickers: Map<string, number>,
  currency: Currency,
): number {
  if (balance <= 0) return 0;
  const a = asset.toUpperCase();
  if (isCash(a, currency)) return balance;
  const direct = pairFor(a, currency);
  if (direct) {
    const px = tickers.get(direct) ?? 0;
    if (px > 0) return balance * px;
  }
  const inverse = inversePairFor(a, currency);
  if (inverse) {
    const px = tickers.get(inverse.pair) ?? 0;
    if (px > 0) return balance / px;
  }
  return 0;
}
