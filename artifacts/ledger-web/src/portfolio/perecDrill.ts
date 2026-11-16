import { fmtDate, fmtDisplayMoney, fmtNum, fmtPct, JOHANNESBURG_TIME_ZONE } from "../domain/format";

export type LayerPoint = {
  date: string;
  value: number | null;
  currency: string;
  change: number | null;
  product: string;
};

export type LookthroughKind = "cash" | "equity" | "derivative" | "asset";

export type LookthroughLine = {
  kind: LookthroughKind;
  name: string;
  quantity: number | null;
  /** Market value. Null when the portal left it blank. */
  value: number | null;
  currency: string;
  /** Portal asset class. Absent on cash and when the source left it blank. */
  assetClass?: string;
  instrumentCode?: string;
  /** Null when the portal did not send a cost. Never invented as zero. */
  costPrice: number | null;
  marketPrice: number | null;
  pnl: number | null;
  settledBalance: number | null;
  accruals: number | null;
  zarValue: number | null;
  zarExposure: number | null;
  /** EXP / NAV percentage. Not a money amount. */
  expNav: number | null;
};

export type LookthroughColumn =
  | "name"
  | "quantity"
  | "costPrice"
  | "marketPrice"
  | "value"
  | "pnl"
  | "settledBalance"
  | "accruals"
  | "zarValue"
  | "zarExposure"
  | "expNav";

export const LOOKTHROUGH_COLUMN_LABEL: Record<LookthroughColumn, string> = {
  name: "Name",
  quantity: "Quantity",
  costPrice: "Cost price",
  marketPrice: "Market price",
  value: "Market value",
  pnl: "P&L",
  settledBalance: "Settled balance",
  accruals: "Accruals",
  zarValue: "ZAR value",
  zarExposure: "ZAR exposure",
  expNav: "EXP / NAV",
};

export type LookthroughGroup = {
  title: string;
  lines: LookthroughLine[];
};

export type InvestmentLayer = {
  kind: "weib" | "eib";
  name: string;
  value: number | null;
  currency: string;
  points: LayerPoint[];
  inside: InvestmentLayer | null;
  /** Latest look-through lines. Empty when the portal did not return them. */
  lines?: LookthroughLine[];
  /** False when this EIB exists but the portal did not return its lines. */
  linesAvailable?: boolean;
  /** Portal day for `lines` (YYYY-MM-DD). */
  linesAsOf?: string;
  /** Deepest-fund total. Null when the source left it blank. Not the daily series. */
  netAssetValue?: number | null;
  /** Deepest-fund cash total. Null when the source left it blank. */
  cashTotal?: number | null;
};

