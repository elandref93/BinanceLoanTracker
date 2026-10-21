/**
 * Portfolio totals and collateral grouped by asset.
 * Holdings come only from the saved snapshot total. Collateral comes from the
 * live loan list when it has loans, otherwise from snapshot loans.
 * Wallet balances, spot prices, and pending sends are not invented.
 */

import { fmtDateTime, fmtDisplayMoney, fmtPct, fmtQty, fmtUsd, groupWithSpaces } from "@/domain/format";

export const PORTFOLIO_PAGE_SIZE = 20;

export const PORTFOLIO_LOADING = "Loading the saved snapshot…";
export const PORTFOLIO_SNAPSHOT_ERROR =
  "The snapshot could not be loaded. Holdings are not shown.";
export const PORTFOLIO_MISSING =
  "No LTV snapshot is stored for this session. Holdings, balances, and prices are not shown.";
export const HOLDINGS_ABSENT = "Holdings total is not in this snapshot.";
export const HOLDINGS_SNAPSHOT_MISSING =
  "No LTV snapshot is stored, so the holdings total is not shown.";
export const HOLDINGS_UNFILTERED =
  "The holdings total covers every profile. This snapshot has no per-profile holdings.";
export const WALLET_BALANCES_ABSENT =
  "Exchange wallet balances are not in the snapshot or the loan list.";
export const PENDING_SENDS_ABSENT = "Pending sends are not in the snapshot or the loan list.";
export const SPOT_PRICES_ABSENT = "Spot prices are not in the snapshot or the loan list.";
export const COLLATERAL_FROM_LIVE =
  "Collateral is grouped from the live loan list. It is not a wallet balance.";
export const COLLATERAL_FROM_SNAPSHOT =
  "Collateral is grouped from the saved snapshot. Collateral quantity is not included, so no price is shown.";
export const COLLATERAL_ABSENT = "Loan collateral is not included in this snapshot.";
export const NO_OPEN_LOANS = "No open loans, so there is no collateral to group by asset.";
export const COLLATERAL_UNREADABLE = "Loan collateral in this response could not be read.";
export const FILTER_EMPTY = "No loan collateral for this profile.";
export const RATE_UNAVAILABLE = "Exchange rate is not in this snapshot";
export const QTY_UNAVAILABLE = "Collateral quantity was not returned.";
export const PRICE_UNAVAILABLE =
  "No price is shown. A price needs a collateral quantity, and none was returned.";
export const ASSET_NOT_FOUND = "This asset is not in the loan list or the saved snapshot.";
export const CHART_EMPTY = "There is no allocation chart. No per-asset collateral value was returned.";

const ALLOC_PALETTE = [
  "#00f0ff",
  "#1fb6a6",
  "#f5a524",
  "#8B5CF6",
  "#ff4d6d",
  "#3B82F6",
  "#EC4899",
  "#64748B",
];

export type PortfolioCurrency = "USD" | "ZAR";

export type PositionInput = {
  id: string;
  accountId: string;
  collateralAsset: string;
  collateralValueUsd: number;
  collateralQty: number | null;
};

export type PositionSource = "live" | "snapshot" | "none";

export type ChosenPositions = {
  source: PositionSource;
  positions: PositionInput[];
  dropped: number;
  /** True when a loan array was present, including an empty array. */
  loansListed: boolean;
};

export type AssetPosition = {
  loanId: string;
  accountId: string;
  usd: number;
  qty: number | null;
};

export type AggregatedAsset = {
  symbol: string;
  usd: number;
  /** Sum of quantities when every position returned one. Otherwise null. */
  qty: number | null;
  /** Share of returned collateral value. Null when the total is zero. */
  sharePct: number | null;
  positions: AssetPosition[];
};

export type AssetRow = {
  symbol: string;
  value: string;
  quantity: string;
  share: string;
  loanCount: string;
};

export type ChartSegment = {
  symbol: string;
  pct: number;
  color: string;
};

export type PortfolioView = {
  asOfLabel: string | null;
  holdings: string | null;
  holdingsNote: string | null;
  fxLabel: string | null;
  sourceNote: string | null;
  collateralNote: string | null;
  filterEmptyNote: string | null;
  chartSummary: string;
  chartSegments: ChartSegment[];
  assets: AssetRow[];
  page: number;
  pageCount: number;
  walletNote: string;
  pendingNote: string;
  priceNote: string;
};

export type PortfolioPaint =
  | { kind: "loading"; message: string }
  | { kind: "blocked"; message: string }
  | { kind: "ready"; view: PortfolioView };

export type AssetPositionRow = {
  loanId: string;
  accountLabel: string;
  value: string;
  quantity: string;
  price: string | null;
};

