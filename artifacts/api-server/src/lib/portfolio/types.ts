export type ExchangeId = "binance" | "luno";
export type HoldingExchange = ExchangeId | "pickle_rick";
export type WalletKind = "spot" | "earn" | "collateral" | "wallet";

/** One holding of one asset in one wallet of one linked exchange account. */
export interface Position {
  exchange: HoldingExchange;
  linkId: string;
  linkName: string;
  containerId: string | null;
  /** Exchange wallet, or the statement institution for Pickle Rick. */
  wallet: WalletKind | string;
  asset: string;
  qty: number;
  /** False when `rolls_up_into` means the parent statement total already includes this line. */
  includeInTotal?: boolean;
  /** Parent holding key when this line is already inside that statement total. */
  parentLinkId?: string;
  /** False when the statement has no snapshot balance yet. */
  balanceKnown?: boolean;
}

/** An open loan as stored in a portfolio snapshot. */
export interface DebtPosition {
  loanId: string;
  exchange: ExchangeId;
  linkId: string;
  containerId: string | null;
  asset: string;
  qty: number;
  collateralAsset: string;
  collateralQty: number;
  ltv: number;
  marginCallLtv: number;
  liqLtv: number;
  apr: number;
  hourlyRate: number;
}

export interface ContainerInfo {
  id: string;
  name: string;
  type: string;
  linkIds: string[];
  targetLtv: number | null;
}

/**
 * One day of a Pickle Rick statement series. `value` stays null when the
 * source has no number; callers must not replace that with zero.
 * `change` is the source's difference from the previous point on the same series.
 */
export interface StatementPoint {
  date: string;
  value: number | null;
  currency: string;
  change: number | null;
  product: string;
}

export type StatementKind = "as" | "weib" | "eib" | "ibkr";

/**
 * One external deposit or withdrawal. Positive `amount` is cash added.
 * Dividends, interest, and fees are not flows.
 */
export interface StatementFlow {
  date: string;
  amount: number;
  currency: string;
}

/**
 * One look-through line from `peresec_underlying`. `quantity` is the unit
 * count. `value` is that line's market value. Blank amounts stay null.
 */
export interface LookthroughLine {
  kind: "cash" | "asset";
  name: string;
  quantity: number | null;
  value: number | null;
  currency: string;
}

/**
 * Latest portal look-through for one Peresec investment. This is one date,
 * not the daily `perec-as`, `perec-weib`, or `perec-eib` series. `unavailable`
 * means an EIB sits under the WEIB but its lines were not returned, so `lines`
 * stays empty.
 */
export interface PeresecUnderlying {
  asOf: string;
  depth: "weib" | "eib" | "unavailable";
  currency: string;
  netAssetValue: number | null;
  cashTotal: number | null;
  lines: LookthroughLine[];
}

/**
 * A daily statement series stored beside the snapshot. Asset-swap series feed
 * net-worth history. WEIB and EIB are drill-down layers on that investment,
 * not extra list rows. `ibkr` is the Interactive Brokers equity chart for that
 * account only and is not added to net worth. `flows` is present only when
 * that series has a cash-flow ledger. `underlying` is the latest look-through
 * and is not added to the asset-swap balance.
 */
export interface StatementSeries {
  key: string;
  kind: StatementKind;
  accountNumber: string;
  product: string;
  containerId: string | null;
  asset: string;
  currency: string;
  /** Holding `as_of` day (YYYY-MM-DD) when the source sent one. */
  asOf?: string;
  points: StatementPoint[];
  flows?: StatementFlow[];
  /** Present on the asset-swap series when the holdings document sent `peresec_underlying`. */
  underlying?: PeresecUnderlying;
}

/** Everything the server knows right now; recorded every 15 minutes. */
export interface PortfolioState {
  asOf: number;
  positions: Position[];
  debts: DebtPosition[];
  /** USD price per asset at `asOf`. Stablecoins are 1; ZAR is 1/fx. */
  prices: Record<string, number>;
  /** 24-hour price change per asset in percent, when known. */
  change24h: Record<string, number>;
  fx: number | null;
  fxSource: "luno" | "binance" | "reference" | "none";
  containers: ContainerInfo[];
  errors: string[];
  /** Pickle Rick daily series. Absent on snapshots recorded before statement history existed. */
  statementSeries?: StatementSeries[];
}

/**
 * A compact history point. `h` holds quantities per container and asset
 * (debt as negative quantities under the same asset) so any scope can be
 * valued later; `n`/`a`/`d` are totals for the whole portfolio.
 */
export interface HistoryPoint {
  t: number;
  a: number;
  d: number;
  /** containerId (or "none") → asset → net quantity (assets minus debt). */
  h: Record<string, Record<string, number>>;
  /** containerId (or "none") → [assetsUsd, debtUsd]. */
  c: Record<string, [number, number]>;
  p: Record<string, number>;
  fx: number | null;
  /** loanId → [debtUsd, collateralUsd, containerId or "none"]. Absent on points recorded before loan history existed. */
  l?: Record<string, [number, number, string]>;
  /** True when this point was written because that Johannesburg day had no afternoon snapshot. */
  gapFill?: true;
  /** `container|asset` quantities carried from the last real observation. Absent when every quantity was observed that day. */
  carried?: string[];
}

export type LedgerEventType =
  | "deposit"
  | "withdrawal"
  | "buy"
  | "sell"
  | "convert"
  | "income"
  | "fee"
  | "interest"
  | "borrow"
  | "repay"
  | "transfer"
  | "adjustment";

/**
 * One signed change to one asset balance. A trade is two events (or three
 * with a fee) sharing `group`. Debt changes use `debt: true`: borrowing adds
 * debt (positive qty) and the borrowed coins arrive as a separate non-debt
 * event, so net worth does not move.
 */
export interface LedgerEvent {
  id: string;
  t: number;
  exchange: ExchangeId;
  linkId: string;
  type: LedgerEventType;
  asset: string;
  qty: number;
  debt?: boolean;
  /** USD value at the time, when the source reports it. */
  usd?: number | null;
  /** Events from one trade share a group id. */
  group?: string;
  /** External money in or out of the portfolio. */
  external?: boolean;
  /** Reconciliation adjustments are flagged so the UI can say so. */
  flagged?: boolean;
  note?: string;
}

export const STABLECOINS = new Set(["USDT", "USDC", "BUSD", "FDUSD", "DAI", "TUSD", "USD", "USDP"]);

const ASSET_PARAM = /^[^\u0000-\u001F?#]{1,200}$/;

export function normaliseAsset(asset: string): string {
  const trimmed = asset.trim();
  // Statement names keep their casing. Tickers are short symbols.
  if (/[^\w]/.test(trimmed) || trimmed.length > 12) return trimmed;
  const upper = trimmed.toUpperCase();
  if (upper === "XBT") return "BTC";
  return upper;
}

/** Path segment for one holding. Statement names are allowed; tickers are still normalised. */
export function portfolioAssetParam(raw: string): string | null {
  let decoded = raw;
  if (raw.includes("%")) {
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      return null;
    }
  }
  const trimmed = decoded.trim();
  if (!ASSET_PARAM.test(trimmed)) return null;
  return normaliseAsset(trimmed);
}