export type DrillStep = "investment" | "weib" | "eib";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readValue(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

function readPoint(value: unknown): LayerPoint | null {
  if (!isRecord(value) || typeof value.date !== "string" || typeof value.product !== "string") return null;
  const amount = readValue(value.value);
  const change = readValue(value.change);
  if (amount === undefined || change === undefined) return null;
  return {
    date: value.date,
    value: amount,
    currency: typeof value.currency === "string" ? value.currency : "",
    change,
    product: value.product,
  };
}

function readAssetClass(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const LINE_KINDS = new Set<LookthroughKind>(["cash", "equity", "derivative", "asset"]);

function amountOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = readValue(value);
  return parsed === undefined ? null : parsed;
}

function readLine(value: unknown): LookthroughLine | null {
  if (!isRecord(value)) return null;
  if (typeof value.kind !== "string" || !LINE_KINDS.has(value.kind as LookthroughKind)) return null;
  if (typeof value.name !== "string" || value.name.trim() === "") return null;
  const quantity = readValue(value.quantity);
  const amount = readValue(value.value);
  if (quantity === undefined || amount === undefined) return null;
  const kind = value.kind as LookthroughKind;
  const cash = kind === "cash";
  const assetClass = cash ? undefined : readAssetClass(value.assetClass) ?? readAssetClass(value.asset_class);
  const instrumentCode = cash ? "" : readAssetClass(value.instrumentCode) ?? readAssetClass(value.instrument_code) ?? "";
  return {
    kind,
    name: value.name.trim(),
    quantity,
    value: amount,
    currency: typeof value.currency === "string" ? value.currency : "",
    ...(assetClass ? { assetClass } : {}),
    ...(instrumentCode ? { instrumentCode } : {}),
    costPrice: cash ? null : amountOrNull(value.costPrice ?? value.cost_price),
    marketPrice: cash ? null : amountOrNull(value.marketPrice ?? value.market_price),
    pnl: cash ? null : amountOrNull(value.pnl),
    settledBalance: cash ? amountOrNull(value.settledBalance ?? value.settled_balance) : null,
    accruals: cash ? amountOrNull(value.accruals) : null,
    zarValue: amountOrNull(value.zarValue ?? value.zar_value),
    zarExposure: amountOrNull(value.zarExposure ?? value.zar_exposure),
    expNav: amountOrNull(value.expNav ?? value.exp_nav),
  };
}

function readTotal(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  return readValue(value) === undefined ? null : readValue(value);
}

/** Parses one layer. A null value stays null and is not a failed fetch. */
export function readInvestmentLayer(value: unknown): InvestmentLayer | null {
  if (!isRecord(value)) return null;
  if (value.kind !== "weib" && value.kind !== "eib") return null;
  if (typeof value.name !== "string" || value.name.trim() === "") return null;
  const amount = readValue(value.value);
  if (amount === undefined) return null;
  if (!Array.isArray(value.points)) return null;
  const points: LayerPoint[] = [];
  for (const point of value.points) {
    const parsed = readPoint(point);
    if (parsed) points.push(parsed);
  }
  const inside = value.inside == null ? null : readInvestmentLayer(value.inside);
  const linesAvailable = value.linesAvailable === false ? false : value.linesAvailable === true ? true : undefined;
  const lines: LookthroughLine[] = [];
  if (linesAvailable !== false && Array.isArray(value.lines)) {
    for (const line of value.lines) {
      const parsed = readLine(line);
      if (parsed) lines.push(parsed);
    }
  }
  const netAssetValue = readTotal(value.netAssetValue);
  const cashTotal = readTotal(value.cashTotal);
  const linesAsOf = typeof value.linesAsOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.linesAsOf) ? value.linesAsOf : undefined;
  return {
    kind: value.kind,
    name: value.name,
    value: amount,
    currency: typeof value.currency === "string" ? value.currency : "",
    points,
    inside,
    ...(linesAvailable === undefined ? {} : { linesAvailable }),
    ...(linesAvailable === false ? { lines: [] } : lines.length > 0 ? { lines } : {}),
    ...(linesAsOf ? { linesAsOf } : {}),
    ...(netAssetValue === undefined ? {} : { netAssetValue }),
    ...(cashTotal === undefined ? {} : { cashTotal }),
  };
}

/** Lines to show on this layer. Unavailable wins over any cash or instrument rows. */
export function lookthroughLines(layer: InvestmentLayer): { assets: LookthroughLine[]; cash: LookthroughLine[] } | "unavailable" | null {
  if (layer.linesAvailable === false) return "unavailable";
  if (!layer.lines || layer.lines.length === 0) return null;
  const portal = layer.lines.some((line) => line.kind === "equity" || line.kind === "derivative");
  const visible = portal ? layer.lines.filter((line) => line.kind !== "asset") : layer.lines;
  return {
    assets: visible.filter((line) => line.kind !== "cash"),
    cash: visible.filter((line) => line.kind === "cash"),
  };
}

/**
 * Fund snapshot totals for a layer that already has look-through lines.
 * Empty when the lines were withheld, there are no lines, or both totals are blank.
 * These figures are not the daily series and are not added to the parent balance.
 */
export function lookthroughSnapshotTotals(layer: InvestmentLayer): { label: string; value: number; asOf: string | null }[] {
  const lines = lookthroughLines(layer);
  if (!lines || lines === "unavailable" || (lines.assets.length === 0 && lines.cash.length === 0)) return [];
  const asOf = layer.linesAsOf ?? null;
  const rows: { label: string; value: number; asOf: string | null }[] = [];
  if (typeof layer.netAssetValue === "number" && Number.isFinite(layer.netAssetValue)) {
    rows.push({ label: "Net asset value", value: layer.netAssetValue, asOf });
  }
  if (typeof layer.cashTotal === "number" && Number.isFinite(layer.cashTotal)) {
    rows.push({ label: "Cash total", value: layer.cashTotal, asOf });
  }
  return rows;
}

function isEquityFamily(value: string): boolean {
  return value === "equity" || value === "equities" || value === "hedge fund" || value === "etp";
}

function isDerivativeClass(value: string): boolean {
  return /(?:^|[^a-z])(?:derivatives?|futures?|options?|cfd)(?=$|[^a-z])/.test(value);
}