export type AssetDetailView = {
  symbol: string;
  value: string;
  quantity: string;
  quantityNote: string | null;
  price: string | null;
  priceNote: string;
  positions: AssetPositionRow[];
  page: number;
  pageCount: number;
  walletNote: string;
  pendingNote: string;
};

export type AssetDetailResult =
  | { kind: "loading"; message: string }
  | { kind: "blocked"; message: string }
  | { kind: "missing"; message: string }
  | { kind: "asset"; view: AssetDetailView };

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function snapshotFx(value: unknown): number | null {
  return finite(value) && value > 0 ? value : null;
}

/** Luno's wire symbol for Bitcoin is XBT. Other symbols are uppercased as returned. */
export function displayAsset(asset: string): string {
  const symbol = asset.trim().toUpperCase();
  return symbol === "XBT" ? "BTC" : symbol;
}

export function money(usd: number, currency: PortfolioCurrency, fx: number | null): string {
  if (!finite(usd)) return "—";
  if (currency === "USD") return fmtUsd(usd);
  if (fx == null) return RATE_UNAVAILABLE;
  return fmtDisplayMoney(usd * fx, "ZAR");
}

function positiveQty(value: unknown): number | null {
  return finite(value) && value > 0 ? value : null;
}

function readId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function positionFromLive(loan: unknown): PositionInput | null {
  if (typeof loan !== "object" || loan === null) return null;
  const row = loan as Record<string, unknown>;
  const id = readId(row.id);
  const accountId = readId(row.accountId);
  const collateral = row.collateral;
  if (!id || !accountId || typeof collateral !== "object" || collateral === null) return null;
  const col = collateral as Record<string, unknown>;
  const asset = typeof col.asset === "string" ? col.asset : "";
  if (displayAsset(asset).length === 0) return null;
  if (!finite(col.valueUsd) || col.valueUsd < 0) return null;
  return {
    id,
    accountId,
    collateralAsset: asset,
    collateralValueUsd: col.valueUsd,
    collateralQty: positiveQty(col.qty),
  };
}

export function positionFromSnapshot(loan: unknown): PositionInput | null {
  if (typeof loan !== "object" || loan === null) return null;
  const row = loan as Record<string, unknown>;
  const id = readId(row.id);
  const accountId = readId(row.accountId);
  const asset = typeof row.collateralAsset === "string" ? row.collateralAsset : "";
  if (!id || !accountId || displayAsset(asset).length === 0) return null;
  if (!finite(row.collateralValueUsd) || row.collateralValueUsd < 0) return null;
  return {
    id,
    accountId,
    collateralAsset: asset,
    collateralValueUsd: row.collateralValueUsd,
    collateralQty: null,
  };
}

function parseList(
  loans: readonly unknown[],
  read: (loan: unknown) => PositionInput | null,
): { positions: PositionInput[]; dropped: number } {
  const positions: PositionInput[] = [];
  let dropped = 0;
  for (const loan of loans) {
    const position = read(loan);
    if (position) positions.push(position);
    else dropped += 1;
  }
  return { positions, dropped };
}

/**
 * Live loans win when at least one collateral row can be read.
 * An empty live list falls through to snapshot loans.
 * The holdings total is never mixed into these rows.
 */
export function choosePositions(input: {
  liveFailed: boolean;
  liveLoans: readonly unknown[] | null;
  snapshotFailed: boolean;
  snapshotLoans: readonly unknown[] | null;
}): ChosenPositions {
  const live =
    !input.liveFailed && input.liveLoans
      ? parseList(input.liveLoans, positionFromLive)
      : null;
  const snapshot =
    !input.snapshotFailed && input.snapshotLoans
      ? parseList(input.snapshotLoans, positionFromSnapshot)
      : null;

  if (live && live.positions.length > 0) {
    return { source: "live", positions: live.positions, dropped: live.dropped, loansListed: true };
  }
  if (snapshot && snapshot.positions.length > 0) {
    return {
      source: "snapshot",
      positions: snapshot.positions,
      dropped: snapshot.dropped,
      loansListed: true,
    };
  }
  if (live && input.liveLoans && input.liveLoans.length > 0) {
    return { source: "live", positions: [], dropped: live.dropped, loansListed: true };
  }
  if (live) {
    return { source: "live", positions: [], dropped: live.dropped, loansListed: true };
  }
  if (snapshot) {
    return {
      source: "snapshot",
      positions: snapshot.positions,
      dropped: snapshot.dropped,
      loansListed: true,
    };
  }
  return { source: "none", positions: [], dropped: 0, loansListed: false };
}

