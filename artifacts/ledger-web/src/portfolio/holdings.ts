import type { AssetPosition, LedgerEventView, PortfolioAsset } from "@workspace/api-client-react";

import { fmtCompact, fmtDate, fmtDisplayMoney, fmtNum, fmtQty } from "@/domain/format";
import { isChildScope, shortProfileName, type DisplayCurrency } from "@/prefs/preferences";

export type AssetRange = "1W" | "1M" | "3M" | "1Y";

export type HoldingPlace = {
  exchange: string;
  wallet: string;
  /** Set when the position is tied to a profile. */
  profile: string | null;
  qty: number;
  usd: number;
  /** False when the statement has no snapshot balance yet. */
  balanceKnown: boolean;
};

export type HoldingRow = {
  asset: string;
  qty: number;
  usd: number;
  priceUsd: number;
  change24hPct: number | null;
  /** Share of all holdings in scope, in percent. */
  pctOfTotal: number;
  debtUsd: number;
  /** Quantity of the borrowed asset. USDC debt is priced from this, not from a dollar peg. */
  debtQty: number;
  places: HoldingPlace[];
  /** Portal day for a Peresec asset-swap holding, when the list includes one. */
  quoteDate?: string;
  /** Currency of that holding balance. The amount is `qty`. */
  quoteCurrency?: string;
  /** Previous balance point. The day badge is `qty` versus this value. */
  priorValue?: number;
};

export type Labels = {
  profile: (containerId: string) => string;
};

const NAMES: Record<string, string> = {
  ADA: "Cardano",
  ATOM: "Cosmos",
  AVAX: "Avalanche",
  BCH: "Bitcoin Cash",
  BNB: "BNB",
  BTC: "Bitcoin",
  DAI: "Dai",
  DOGE: "Dogecoin",
  DOT: "Polkadot",
  ETC: "Ethereum Classic",
  ETH: "Ethereum",
  FDUSD: "First Digital USD",
  FIL: "Filecoin",
  LINK: "Chainlink",
  LTC: "Litecoin",
  MATIC: "Polygon",
  POL: "Polygon",
  SOL: "Solana",
  TRX: "TRON",
  TUSD: "TrueUSD",
  UNI: "Uniswap",
  USDC: "USD Coin",
  USDT: "Tether",
  XLM: "Stellar",
  XRP: "XRP",
  ZAR: "South African rand",
  USD: "US dollar",
};

/** Statement lines are names, not tickers, so they keep the casing from the source. */
export function isStatementName(asset: string): boolean {
  const trimmed = asset.trim();
  return /[^\w]/.test(trimmed) || trimmed.length > 12;
}

const PERESEC = /peresec/i;
const NINETY_ONE = /ninety\s*one/i;

export function isPeresecHolding(asset: string, places?: readonly { exchange: string; wallet: string }[]): boolean {
  if (PERESEC.test(asset)) return true;
  return places?.some((place) => place.exchange === "pickle_rick" && PERESEC.test(place.wallet)) ?? false;
}

export function isNinetyOneHolding(asset: string, places?: readonly { wallet: string }[]): boolean {
  if (NINETY_ONE.test(asset)) return true;
  return places?.some((place) => NINETY_ONE.test(place.wallet)) ?? false;
}

/**
 * Ninety One list title. TFSA wins over the platform name. A retirement
 * annuity (including INVRA) is RA. An investment portfolio, IP, or INVIB
 * is Investment Portfolio. Names without one of those products stay as written.
 */
export function ninetyOneTitle(asset: string, places?: readonly { wallet: string }[]): "Investment Portfolio" | "RA" | "TFSA" | null {
  if (!isNinetyOneHolding(asset, places)) return null;
  const haystack = [asset, ...(places ?? []).map((place) => place.wallet)].join("\n");
  if (/\btfsa\b/i.test(haystack)) return "TFSA";
  if (/retirement\s+annuity|\binvra\b/i.test(haystack)) return "RA";
  if (/investment[_\s-]*portfolio|\binvib\b|\bip\b/i.test(haystack)) return "Investment Portfolio";
  return null;
}