/**
 * Portal tables keep one heading each: Equities (including hedge fund, ETP,
 * and equity), Derivatives, and Cash. An empty table is omitted. Older asset
 * rows are dropped when an equity or derivative line is already present.
 * A leftover asset class that is neither equity nor derivative keeps its heading.
 */
export function lookthroughGroups(lines: { assets: LookthroughLine[]; cash: LookthroughLine[] }): LookthroughGroup[] {
  const equities: LookthroughLine[] = [];
  const derivatives: LookthroughLine[] = [];
  const unclassed: LookthroughLine[] = [];
  const other = new Map<string, { title: string; lines: LookthroughLine[] }>();
  const otherOrder: string[] = [];
  for (const line of lines.assets) {
    const raw = line.assetClass?.trim() ?? "";
    const key = raw.toLowerCase();
    if (line.kind === "equity" || (line.kind !== "derivative" && isEquityFamily(key))) {
      equities.push(line);
      continue;
    }
    if (line.kind === "derivative" || isDerivativeClass(key)) {
      derivatives.push(line);
      continue;
    }
    if (!raw) {
      unclassed.push(line);
      continue;
    }
    const bucket = other.get(key);
    if (bucket) {
      bucket.lines.push(line);
      continue;
    }
    other.set(key, { title: raw, lines: [line] });
    otherOrder.push(key);
  }
  const groups: LookthroughGroup[] = [];
  if (equities.length > 0) groups.push({ title: "Equities", lines: equities });
  if (derivatives.length > 0) groups.push({ title: "Derivatives", lines: derivatives });
  for (const key of otherOrder) {
    const bucket = other.get(key);
    if (bucket && bucket.lines.length > 0) groups.push(bucket);
  }
  if (unclassed.length > 0) groups.push({ title: "Assets", lines: unclassed });
  if (lines.cash.length > 0) groups.push({ title: "Cash", lines: lines.cash });
  return groups;
}

const INSTRUMENT_COLUMNS: readonly LookthroughColumn[] = ["name", "quantity", "costPrice", "marketPrice", "value", "pnl", "zarValue", "zarExposure", "expNav"];
const CASH_COLUMNS: readonly LookthroughColumn[] = ["name", "settledBalance", "accruals", "value", "zarValue", "zarExposure", "expNav"];

function columnAmount(line: LookthroughLine, column: LookthroughColumn): number | null {
  if (column === "quantity") return line.quantity;
  if (column === "costPrice") return line.costPrice;
  if (column === "marketPrice") return line.marketPrice;
  if (column === "value") return line.value;
  if (column === "pnl") return line.pnl;
  if (column === "settledBalance") return line.settledBalance;
  if (column === "accruals") return line.accruals;
  if (column === "zarValue") return line.zarValue;
  if (column === "zarExposure") return line.zarExposure;
  if (column === "expNav") return line.expNav;
  return null;
}

function quantityText(value: number): string {
  if (Number.isInteger(value)) return fmtNum(value, 0);
  const places = Math.abs(value) >= 1 ? 4 : 6;
  return fmtNum(value, places);
}

function moneyText(value: number, currency: string): string {
  if (currency === "USD" || currency === "ZAR") return fmtDisplayMoney(value, currency);
  return currency ? `${fmtNum(value, 2)} ${currency}` : fmtNum(value, 2);
}

/** Text for one cell. Null means the cell is omitted, including a missing cost or P&L. */
export function portalLineText(line: LookthroughLine, column: LookthroughColumn): string | null {
  if (column === "name") return line.name;
  const amount = columnAmount(line, column);
  if (amount == null) return null;
  if (column === "quantity") return quantityText(amount);
  if (column === "expNav") return fmtPct(amount, 2);
  const currency = column === "zarValue" || column === "zarExposure" ? "ZAR" : line.currency;
  return moneyText(amount, currency);
}

/** Money figures and quantities are masked. Names and the EXP / NAV percent stay visible. */
export function lookthroughColumnMasked(column: LookthroughColumn): boolean {
  return column !== "name" && column !== "expNav";
}

/** Columns that have a value on at least one line. A null field does not add a column of zeros. */
export function lookthroughColumns(group: LookthroughGroup): LookthroughColumn[] {
  const cash = group.lines.length > 0 && group.lines.every((line) => line.kind === "cash");
  const candidates = cash ? CASH_COLUMNS : INSTRUMENT_COLUMNS;
  return candidates.filter((column) => column === "name" || group.lines.some((line) => portalLineText(line, column) != null));
}