export function aggregatePositions(
  positions: readonly PositionInput[],
  accountIds: ReadonlySet<string> | null,
): AggregatedAsset[] {
  const filtered =
    accountIds == null ? positions : positions.filter((position) => accountIds.has(position.accountId));
  const grouped = new Map<
    string,
    { usd: number; qty: number; qtyComplete: boolean; positions: AssetPosition[] }
  >();

  for (const position of filtered) {
    const symbol = displayAsset(position.collateralAsset);
    const current = grouped.get(symbol) ?? { usd: 0, qty: 0, qtyComplete: true, positions: [] };
    current.usd += position.collateralValueUsd;
    if (position.collateralQty == null) current.qtyComplete = false;
    else current.qty += position.collateralQty;
    current.positions.push({
      loanId: position.id,
      accountId: position.accountId,
      usd: position.collateralValueUsd,
      qty: position.collateralQty,
    });
    grouped.set(symbol, current);
  }

  const rows: AggregatedAsset[] = [];
  let totalUsd = 0;
  for (const [symbol, group] of grouped) {
    totalUsd += group.usd;
    rows.push({
      symbol,
      usd: group.usd,
      qty: group.qtyComplete ? group.qty : null,
      sharePct: null,
      positions: group.positions,
    });
  }
  rows.sort((left, right) => right.usd - left.usd || left.symbol.localeCompare(right.symbol));
  for (const row of rows) {
    row.sharePct = totalUsd > 0 ? (row.usd / totalUsd) * 100 : null;
  }
  return rows;
}

export function allocColor(index: number): string {
  return ALLOC_PALETTE[index % ALLOC_PALETTE.length] ?? ALLOC_PALETTE[0];
}

export function allocationSummary(assets: readonly AggregatedAsset[]): string {
  const valued = assets.filter((asset) => asset.usd > 0 && asset.sharePct != null);
  if (valued.length === 0) return CHART_EMPTY;
  const parts = valued.map((asset) => `${asset.symbol} ${fmtPct(asset.sharePct ?? 0)}`);
  return `Loan collateral allocation: ${parts.join(", ")}. This is not a wallet balance.`;
}

export function slicePage<T>(items: readonly T[], page: number, pageSize: number): {
  items: T[];
  page: number;
  pageCount: number;
} {
  const size = pageSize > 0 ? Math.floor(pageSize) : 1;
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (current - 1) * size;
  return { items: items.slice(start, start + size), page: current, pageCount };
}

function quantityLabel(qty: number | null, symbol: string): string {
  return qty == null ? QTY_UNAVAILABLE : fmtQty(qty, symbol);
}

function assetRows(assets: readonly AggregatedAsset[], currency: PortfolioCurrency, fx: number | null): AssetRow[] {
  return assets.map((asset) => ({
    symbol: asset.symbol,
    value: money(asset.usd, currency, fx),
    quantity: quantityLabel(asset.qty, asset.symbol),
    share: asset.sharePct == null ? "—" : fmtPct(asset.sharePct),
    loanCount: String(asset.positions.length),
  }));
}