/** Title shown on a holdings row. Peresec noise and Ninety One product names are shortened here. */
export function holdingTitle(asset: string, places?: readonly { exchange: string; wallet: string }[]): string {
  return ninetyOneTitle(asset, places) ?? displayHoldingTitle(asset, isPeresecHolding(asset, places));
}

/** Pickle Rick is the statement feed, not a place the Ninety One row should name. */
export function hidesPickleSource(asset: string, place: { exchange: string; wallet: string }): boolean {
  return place.exchange === "pickle_rick" && isNinetyOneHolding(asset, [place]);
}

export function sourcePlaces<T extends { exchange: string; wallet: string }>(asset: string, places: readonly T[]): T[] {
  if (!isNinetyOneHolding(asset, places)) return [...places];
  return places.filter((place) => !hidesPickleSource(asset, place));
}

/** Personal lines, then any other profile, then a trust (WLDD). Order inside a profile stays as given. */
export function groupPlacesByProfile<T extends { profile: string | null }>(places: readonly T[]): T[][] {
  const groups: { rank: number; places: T[] }[] = [];
  const index = new Map<string, number>();
  for (const place of places) {
    const key = (place.profile ?? "").trim().toLowerCase();
    const at = index.get(key);
    if (at != null) {
      groups[at]!.places.push(place);
      continue;
    }
    index.set(key, groups.length);
    groups.push({ rank: profileGroupRank(place.profile), places: [place] });
  }
  return [...groups].sort((a, b) => a.rank - b.rank).map((group) => group.places);
}

function profileGroupRank(profile: string | null): number {
  const name = profile?.trim() ?? "";
  if (/^personal$/i.test(name)) return 0;
  if (/\b(trust|wldd)\b/i.test(name)) return 2;
  return 1;
}

/**
 * Visible title for a Peresec investment. Drops Anchor Capital, a leading
 * institution before Peresec, parenthetical account numbers, "(personal)",
 * and "acc 0433383" style suffixes. Other names stay as written.
 */
export function displayHoldingTitle(name: string, peresec = PERESEC.test(name)): string {
  const original = name.trim();
  if (!peresec) return original;
  let title = original
    .replace(/\s*\(\s*personal\s*,?\s*(?:(?:acc(?:ount)?|a\/c)\s*:?\s*)?\d{4,}\s*\)/gi, "")
    .replace(/\s*\(\s*(?:(?:acc(?:ount)?|a\/c)\s*:?\s*)?\d{4,}\s*\)/gi, "")
    .replace(/\s*\(\s*personal\s*,?\s*\)/gi, "")
    .replace(/\s*(?:acc(?:ount)?|a\/c)\s*:?\s*\d{4,}\b/gi, "")
    .replace(/\bAnchor\s+Capital\b/gi, "");
  const parts = title
    .split(/\s*\/\s*/)
    .map((part) => part.replace(/\s{2,}/g, " ").trim())
    .filter((part) => part.length > 0);
  const peresecAt = parts.findIndex((part) => PERESEC.test(part));
  title = (peresecAt > 0 ? parts.slice(peresecAt) : parts).join(" / ");
  title = title.replace(/^[/|—–-]+\s*|\s*[/|—–-]+$/g, "").trim();
  return title.length > 0 ? title : original;
}

/** Date first, then the asset-swap balance. WEIB and EIB are not this quote. */
export function statementQuoteParts(row: {
  quoteDate?: string | null;
  quoteCurrency?: string | null;
  qty: number;
  places: readonly { balanceKnown: boolean }[];
}): { date: string; amount: string } | null {
  const date = row.quoteDate ?? "";
  const currency = row.quoteCurrency === "USD" || row.quoteCurrency === "ZAR" ? row.quoteCurrency : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !currency) return null;
  const known = row.places.length === 0 || row.places.some((place) => place.balanceKnown);
  if (!known) return null;
  return {
    date: fmtDate(`${date}T12:00:00+02:00`),
    amount: fmtDisplayMoney(row.qty, currency),
  };
}