export function parseDrillStep(raw: string | null): DrillStep {
  if (raw === "weib" || raw === "eib") return raw;
  return "investment";
}

/** What the current screen shows, and the next layer the user can open. */
export function layerForStep(root: InvestmentLayer | null, step: DrillStep): { current: InvestmentLayer | null; next: InvestmentLayer | null } {
  if (!root || step === "investment") return { current: null, next: root?.kind === "weib" ? root : null };
  if (step === "weib") {
    if (root.kind !== "weib") return { current: null, next: null };
    return { current: root, next: root.inside?.kind === "eib" ? root.inside : null };
  }
  const eib = root.kind === "eib" ? root : root.inside?.kind === "eib" ? root.inside : null;
  return { current: eib, next: null };
}

/** Outside layer first, then each nested book. The array is a view, not a copy of the lines. */
export function layerChain(root: InvestmentLayer | null): InvestmentLayer[] {
  const chain: InvestmentLayer[] = [];
  let cursor = root;
  while (cursor) {
    chain.push(cursor);
    cursor = cursor.inside;
  }
  return chain;
}

function bookHasLines(layer: InvestmentLayer): boolean {
  const lines = lookthroughLines(layer);
  return !!lines && lines !== "unavailable" && (lines.assets.length > 0 || lines.cash.length > 0);
}

/**
 * Book shown on the investment page. The deepest layer that already has lines
 * wins, so a trust page opens on the EIB tables and a personal page opens on
 * its WEIB book when no child lines were returned. The parent layer is not
 * given those lines, and an `assets` array is not copied onto it.
 */
export function investmentBook(root: InvestmentLayer | null): InvestmentLayer | null {
  const chain = layerChain(root);
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const layer = chain[index];
    if (layer && bookHasLines(layer)) return layer;
  }
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const layer = chain[index];
    if (layer && lookthroughLines(layer) === "unavailable") return layer;
  }
  return null;
}

export function investmentPath(asset: string, step: DrillStep = "investment"): string {
  const path = `/portfolio/${encodeURIComponent(asset)}`;
  if (step === "investment") return path;
  return `${path}?inside=${step}`;
}

export type CostVersusMarket = {
  /** Absolute distance from the comparison base, in percent points. 4.2 means 4,2%. */
  percent: number;
  percentText: string;
  /** True when the position is ahead of its cost. The chip is green then, and red when this is false. */
  favourable: boolean;
  /** Portal P&L, formatted. Null when the portal left it blank. */
  pnlText: string | null;
  /** South African percent only. Colour carries the direction. The P&L amount stays separate so discreet mode can mask it. */
  label: string;
};

/** Green when the position is ahead of its cost. Red when it is behind. */
export function costIndicationClass(favourable: boolean): "text-gain" | "text-loss" {
  return favourable ? "text-gain" : "text-loss";
}

/**
 * How far a position is ahead of or behind its cost.
 * A long uses market price versus cost price. A short uses the portal P&L against the premium
 * received, abs(quantity) * cost price. Negative P&L on a short is premium given back.
 * The amount beside market value is that P&L, never the market value.
 * Missing prices, a zero cost, cash, and a short with no portal P&L are omitted.
 */
export function costVersusMarket(line: LookthroughLine): CostVersusMarket | null {
  if (line.kind === "cash") return null;
  const cost = line.costPrice;
  const market = line.marketPrice;
  if (cost == null || market == null || cost === 0) return null;

  const quantity = line.quantity;
  let ratio: number;
  let favourable: boolean;
  if (quantity != null && quantity < 0) {
    const pnl = line.pnl;
    if (pnl == null) return null;
    const premium = Math.abs(quantity) * cost;
    if (!Number.isFinite(premium) || premium === 0) return null;
    ratio = pnl / premium;
    favourable = pnl >= 0;
  } else {
    ratio = (market - cost) / cost;
    if (!Number.isFinite(ratio) || ratio === 0) return null;
    favourable = market > cost;
  }
  if (!Number.isFinite(ratio)) return null;

  const percent = Math.abs(ratio) * 100;
  const percentText = fmtPct(percent, 1);
  const pnlText = line.pnl == null ? null : portalLineText(line, "pnl");
  return {
    percent,
    percentText,
    favourable,
    pnlText,
    label: percentText,
  };
}

export type OptionRight = "put" | "call";
export type OptionMoneyness = "in the money" | "out of the money" | "near";
export type OptionHealthState = "healthy" | "watch" | "at risk";

