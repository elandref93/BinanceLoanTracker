import { loadStoredSession } from "@/lib/session";
import {
  buildMarketQuotes,
  buildSnapshot,
  widgetMarketPairs,
  writeWidgetSnapshot,
  type AccountBreakdown,
  type MarketQuotes,
} from "@/lib/widgetSnapshot";

type LoanLite = {
  asset: string;
  debtUsd: number;
};

/**
 * Fetch Luno tickers for widget market rows. Public market data but routed
 * through our API; session token is sent when available.
 */
export async function fetchLunoTickers(
  domain: string,
  pairs: string[],
  sessionToken?: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (pairs.length === 0) return map;
  try {
    const headers: Record<string, string> = {};
    if (sessionToken) {
      headers.authorization = `Bearer ${sessionToken}`;
    }
    const res = await fetch(
      `https://${domain}/api/luno/tickers?pairs=${encodeURIComponent(pairs.join(","))}`,
      { headers },
    );
    if (!res.ok) return map;
    const body = (await res.json()) as {
      tickers?: { pair: string; lastTrade: number }[];
    };
    for (const t of body.tickers ?? []) {
      map.set(t.pair, t.lastTrade);
    }
  } catch {
    // Best-effort: widgets keep last-known market quotes.
  }
  return map;
}

/**
 * Build market quotes for a widget snapshot, preserving the previous quotes
 * when the ticker fetch fails or returns partial data.
 */
export function mergeMarketQuotes(
  loans: LoanLite[],
  tickers: Map<string, number>,
  previous: MarketQuotes | null,
): MarketQuotes {
  const fresh = buildMarketQuotes(loans, tickers);
  if (!previous) return fresh;
  return {
    btcUsd: fresh.btcUsd ?? previous.btcUsd,
    btcZar: fresh.btcZar ?? previous.btcZar,
    lendAsset: fresh.lendAsset ?? previous.lendAsset,
    lendAssetZar: fresh.lendAssetZar ?? previous.lendAssetZar,
  };
}

export async function publishWidgetSnapshot(
  loans: Parameters<typeof buildSnapshot>[0],
  targetLtv: number,
  accounts: AccountBreakdown[],
  options: {
    domain: string;
    sessionToken?: string;
    previousMarkets?: MarketQuotes | null;
  },
): Promise<void> {
  const pairs = widgetMarketPairs(loans);
  const tickers = await fetchLunoTickers(
    options.domain,
    pairs,
    options.sessionToken,
  );
  const markets = mergeMarketQuotes(
    loans.map((l) => ({ asset: l.asset, debtUsd: l.debtUsd })),
    tickers,
    options.previousMarkets ?? null,
  );
  await writeWidgetSnapshot(
    buildSnapshot(loans, targetLtv, accounts, markets),
  );
}