export function portfolioPaint(input: {
  snapshotPending: boolean;
  snapshotFailed: boolean;
  snapshot: {
    asOf?: string;
    holdingsUsd?: number;
    fxUsdToZar?: number;
    loans?: unknown;
  } | null;
  livePending: boolean;
  liveFailed: boolean;
  liveLoans: readonly unknown[] | null;
  currency: PortfolioCurrency;
  filterAccountIds: ReadonlySet<string> | null;
  filterActive: boolean;
  page: number;
  pageSize?: number;
}): PortfolioPaint {
  if (input.livePending || input.snapshotPending) {
    return { kind: "loading", message: PORTFOLIO_LOADING };
  }

  const snapshotLoans = Array.isArray(input.snapshot?.loans) ? input.snapshot.loans : null;
  const chosen = choosePositions({
    liveFailed: input.liveFailed,
    liveLoans: input.liveLoans,
    snapshotFailed: input.snapshotFailed || input.snapshot == null,
    snapshotLoans,
  });
  if (input.snapshot == null && chosen.positions.length === 0) {
    return {
      kind: "blocked",
      message: input.snapshotFailed ? PORTFOLIO_SNAPSHOT_ERROR : PORTFOLIO_MISSING,
    };
  }

  const fx = snapshotFx(input.snapshot?.fxUsdToZar);
  const currency = input.currency;
  const allAssets = aggregatePositions(chosen.positions, null);
  const assets = aggregatePositions(chosen.positions, input.filterAccountIds);
  const pageSize = input.pageSize ?? PORTFOLIO_PAGE_SIZE;
  const paged = slicePage(assets, input.page, pageSize);
  const segments: ChartSegment[] = assets.flatMap((asset, index) => {
    if (asset.sharePct == null || asset.usd <= 0) return [];
    return [{ symbol: asset.symbol, pct: asset.sharePct, color: allocColor(index) }];
  });

  let holdings: string | null = null;
  let holdingsNote: string | null = null;
  if (input.snapshot == null) {
    holdingsNote = input.snapshotFailed ? PORTFOLIO_SNAPSHOT_ERROR : HOLDINGS_SNAPSHOT_MISSING;
  } else if (!finite(input.snapshot.holdingsUsd)) {
    holdingsNote = HOLDINGS_ABSENT;
  } else if (currency === "ZAR" && fx == null) {
    holdingsNote = input.filterActive ? `${RATE_UNAVAILABLE}. ${HOLDINGS_UNFILTERED}` : RATE_UNAVAILABLE;
  } else {
    holdings = money(input.snapshot.holdingsUsd, currency, fx);
    if (input.filterActive) holdingsNote = HOLDINGS_UNFILTERED;
  }

  let collateralNote: string | null = null;
  if (!chosen.loansListed) collateralNote = COLLATERAL_ABSENT;
  else if (chosen.positions.length === 0 && chosen.dropped > 0) collateralNote = COLLATERAL_UNREADABLE;
  else if (chosen.positions.length === 0) collateralNote = NO_OPEN_LOANS;
  else if (chosen.source === "snapshot") collateralNote = COLLATERAL_FROM_SNAPSHOT;
  else if (chosen.source === "live") collateralNote = COLLATERAL_FROM_LIVE;

  const asOf =
    input.snapshot && typeof input.snapshot.asOf === "string" ? fmtDateTime(input.snapshot.asOf) : null;

  return {
    kind: "ready",
    view: {
      asOfLabel: asOf,
      holdings,
      holdingsNote,
      fxLabel: fx == null ? null : `R${groupWithSpaces(fx, 2)} per USD`,
      sourceNote: chosen.source === "snapshot" && chosen.positions.length > 0 ? "Using the saved snapshot." : null,
      collateralNote,
      filterEmptyNote:
        input.filterActive && allAssets.length > 0 && assets.length === 0 ? FILTER_EMPTY : null,
      chartSummary: allocationSummary(assets),
      chartSegments: segments,
      assets: assetRows(paged.items, currency, fx),
      page: paged.page,
      pageCount: paged.pageCount,
      walletNote: WALLET_BALANCES_ABSENT,
      pendingNote: PENDING_SENDS_ABSENT,
      priceNote: SPOT_PRICES_ABSENT,
    },
  };
}

export function unitPriceUsd(usd: number, qty: number | null): number | null {
  if (qty == null || qty <= 0 || !finite(usd) || usd < 0) return null;
  return usd / qty;
}

export function assetDetail(input: {
  symbol: string;
  paint: PortfolioPaint;
  accountLabels: ReadonlyMap<string, string>;
  currency: PortfolioCurrency;
  fx: number | null;
  positions: readonly PositionInput[];
  filterAccountIds: ReadonlySet<string> | null;
  page: number;
  pageSize?: number;
}): AssetDetailResult {
  if (input.paint.kind === "loading") return input.paint;
  if (input.paint.kind === "blocked") return input.paint;
  const symbol = displayAsset(input.symbol);
  if (symbol.length === 0) return { kind: "missing", message: ASSET_NOT_FOUND };
  const assets = aggregatePositions(input.positions, input.filterAccountIds);
  const asset = assets.find((row) => row.symbol === symbol);
  if (!asset) return { kind: "missing", message: ASSET_NOT_FOUND };

  const pageSize = input.pageSize ?? PORTFOLIO_PAGE_SIZE;
  const paged = slicePage(asset.positions, input.page, pageSize);
  const combinedPrice = unitPriceUsd(asset.usd, asset.qty);
  return {
    kind: "asset",
    view: {
      symbol,
      value: money(asset.usd, input.currency, input.fx),
      quantity: quantityLabel(asset.qty, symbol),
      quantityNote: asset.qty == null ? QTY_UNAVAILABLE : null,
      price: combinedPrice == null ? null : money(combinedPrice, input.currency, input.fx),
      priceNote: combinedPrice == null ? PRICE_UNAVAILABLE : "Price is collateral value divided by the quantity returned for these loans.",
      positions: paged.items.map((position) => {
        const price = unitPriceUsd(position.usd, position.qty);
        return {
          loanId: position.loanId,
          accountLabel: input.accountLabels.get(position.accountId) ?? "Account not in the synced list",
          value: money(position.usd, input.currency, input.fx),
          quantity: quantityLabel(position.qty, symbol),
          price: price == null ? null : money(price, input.currency, input.fx),
        };
      }),
      page: paged.page,
      pageCount: paged.pageCount,
      walletNote: WALLET_BALANCES_ABSENT,
      pendingNote: PENDING_SENDS_ABSENT,
    },
  };
}