/**
 * Percent from the previous balance point to the latest balance.
 * That is the point's change divided by the previous value.
 * Null when there is no earlier point, or that point is not a positive balance.
 */
export function statementDayPct(latest: number, prior: number | null | undefined): number | null {
  if (typeof prior !== "number" || !Number.isFinite(prior) || !(prior > 0)) return null;
  if (!Number.isFinite(latest)) return null;
  return ((latest - prior) / prior) * 100;
}

/** A 24-hour ticker percent is the only badge on that coin. Statement rows use the previous point. */
export function holdingMovePct(row: { qty: number; change24hPct: number | null; priorValue?: number | null }): number | null {
  if (row.change24hPct != null) return null;
  return statementDayPct(row.qty, row.priorValue);
}

export function assetName(asset: string): string {
  if (isStatementName(asset)) return "";
  const symbol = asset.trim().toUpperCase();
  return NAMES[symbol] ?? symbol;
}

const FEED_PLACE = /^pickle\s*rick$/i;

export function exchangeLabel(exchange: string): string {
  if (exchange === "luno") return "Luno";
  if (exchange === "binance") return "Binance";
  // The statement feed is not a place. Rows name the institution instead.
  if (exchange === "pickle_rick") return "";
  return exchange;
}

export function whereLabel(exchange: string, wallet: string, profile?: string | null): string {
  const place = walletLabel(wallet);
  const parts = [exchangeLabel(exchange), FEED_PLACE.test(place.trim()) ? "" : place].filter((part) => part.trim().length > 0);
  if (profile) parts.push(profile);
  return parts.join(" · ");
}

const BROKER = /interactive brokers|\bibkr\b/i;

/** The account row whose quantity is net asset value. Nested lines are not this row. */
export function isBrokerAccountPosition(position: { includeInTotal?: boolean; wallet: string; linkName: string; linkId: string }): boolean {
  if (position.includeInTotal === false) return false;
  if (position.linkId.startsWith("ibkr:") && !position.linkId.includes("|")) return true;
  return BROKER.test(`${position.wallet}\n${position.linkName}`);
}

/** An open line already inside the Interactive Brokers account total. */
export function isBrokerInsideAccount(position: { includeInTotal?: boolean; wallet: string; linkId: string }): boolean {
  return position.includeInTotal === false && (position.linkId.startsWith("ibkr:") || BROKER.test(position.wallet));
}

export type HeldRowCopy = {
  title: string;
  caption: string;
  /** Binance and Luno marks stay on the wallet line. Nested broker lines do not add one. */
  markOn: "title" | "caption" | "none";
  /** False when the quantity is already written as shares or contracts, so the account name is not repeated. */
  repeatAccountQuantity: boolean;
  wrap: boolean;
};

const QUANTITY_PART = /^-?\d+(?:\.\d+)? (?:shares?|contracts?)$/i;

/** Splits a broker label into the instrument and the shares, contracts, side, and expiry. */
export function splitBrokerHolding(label: string): { title: string; caption: string } {
  const parts = label.split(" · ").map((part) => part.trim()).filter((part) => part.length > 0);
  const caption: string[] = [];
  while (parts.length > 1) {
    const last = parts[parts.length - 1] ?? "";
    if (/^expires /i.test(last) || QUANTITY_PART.test(last) || last.toLowerCase() === "short") {
      caption.unshift(parts.pop() as string);
      continue;
    }
    break;
  }
  return { title: parts.join(" · "), caption: caption.join(" · ") };
}

/**
 * Copy for one Where it's held row. The Interactive Brokers account balance
 * is omitted. Nested lines do not say they are included in the total.
 */