export type ParsedOption = {
  ticker: string;
  right: OptionRight;
  strike: number;
  expiryText: string;
  expiry: { year: number; month: number; day: number };
};

export type OptionHealth = {
  right: OptionRight;
  position: "sold" | "bought" | null;
  strike: number;
  expiryText: string;
  /** Whole calendar days until expiry in Johannesburg. Negative after the expiry date. Null when today cannot be read. */
  daysLeft: number | null;
  expired: boolean;
  spot: number | null;
  moneyness: OptionMoneyness | null;
  cushionText: string | null;
  health: OptionHealthState | null;
  /** Compact line without the health word. */
  detail: string;
  /** Detail plus the health word when the position side is known and a spot exists. */
  summary: string;
};

const OPTION_TEXT =
  /^([A-Za-z][A-Za-z0-9.]*)(?:\s+[A-Za-z]{2,3})?\s+(\d{1,2})\/(\d{1,2})\/(\d{2})\s+([PpCc])(\d+(?:[.,]\d+)?)(?:\s|$)/;

function isRealCalendarDay(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || year < 2000) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/** Listed option in the portal's "TICKER US MM/DD/YY P|C strike" shape. Anything else is left alone. */
export function parseOptionText(value: string): ParsedOption | null {
  const match = OPTION_TEXT.exec(value.trim());
  if (!match) return null;
  const ticker = match[1]?.toUpperCase();
  const month = Number(match[2]);
  const day = Number(match[3]);
  const year = 2000 + Number(match[4]);
  const rightToken = match[5]?.toUpperCase();
  const strike = Number((match[6] ?? "").replace(",", "."));
  if (!ticker || (rightToken !== "P" && rightToken !== "C")) return null;
  if (!Number.isFinite(strike) || strike <= 0) return null;
  if (!isRealCalendarDay(year, month, day)) return null;
  const expiry = { year, month, day };
  const isoMonth = String(month).padStart(2, "0");
  const isoDay = String(day).padStart(2, "0");
  return {
    ticker,
    right: rightToken === "P" ? "put" : "call",
    strike,
    expiry,
    expiryText: fmtDate(`${year}-${isoMonth}-${isoDay}T12:00:00+02:00`),
  };
}

/** Option identity from the instrument code or the name. Non-derivatives and unknown text stay null. */
export function parseOptionContract(line: LookthroughLine): ParsedOption | null {
  if (line.kind !== "derivative") return null;
  const fromCode = line.instrumentCode ? parseOptionText(line.instrumentCode) : null;
  if (fromCode) return fromCode;
  return parseOptionText(line.name);
}