export function describeHeldPosition(
  position: Pick<AssetPosition, "includeInTotal" | "wallet" | "linkName" | "linkId" | "exchange">,
  input: { instrument: string; profile: string | null; where: string; hideSource: boolean; symbol: string },
): HeldRowCopy | null {
  if (isBrokerAccountPosition(position)) return null;
  if (isBrokerInsideAccount(position)) {
    const split = splitBrokerHolding(input.instrument);
    return {
      title: split.title,
      caption: split.caption,
      markOn: "none",
      repeatAccountQuantity: false,
      wrap: true,
    };
  }
  const nested = position.includeInTotal === false;
  if (nested) {
    const markOn = !input.where ? "none" : input.profile ? "caption" : "title";
    return {
      title: input.instrument,
      caption: input.profile ?? "",
      markOn,
      repeatAccountQuantity: true,
      wrap: false,
    };
  }
  const title = input.profile || input.where || input.symbol;
  const caption = input.hideSource ? "" : input.profile ? input.where : input.instrument;
  const markOn = input.hideSource || !input.where ? "none" : input.profile ? "caption" : "title";
  return { title, caption, markOn, repeatAccountQuantity: true, wrap: false };
}

export function walletLabel(wallet: string): string {
  if (wallet === "spot") return "Spot";
  if (wallet === "earn") return "Earn";
  if (wallet === "collateral") return "Loan collateral";
  if (wallet === "wallet") return "Wallet";
  if (PERESEC.test(wallet) || /anchor\s+capital/i.test(wallet)) return displayHoldingTitle(wallet, true);
  return wallet;
}

function placeKey(position: AssetPosition): string {
  return `${position.exchange}|${position.wallet}|${position.containerId ?? ""}`;
}

function placesFor(positions: readonly AssetPosition[], labels: Labels): HoldingPlace[] {
  const merged = new Map<string, HoldingPlace>();
  for (const position of positions) {
    if (position.includeInTotal === false) continue;
    const key = placeKey(position);
    const existing = merged.get(key);
    if (existing) {
      existing.qty += position.qty;
      existing.usd += position.usd;
      existing.balanceKnown = existing.balanceKnown && position.balanceKnown !== false;
      continue;
    }
    merged.set(key, {
      exchange: position.exchange,
      wallet: position.wallet,
      profile: position.containerId ? labels.profile(position.containerId) : null,
      qty: position.qty,
      usd: position.usd,
      balanceKnown: position.balanceKnown !== false,
    });
  }
  return [...merged.values()].sort((a, b) => b.usd - a.usd || a.exchange.localeCompare(b.exchange) || a.wallet.localeCompare(b.wallet));
}

export type LunoUsdcQuote = {
  bid: number;
  ask: number;
  lastTrade: number;
};

/**
 * Luno USDC/ZAR. Bid/ask mid when both sides are present, otherwise the last
 * trade. The 5–100 band is the same check the portfolio uses before it treats
 * a Luno USDC quote as the rand rate for Luno assets.
 */
export function lunoUsdcZarMid(quote: LunoUsdcQuote | null | undefined): number | null {
  if (!quote) return null;
  const mid = quote.bid > 0 && quote.ask > 0 ? (quote.bid + quote.ask) / 2 : quote.lastTrade;
  return mid > 5 && mid < 100 ? mid : null;
}

/** USDC debt in rand at Luno's current USDC price. Null when that price is missing. */
export function usdcDebtAtLuno(
  row: { asset: string; debtQty: number },
  currency: DisplayCurrency,
  quote: LunoUsdcQuote | null | undefined,
): { zar: number; price: number } | null {
  if (currency !== "ZAR" || row.asset.trim().toUpperCase() !== "USDC" || !(row.debtQty > 0)) return null;
  const price = lunoUsdcZarMid(quote);
  if (price == null) return null;
  return { zar: row.debtQty * price, price };
}

const CHILD_DEBT_NAMES = new Set(["laden", "landen", "ivelle", "greyson"]);

export type ProfileDebtSlice = {
  profile: string | null;
  debtQty: number;
  containerId?: string | null;
};

/** Child profiles stay out of the Personal / trust debt split. */
export function isChildDebtProfile(containerId: string | null | undefined, profile: string | null | undefined): boolean {
  if (containerId && isChildScope(containerId)) return true;
  return CHILD_DEBT_NAMES.has((profile ?? "").trim().toLowerCase());
}

/**
 * Profile label for one USDC loan. Prefers the same short name the wallet
 * lines use. Child profiles return null so they are left out of the split.
 */
export function debtProfileLabel(
  containerId: string | null,
  serverName: string | null,
  nameFor: (containerId: string) => string,
): string | null {
  if (isChildDebtProfile(containerId, serverName)) return null;
  const fromList = containerId ? nameFor(containerId).trim() : "";
  const named = fromList && fromList !== "Profile" ? fromList : shortProfileName({ name: (serverName ?? "").trim() });
  const profile = named.trim();
  if (!profile || profile === "Profile" || isChildDebtProfile(null, profile)) return null;
  return profile;
}

/** One owed quantity per profile. Personal, then anyone else, then a trust. */
export function profileDebts(slices: readonly ProfileDebtSlice[]): { profile: string; debtQty: number }[] {
  const kept: { profile: string; debtQty: number }[] = [];
  for (const slice of slices) {
    if (!(slice.debtQty > 0)) continue;
    if (isChildDebtProfile(slice.containerId, slice.profile)) continue;
    const profile = slice.profile?.trim() ?? "";
    if (!profile) continue;
    kept.push({ profile, debtQty: slice.debtQty });
  }
  return groupPlacesByProfile(kept).map((group) => ({
    profile: group[0]!.profile,
    debtQty: group.reduce((sum, item) => sum + item.debtQty, 0),
  }));
}

export type UsdcOwedLine = {
  profile: string;
  /** Borrowed USDC quantity, for example "2,00 USDC". */
  qtyLabel: string;
  /** Rand value of that quantity at the Luno USDC price. */
  amount: string;
};

export type UsdcOwedSplit = {
  lines: UsdcOwedLine[];
  /** Luno USDC price, once after every profile group. */
  priceLabel: string;
};

/** One owed line: coin quantity, then rand, then the profile that owes it. */
export function usdcOwedLineText(line: Pick<UsdcOwedLine, "qtyLabel" | "amount" | "profile">): string {
  return `Owed ${line.qtyLabel} · ${line.amount} · ${line.profile}`;
}

/**
 * USDC debt in rand at one Luno price, split by profile. Each line keeps the
 * borrowed quantity. Null when the price is missing or no profile has debt
 * left after children are removed.
 */
export function usdcOwedSplit(
  slices: readonly ProfileDebtSlice[],
  quote: LunoUsdcQuote | null | undefined,
): UsdcOwedSplit | null {
  const price = lunoUsdcZarMid(quote);
  if (price == null) return null;
  const groups = profileDebts(slices);
  if (groups.length === 0) return null;
  return {
    lines: groups.map((group) => ({
      profile: group.profile,
      qtyLabel: fmtQty(group.debtQty, "USDC"),
      amount: fmtCompact(group.debtQty * price, "R"),
    })),
    priceLabel: `Luno USDC R${fmtNum(price, 2)}`,
  };
}

export type ProfileBlock<T extends { profile: string | null }> = {
  profile: string | null;
  places: T[];
  owed: UsdcOwedLine | null;
};

/**
 * Wallet lines and the matching USDC debt, Personal then a trust.
 * Debt is attached to the profile that owes it, directly after that profile's
 * wallet lines. A debt with no wallet still gets its own group.
 */