function johannesburgDay(value: Date): { year: number; month: number; day: number } | null {
  const parts = new Intl.DateTimeFormat("en-ZA", {
    timeZone: JOHANNESBURG_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  if (!isRealCalendarDay(year, month, day)) return null;
  return { year, month, day };
}

function calendarIndex(day: { year: number; month: number; day: number }): number {
  return Math.floor(Date.UTC(day.year, day.month - 1, day.day) / 86_400_000);
}

function startsWithTicker(value: string, ticker: string): boolean {
  const text = value.trim().toUpperCase();
  const key = ticker.toUpperCase();
  if (key.length === 0 || !text.startsWith(key)) return false;
  const next = text.charAt(key.length);
  return next === "" || next === " " || next === "-" || next === "/";
}

function strikeText(strike: number): string {
  if (Number.isInteger(strike)) return fmtNum(strike, 0);
  const tenths = strike * 10;
  if (Math.abs(tenths - Math.round(tenths)) < 1e-6) return fmtNum(strike, 1);
  return fmtNum(strike, 2);
}

/** Spot is another line in this book whose code or name starts with the ticker. Option premiums are not a spot. */
function underlyingSpot(book: readonly LookthroughLine[], optionLine: LookthroughLine, ticker: string): number | null {
  let best: { price: number; rank: number } | null = null;
  for (const line of book) {
    if (line === optionLine || line.kind === "cash" || line.kind === "derivative") continue;
    if (parseOptionText(line.instrumentCode ?? "") || parseOptionText(line.name)) continue;
    if (line.marketPrice == null) continue;
    const code = line.instrumentCode ?? "";
    const codeHit = startsWithTicker(code, ticker);
    const nameHit = startsWithTicker(line.name, ticker);
    if (!codeHit && !nameHit) continue;
    const exact = code.trim().toUpperCase() === ticker.toUpperCase();
    const rank = exact ? 0 : line.kind === "equity" ? 1 : 2;
    if (!best || rank < best.rank) best = { price: line.marketPrice, rank };
  }
  return best ? best.price : null;
}

function cushionText(spot: number, strike: number): string {
  if (spot === strike) return "spot at strike";
  const percentText = fmtPct((Math.abs(spot - strike) / strike) * 100, 1);
  return spot > strike ? `spot ${percentText} above strike` : `spot ${percentText} below strike`;
}

/**
 * Moneyness from spot versus strike. Near is within 2% of the strike.
 * A put is in the money below the strike. A call is in the money above it.
 * Health follows the position: a sold option wants to be out of the money, a bought option the opposite.
 * Deeply on the wrong side is at risk. Near the strike, or inside 14 days while not comfortably on the right side, is watch.
 */
function judgeOption(
  right: OptionRight,
  position: "sold" | "bought",
  spot: number,
  strike: number,
  daysLeft: number | null,
): { moneyness: OptionMoneyness; health: OptionHealthState } {
  const distance = Math.abs(spot - strike) / strike;
  const near = distance <= 0.02;
  const above = spot > strike;
  const below = spot < strike;
  const inTheMoney = right === "put" ? below : above;
  const outOfTheMoney = right === "put" ? above : below;
  const moneyness: OptionMoneyness = near ? "near" : inTheMoney ? "in the money" : "out of the money";
  const sold = position === "sold";
  const comfortable = sold ? outOfTheMoney && !near : inTheMoney && !near;
  const threatened = sold ? inTheMoney && !near : outOfTheMoney && !near;
  const expiring = daysLeft != null && daysLeft >= 0 && daysLeft <= 14;
  if (threatened) return { moneyness, health: "at risk" };
  if (near || (expiring && !comfortable)) return { moneyness, health: "watch" };
  return { moneyness, health: "healthy" };
}

function moneynessOnly(right: OptionRight, spot: number, strike: number): OptionMoneyness {
  const near = Math.abs(spot - strike) / strike <= 0.02;
  if (near) return "near";
  const inTheMoney = right === "put" ? spot < strike : spot > strike;
  return inTheMoney ? "in the money" : "out of the money";
}

/**
 * Compact option line for one derivative row.
 * Spot comes only from another line in the same book. A missing spot skips moneyness and health.
 */
export function optionHealth(line: LookthroughLine, book: readonly LookthroughLine[], now = new Date()): OptionHealth | null {
  const parsed = parseOptionContract(line);
  if (!parsed) return null;
  const position = line.quantity == null || line.quantity === 0 ? null : line.quantity < 0 ? "sold" : "bought";
  const today = johannesburgDay(now);
  const daysLeft = today ? calendarIndex(parsed.expiry) - calendarIndex(today) : null;
  const expired = daysLeft != null && daysLeft < 0;
  const rightLabel = parsed.right === "put" ? "Put" : "Call";
  const parts = [position ? `${rightLabel} ${position}` : rightLabel, `strike ${strikeText(parsed.strike)}`, parsed.expiryText];
  if (expired) parts.push("expired");
  else if (daysLeft != null) parts.push(daysLeft === 1 ? "1 day" : `${daysLeft} days`);
  const spot = underlyingSpot(book, line, parsed.ticker);
  if (spot == null) {
    parts.push("spot is not in this book");
    const detail = parts.join(" · ");
    return {
      right: parsed.right,
      position,
      strike: parsed.strike,
      expiryText: parsed.expiryText,
      daysLeft,
      expired,
      spot: null,
      moneyness: null,
      cushionText: null,
      health: null,
      detail,
      summary: detail,
    };
  }
  const cushion = cushionText(spot, parsed.strike);
  parts.push(cushion);
  const judged = position ? judgeOption(parsed.right, position, spot, parsed.strike, daysLeft) : null;
  const moneyness = judged ? judged.moneyness : moneynessOnly(parsed.right, spot, parsed.strike);
  parts.push(moneyness);
  const detail = parts.join(" · ");
  const health = judged ? judged.health : null;
  return {
    right: parsed.right,
    position,
    strike: parsed.strike,
    expiryText: parsed.expiryText,
    daysLeft,
    expired,
    spot,
    moneyness,
    cushionText: cushion,
    health,
    detail,
    summary: health ? `${detail} · ${health}` : detail,
  };
}

export function productLabel(product: string): string {
  if (product === "brokerage") return "Brokerage";
  if (product === "perec-as") return "Asset swap";
  if (product === "perec-weib") return "WEIB";
  if (product === "perec-eib") return "EIB";
  return product;
}