export function profileBlocks<T extends { profile: string | null }>(
  places: readonly T[],
  owed: readonly UsdcOwedLine[] | null | undefined,
): ProfileBlock<T>[] {
  type Item = { profile: string | null; place: T | null; owed: UsdcOwedLine | null };
  const items: Item[] = [
    ...places.map((place) => ({ profile: place.profile, place, owed: null })),
    ...(owed ?? []).map((line) => ({ profile: line.profile, place: null, owed: line })),
  ];
  return groupPlacesByProfile(items).map((group) => {
    const place = group.find((item) => item.place);
    return {
      profile: place?.profile ?? group[0]?.profile ?? null,
      places: group.flatMap((item) => (item.place ? [item.place] : [])),
      owed: group.find((item) => item.owed)?.owed ?? null,
    };
  });
}

/**
 * Warning under a holding. USDC debt names the coin quantity and, when Luno's
 * USDC price is available, the rand value of that quantity. Any other debt,
 * or a missing quantity, keeps `fallbackAmount`.
 */
export function owedWarningText(
  row: { asset: string; debtQty: number },
  currency: DisplayCurrency,
  quote: LunoUsdcQuote | null | undefined,
  fallbackAmount: string,
): string {
  const priced = usdcDebtAtLuno(row, currency, quote);
  const qty = row.asset.trim().toUpperCase() === "USDC" && row.debtQty > 0 ? fmtQty(row.debtQty, "USDC") : null;
  if (!priced) return qty ? `Owed ${qty} · ${fallbackAmount}` : `Owed ${fallbackAmount}`;
  return `Owed ${fmtQty(row.debtQty, "USDC")} · ${fmtCompact(priced.zar, "R")} · Luno USDC R${fmtNum(priced.price, 2)}`;
}

/** One row per asset. Every position stays on that row as a place. */
export function listHoldings(assets: readonly PortfolioAsset[], labels: Labels): HoldingRow[] {
  const totalUsd = assets.reduce((sum, asset) => sum + asset.usd, 0);
  return assets
    .filter((asset) => asset.usd > 0 || asset.qty > 0 || asset.debtUsd > 0 || asset.positions.length > 0)
    .map<HoldingRow>((asset) => ({
      asset: asset.asset,
      qty: asset.qty,
      usd: asset.usd,
      priceUsd: asset.priceUsd,
      change24hPct: asset.change24hPct,
      pctOfTotal: totalUsd > 0 ? (asset.usd / totalUsd) * 100 : 0,
      debtUsd: asset.debtUsd,
      debtQty: asset.debtQty,
      places: placesFor(asset.positions, labels),
      ...(asset.quoteDate ? { quoteDate: asset.quoteDate } : {}),
      ...(asset.quoteCurrency ? { quoteCurrency: asset.quoteCurrency } : {}),
      ...(typeof asset.priorValue === "number" ? { priorValue: asset.priorValue } : {}),
    }))
    .sort((a, b) => b.usd - a.usd || a.asset.localeCompare(b.asset));
}

/** Rows worth less than `minUsd` (and not owed) are folded away by default. */
export function partitionDust(rows: readonly HoldingRow[], minUsd = 1): { visible: HoldingRow[]; dust: HoldingRow[] } {
  const visible: HoldingRow[] = [];
  const dust: HoldingRow[] = [];
  for (const row of rows) (row.usd < minUsd && row.debtUsd <= 0 ? dust : visible).push(row);
  return { visible, dust };
}

export function matchesQuery(asset: string, query: string): boolean {
  const needle = query.trim().toUpperCase();
  if (needle.length === 0) return true;
  return asset.toUpperCase().includes(needle) || assetName(asset).toUpperCase().includes(needle);
}

const RANGE_DAYS: Record<AssetRange, number> = { "1W": 7, "1M": 30, "3M": 91, "1Y": 365 };

/** Points inside the range, keeping the last point before it so the line starts at the edge. */
export function sliceRange<T extends { t: string }>(points: readonly T[], range: AssetRange, asOfMs: number): T[] {
  const from = asOfMs - RANGE_DAYS[range] * 86_400_000;
  let start = points.findIndex((point) => Date.parse(point.t) >= from);
  if (start < 0) return points.slice(-2);
  if (start > 0) start -= 1;
  return points.slice(start);
}

export function unrealizedPct(asset: Pick<PortfolioAsset, "costBasisUsd" | "unrealizedUsd">): number | null {
  if (asset.costBasisUsd == null || asset.unrealizedUsd == null || asset.costBasisUsd <= 0) return null;
  return (asset.unrealizedUsd / asset.costBasisUsd) * 100;
}

const EVENT_LABELS: Record<string, string> = {
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  buy: "Bought",
  sell: "Sold",
  convert: "Converted",
  income: "Earn reward",
  fee: "Fee",
  interest: "Loan interest",
  borrow: "Borrowed",
  repay: "Repaid",
  adjustment: "Balance adjustment",
};

export function eventLabel(event: Pick<LedgerEventView, "type">): string {
  return EVENT_LABELS[event.type] ?? event.type;
}

export type ActivityRow =
  | { kind: "event"; key: string; event: LedgerEventView }
  | {
      kind: "summary";
      key: string;
      type: string;
      debt: boolean;
      count: number;
      qty: number;
      usd: number | null;
      from: string;
      to: string;
      exchange: string;
      containerId: string | null;
    };

const RECURRING = new Set(["income", "interest"]);

/**
 * Daily Earn rewards and loan interest would bury everything else, so within
 * one month they collapse into a single row per type, account and side.
 */
export function collapseRecurring(events: readonly LedgerEventView[]): ActivityRow[] {
  type Summary = Extract<ActivityRow, { kind: "summary" }>;
  const rows: ActivityRow[] = [];
  const open = new Map<string, Summary>();
  const first = new Map<Summary, LedgerEventView>();
  for (const event of events) {
    if (!RECURRING.has(event.type)) {
      rows.push({ kind: "event", key: event.id, event });
      continue;
    }
    const groupKey = `${event.type}|${event.debt ? "d" : "a"}|${event.linkId}`;
    const existing = open.get(groupKey);
    if (existing) {
      existing.count += 1;
      existing.qty += event.qty;
      existing.usd = existing.usd != null && event.usd != null ? existing.usd + event.usd : null;
      existing.from = event.t;
      continue;
    }
    const summary: Summary = {
      kind: "summary",
      key: `sum:${event.id}`,
      type: event.type,
      debt: event.debt,
      count: 1,
      qty: event.qty,
      usd: event.usd,
      from: event.t,
      to: event.t,
      exchange: event.exchange,
      containerId: event.containerId,
    };
    open.set(groupKey, summary);
    first.set(summary, event);
    rows.push(summary);
  }
  return rows.map((row) => {
    if (row.kind !== "summary" || row.count > 1) return row;
    const only = first.get(row);
    return only ? { kind: "event", key: only.id, event: only } : row;
  });
}

/** Groups activity by Johannesburg calendar month, newest first. */
export function eventsByMonth(events: readonly LedgerEventView[]): Array<{ key: string; label: string; events: LedgerEventView[] }> {
  const formatter = new Intl.DateTimeFormat("en-ZA", { timeZone: "Africa/Johannesburg", month: "long", year: "numeric" });
  const keyFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit" });
  const out: Array<{ key: string; label: string; events: LedgerEventView[] }> = [];
  for (const event of events) {
    const date = new Date(event.t);
    const key = keyFormatter.format(date);
    let bucket = out[out.length - 1];
    if (!bucket || bucket.key !== key) {
      bucket = { key, label: formatter.format(date), events: [] };
      out.push(bucket);
    }
    bucket.events.push(event);
  }
  return out;
}
