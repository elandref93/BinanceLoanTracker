import { logger } from "../logger";
import { childProfileForLabel, ensureChildProfiles } from "./childProfiles";
import type { ContainerInfo, PortfolioState, Position, StatementFlow, StatementPoint, StatementSeries } from "./types";

export type InvestmentPoint = {
  date: string;
  value: number | null;
  currency: string;
  change: number | null;
  product: string;
};

/** One drill-down layer. `value` stays null when every point is null. */
export type InvestmentLayer = {
  kind: "weib" | "eib";
  name: string;
  value: number | null;
  currency: string;
  points: InvestmentPoint[];
  inside: InvestmentLayer | null;
};

export const PICKLE_RICK_EXCHANGE = "pickle_rick" as const;
export const PICKLE_RICK_PLACE = "Pickle Rick";

const HOLDINGS_URL = "https://srv1516004.hstgr.cloud/pickle-rick/holdings";

/** Trust asset-swap holding. Profile is Trust · WLDD. */
const TRUST_AS_KEY = "investment:1";
const TRUST_ACCOUNT = "0433383";
/** Personal asset-swap holding. Profile is Personal. */
const PERSONAL_AS_KEY = "investment:3";
const PERSONAL_ACCOUNT = "0454918";

export type PickleFailure = 401 | 503;

export type PickleOutcome =
  | { status: "skipped" }
  | { status: "ok"; positions: Position[]; prices: Record<string, number>; series: StatementSeries[] }
  | { status: "error"; code: PickleFailure };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function mentionsExchange(parts: string[]): boolean {
  const haystack = parts.join("\n").toLowerCase();
  return haystack.includes("binance") || haystack.includes("luno");
}

function rowMentionsExchange(row: Record<string, unknown>): boolean {
  return mentionsExchange([text(row.institution), text(row.name), text(row.asset), text(row.source)]);
}

function positionMentionsExchange(position: Position): boolean {
  return position.exchange === PICKLE_RICK_EXCHANGE && mentionsExchange([position.wallet, position.linkName, position.asset]);
}

/** Personal profile already used for this user's Binance and Luno accounts. */
function personalProfileId(containers: readonly ContainerInfo[]): string | null {
  const personal = containers.filter((container) => container.type === "personal");
  const named = personal.find((container) => /\bpersonal\b/i.test(container.name));
  return (named ?? personal[0])?.id ?? null;
}

/** Trust profile whose name is WLDD, already used for the trust's exchange accounts. */
function wlddProfileId(containers: readonly ContainerInfo[]): string | null {
  return containers.find((container) => /\bwldd\b/i.test(container.name))?.id ?? null;
}

function profileForAccount(account: string, containers: readonly ContainerInfo[]): string | null {
  if (account === TRUST_ACCOUNT) return wlddProfileId(containers);
  if (account === PERSONAL_ACCOUNT) return personalProfileId(containers);
  return null;
}

/** Trust and personal Peresec keys stay on those profiles even if a label mentions someone else. */
function isUserPeresecLink(linkId: string): boolean {
  if (linkId === TRUST_AS_KEY || linkId === PERSONAL_AS_KEY) return true;
  const account = linkId.split("|")[0] ?? "";
  return account === TRUST_ACCOUNT || account === PERSONAL_ACCOUNT;
}

/** Asset-swap profiles come from the holding key. Other rows are not guessed from their names. */
function profileForLink(linkId: string, containers: readonly ContainerInfo[]): string | null {
  if (linkId === TRUST_AS_KEY) return wlddProfileId(containers);
  if (linkId === PERSONAL_AS_KEY) return personalProfileId(containers);
  return profileForAccount(linkId.split("|")[0] ?? "", containers);
}

/** Interactive Brokers lines created from the Flex report. Holdings rows keep their own keys. */
function isIbkrLink(linkId: string): boolean {
  return linkId.startsWith("ibkr:");
}

function ibkrProfile(linkId: string, containers: readonly ContainerInfo[]): string | null {
  return linkId.startsWith("ibkr:trust:") ? wlddProfileId(containers) : personalProfileId(containers);
}

function labelParts(row: Record<string, unknown>): string[] {
  return ["key", "name", "institution", "holder", "asset", "source", "place", "account_type", "product", "wallet"].flatMap((field) => {
    const value = text(row[field]);
    return value ? [value] : [];
  });
}

/** A child's own row when exactly one child is named. Trust and personal Peresec, and Interactive Brokers report lines, are never moved. */
function profileForRow(linkId: string, labels: readonly string[], containers: readonly ContainerInfo[]): string | null {
  if (isUserPeresecLink(linkId)) return profileForLink(linkId, containers);
  if (isIbkrLink(linkId)) return ibkrProfile(linkId, containers);
  return childProfileForLabel(labels) ?? profileForLink(linkId, containers);
}

function assignProfile(position: Position, containers: readonly ContainerInfo[]): Position {
  if (position.exchange !== PICKLE_RICK_EXCHANGE) return position;
  const containerId = profileForRow(position.linkId, [position.linkName, position.wallet, position.asset, position.linkId], containers);
  if (!containerId) return position;
  return position.containerId === containerId ? position : { ...position, containerId };
}

function uniqueAsset(name: string, key: string, used: Set<string>): string {
  const base = name || key || "Holding";
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  const qualified = key && !base.endsWith(key) ? `${base} (${key})` : `${base} #${used.size + 1}`;
  used.add(qualified);
  return qualified;
}

function normaliseCurrency(raw: string): string {
  const code = raw.trim().toUpperCase();
  if (code === "USD" || code === "US$" || code === "$" || code === "DOLLAR" || code === "DOLLARS") return "USD";
  if (code === "ZAR" || code === "RAND" || code === "RANDS") return "ZAR";
  return code;
}

function finiteNumber(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function readPoint(row: Record<string, unknown>): StatementPoint | null {
  const date = text(row.date).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const value = finiteNumber(row.value);
  if (value === undefined) return null;
  const change = finiteNumber(row.change);
  return {
    date,
    value,
    currency: normaliseCurrency(text(row.currency)),
    change: change === undefined ? null : change,
    product: text(row.product).toLowerCase(),
  };
}

function pointList(row: Record<string, unknown>): Record<string, unknown>[] {
  for (const field of ["history", "points", "values", "series"]) {
    const nested = row[field];
    if (Array.isArray(nested)) return nested.filter(isRecord);
  }
  return [];
}

/** Brokerage is the statement row. Later portal days are perec-as. Both stay on the asset-swap series. */
function isAsProduct(product: string): boolean {
  return product === "brokerage" || product === "perec-as";
}

function addPoints(target: StatementPoint[], incoming: readonly StatementPoint[], asOnly: boolean): void {
  const seen = new Set(target.map((point) => `${point.date}|${point.product}`));
  for (const point of incoming) {
    if (asOnly && !isAsProduct(point.product)) continue;
    const id = `${point.date}|${point.product}`;
    if (seen.has(id)) continue;
    seen.add(id);
    target.push(point);
  }
}

function accountOf(row: Record<string, unknown>, key: string): string {
  const explicit = text(row.account_number);
  if (explicit) return explicit;
  const head = key.split("|")[0] ?? "";
  if (head === TRUST_ACCOUNT || head === PERSONAL_ACCOUNT) return head;
  return "";
}

function productOf(row: Record<string, unknown>, key: string): string {
  const explicit = text(row.product).toLowerCase();
  if (explicit) return explicit;
  if (key.endsWith("|perec-weib")) return "perec-weib";
  if (key.endsWith("|perec-eib")) return "perec-eib";
  if (key.endsWith("|perec-as")) return "perec-as";
  return "";
}

function sideKind(account: string, product: string, key: string): "weib" | "eib" | null {
  const fromKey = key.endsWith("|perec-weib") ? "perec-weib" : key.endsWith("|perec-eib") ? "perec-eib" : "";
  const prod = product || fromKey;
  if (prod !== "perec-weib" && prod !== "perec-eib") return null;
  if (fromKey && product && fromKey !== product) return null;
  if (account !== TRUST_ACCOUNT && account !== PERSONAL_ACCOUNT) return null;
  return prod === "perec-weib" ? "weib" : "eib";
}

interface RawSeries {
  key: string;
  account: string;
  product: string;
  currency: string;
  name: string;
  points: StatementPoint[];
  flows: StatementFlow[];
}

function collectHistory(body: Record<string, unknown>): RawSeries[] {
  const history = Array.isArray(body.history) ? body.history : [];
  const grouped = new Map<string, RawSeries>();
  const ensure = (key: string, row: Record<string, unknown>): RawSeries => {
    const existing = grouped.get(key);
    if (existing) return existing;
    const created: RawSeries = {
      key,
      account: accountOf(row, key),
      product: productOf(row, key),
      currency: normaliseCurrency(text(row.currency)),
      name: text(row.name),
      points: [],
      flows: [],
    };
    grouped.set(key, created);
    return created;
  };
  for (const item of history) {
    if (!isRecord(item)) continue;
    const nested = pointList(item);
    const flat = nested.length === 0 ? readPoint(item) : null;
    if (flat) {
      const key = text(item.key) || `${accountOf(item, "")}|${flat.product}`;
      if (!key) continue;
      const series = ensure(key, item);
      if (!series.product) series.product = flat.product || productOf(item, key);
      if (!series.currency) series.currency = flat.currency;
      if (!flat.currency) flat.currency = series.currency;
      series.points.push(flat);
      const flatFlow = readStatementFlow(item, series.currency);
      if (flatFlow) series.flows.push(flatFlow);
      continue;
    }
    const key = text(item.key);
    if (!key) continue;
    const series = ensure(key, item);
    if (!series.account) series.account = accountOf(item, key);
    if (!series.product) series.product = productOf(item, key);
    if (!series.currency) series.currency = normaliseCurrency(text(item.currency));
    if (!series.name) series.name = text(item.name);
    for (const point of nested) {
      const parsed = readPoint(point);
      if (!parsed) continue;
      if (!parsed.currency) parsed.currency = series.currency;
      series.points.push(parsed);
      const nestedFlow = readStatementFlow(point, series.currency);
      if (nestedFlow) series.flows.push(nestedFlow);
    }
  }
  return [...grouped.values()];
}

/**
 * Contributions and withdrawals on a statement row are external cash.
 * Both are amounts paid in or taken out. A row that does not carry those
 * fields has no flow ledger.
 */
function readStatementFlow(row: Record<string, unknown>, fallbackCurrency: string): StatementFlow | null {
  if (!("contributions" in row) && !("withdrawals" in row)) return null;
  const contributions = finiteNumber(row.contributions);
  const withdrawals = finiteNumber(row.withdrawals);
  if (contributions === undefined || withdrawals === undefined) return null;
  const net = (contributions ?? 0) - (withdrawals ?? 0);
  if (!(net !== 0) || !Number.isFinite(net)) return null;
  const date = text(row.date).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return { date, amount: net, currency: normaliseCurrency(text(row.currency)) || fallbackCurrency };
}

function rememberFlow(series: StatementSeries, row: Record<string, unknown>): void {
  const flow = readStatementFlow(row, series.currency);
  if (!flow) return;
  const flows = series.flows ?? [];
  const id = `${flow.date}|${flow.amount}|${flow.currency}`;
  if (flows.some((item) => `${item.date}|${item.amount}|${item.currency}` === id)) return;
  flows.push(flow);
  series.flows = flows;
}

function pricedBalance(amount: number | null, currency: string, fx: number | null): { qty: number; unitUsd: number; balanceKnown: boolean } {
  if (amount == null) return { qty: 0, unitUsd: 0, balanceKnown: false };
  if (currency === "USD") return { qty: amount, unitUsd: 1, balanceKnown: true };
  if (currency === "ZAR" && fx != null && fx > 0) return { qty: amount, unitUsd: 1 / fx, balanceKnown: true };
  return { qty: 0, unitUsd: 0, balanceKnown: false };
}

const IDENTITY_KEYS = new Set([
  "street",
  "street1",
  "street2",
  "address",
  "address1",
  "address2",
  "city",
  "postal",
  "postalcode",
  "zip",
  "zipcode",
  "email",
  "primaryemail",
  "emailaddress",
  "dateofbirth",
  "dob",
  "birthdate",
  "phone",
  "mobile",
  "telephone",
]);

function isIdentityKey(key: string): boolean {
  return IDENTITY_KEYS.has(key.toLowerCase().replace(/[^a-z]/g, ""));
}

/** Drops street address, email, phone, and date of birth before any field is copied. */
function stripIdentity(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripIdentity);
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (isIdentityKey(key)) continue;
    out[key] = stripIdentity(item);
  }
  return out;
}

function amount(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return typeof parsed === "number" ? parsed : null;
}

function records(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  return isRecord(value) ? [value] : [];
}

function safeToken(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 40);
}

function formatShare(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 1e8) / 1e8);
}

function isBrokerAccount(position: Position): boolean {
  if (position.parentLinkId || position.includeInTotal === false) return false;
  return /interactive brokers|\bibkr\b/i.test(`${position.wallet}\n${position.linkName}\n${position.asset}`);
}

function reportSaysTrust(account: Record<string, unknown>, view: Record<string, unknown>, holdingsRow: Record<string, unknown> | null): boolean {
  if (holdingsRow?.trust_owned === true || account.trust_owned === true || view.trust_owned === true) return true;
  return /\btrust\b/i.test(`${text(account.account_type)}\n${text(account.entity_type)}`);
}

function readNav(source: Record<string, unknown>): number | null {
  const direct = amount(source.nav_value);
  if (direct != null) return direct;
  if (typeof source.nav === "number") return amount(source.nav);
  if (isRecord(source.nav)) {
    const ending = amount(source.nav.ending_value);
    if (ending != null) return ending;
  }
  if (isRecord(source.equity_latest)) return amount(source.equity_latest.total);
  return null;
}

interface IbkrAccountView {
  accountId: string;
  currency: string;
  trust: boolean;
  nav: number | null;
  positions: Record<string, unknown>[];
  cash: Record<string, unknown>[];
  equity: Record<string, unknown>[];
}

/** Empty section is the account view. `all` carries the same view plus every detail section. */
function readIbkrView(view: Record<string, unknown>): IbkrAccountView | null {
  const section = text(view.section).toLowerCase() || "overview";
  const report = isRecord(view.report) ? view.report : null;
  const account = (report && isRecord(report.account) ? report.account : null) ?? (isRecord(view.account) ? view.account : {});
  const source = report ?? view;
  const namedDetail = report == null && section !== "overview" && section !== "all";
  const positions = namedDetail && section !== "positions" ? [] : records(source.positions ?? view.positions);
  const cash = namedDetail && section !== "cash" ? [] : records(source.cash ?? view.cash);
  const equity = namedDetail && section !== "equity_history" ? [] : records(source.equity_history ?? view.equity_history);
  const nav = !namedDetail || section === "nav" ? readNav(source) : null;
  if (nav == null && positions.length === 0 && cash.length === 0 && equity.length === 0) return null;
  return {
    accountId: text(account.account_id) || text(view.account_id),
    currency: normaliseCurrency(text(account.currency) || text(view.currency) || "USD"),
    trust: reportSaysTrust(account, view, null),
    nav,
    positions,
    cash,
    equity,
  };
}

function holdingsRow(record: Record<string, unknown>, linkId: string): Record<string, unknown> | null {
  const holdings = Array.isArray(record.holdings) ? record.holdings : [];
  for (const row of holdings) {
    if (isRecord(row) && text(row.key) === linkId) return row;
  }
  return null;
}

function dropRolledUp(positions: Position[], parentId: string): void {
  for (let index = positions.length - 1; index >= 0; index -= 1) {
    if (positions[index]?.parentLinkId === parentId) positions.splice(index, 1);
  }
}

/** Calendar day from an ISO date or an IB compact stamp such as 20260730;120000. */
function isoDay(raw: string): string | null {
  if (!raw) return null;
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  if (iso?.[1]) return iso[1];
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8) return null;
  const compact = digits.slice(0, 8);
  const year = Number(compact.slice(0, 4));
  const month = Number(compact.slice(4, 6));
  const day = Number(compact.slice(6, 8));
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}

function flowDay(row: Record<string, unknown>): string | null {
  for (const key of ["date", "date_time", "settle_date", "report_date"]) {
    const day = isoDay(text(row[key]));
    if (day) return day;
  }
  return null;
}

/**
 * Deposits and withdrawals are external. Dividends, interest, fees, and tax
 * stay inside the return. A transfer that is not clearly a deposit or
 * withdrawal is left out rather than guessed.
 */
function externalCashKind(type: string, description: string): "external" | "inside" | "unknown" {
  const haystack = `${type} ${description}`.toLowerCase();
  if (/(dividend|interest|commission|\bfees?\b|\btax\b|withholding)/.test(haystack)) return "inside";
  if (/(deposit|withdraw|wire|\bach\b|asset transfer)/.test(haystack)) return "external";
  if (haystack.includes("transfer")) return "unknown";
  return "unknown";
}

function signedFlowAmount(row: Record<string, unknown>): number | null {
  const direct = amount(row.amount);
  if (direct != null && direct !== 0) return direct;
  const credit = amount(row.credit);
  const debit = amount(row.debit);
  if (credit == null && debit == null) return direct;
  const net = (credit ?? 0) - Math.abs(debit ?? 0);
  return net !== 0 && Number.isFinite(net) ? net : null;
}

function flowsFromRows(rows: Record<string, unknown>[], accountCurrency: string): StatementFlow[] {
  const flows: StatementFlow[] = [];
  for (const row of rows) {
    const kind = externalCashKind(text(row.type) || text(row.activity) || text(row.activity_code), text(row.description));
    if (kind !== "external") continue;
    const signed = signedFlowAmount(row);
    const date = flowDay(row);
    if (signed == null || !date) continue;
    const currency = normaliseCurrency(text(row.currency)) || accountCurrency;
    if (!currency) continue;
    flows.push({ date, amount: signed, currency });
  }
  return flows;
}

/**
 * Dated external cash for one Flex view. Cash transactions are the ledger.
 * The statement-of-funds lines are used only when that ledger is absent, so
 * the same deposit is not removed twice. Descriptions are not stored.
 */
function ibkrExternalFlows(view: Record<string, unknown>, accountCurrency: string): StatementFlow[] | undefined {
  const report = isRecord(view.report) ? view.report : null;
  const source = report ?? view;
  if ("cash_transactions" in source) return flowsFromRows(records(source.cash_transactions), accountCurrency);
  if ("funds" in source) return flowsFromRows(records(source.funds), accountCurrency);
  return undefined;
}

/**
 * The Flex report on `interactive_brokers`. Net asset value is the account
 * balance. Open positions and ending cash are nested on it and are not added
 * again. Equity history is that account's chart. Trades and the other named
 * sections are not summed into the balance or into net worth. Deposits and
 * withdrawals are kept as external flows and are not added to the balance.
 */
function attachInteractiveBrokers(
  record: Record<string, unknown>,
  fx: number | null,
  containers: readonly ContainerInfo[],
  positions: Position[],
  prices: Record<string, number>,
  used: Set<string>,
  series: StatementSeries[],
): void {
  const block = stripIdentity(record.interactive_brokers);
  if (!isRecord(block)) return;
  const views = Array.isArray(block.accounts) ? block.accounts.filter(isRecord) : [block];
  const claimed = new Set<string>();
  views.forEach((view, index) => {
    const parsed = readIbkrView(view);
    if (!parsed) return;
    const open = positions.filter((position) => isBrokerAccount(position) && !claimed.has(position.linkId));
    const named = parsed.accountId ? open.find((position) => `${position.linkName}\n${position.asset}\n${position.linkId}`.includes(parsed.accountId)) : undefined;
    const existing = named ?? (open.length === 1 ? open[0] : undefined);
    const matchedHoldings = existing ? holdingsRow(record, existing.linkId) : null;
    const trust = parsed.trust || matchedHoldings?.trust_owned === true;
    const token = safeToken(parsed.accountId) || `account-${index + 1}`;
    const linkId = `ibkr:${trust ? "trust:" : ""}${token}`;
    const containerId = trust ? wlddProfileId(containers) : personalProfileId(containers);
    const replacingLines = parsed.positions.length > 0 || parsed.cash.length > 0;
    let account: Position;
    if (existing && !positions.some((position) => position.linkId === linkId)) {
      if (replacingLines) dropRolledUp(positions, existing.linkId);
      claimed.add(existing.linkId);
      existing.linkId = linkId;
      existing.containerId = containerId;
      existing.includeInTotal = true;
      delete existing.parentLinkId;
      if (!/interactive brokers|\bibkr\b/i.test(existing.wallet)) existing.wallet = "Interactive Brokers";
      account = existing;
    } else if (positions.some((position) => position.linkId === linkId)) {
      account = positions.find((position) => position.linkId === linkId) as Position;
      account.containerId = containerId;
      account.includeInTotal = true;
    } else {
      const asset = uniqueAsset("Interactive Brokers", linkId, used);
      account = {
        exchange: PICKLE_RICK_EXCHANGE,
        linkId,
        linkName: "Interactive Brokers",
        containerId,
        wallet: "Interactive Brokers",
        asset,
        qty: 0,
        includeInTotal: true,
        balanceKnown: false,
      };
      positions.push(account);
    }
    claimed.add(account.linkId);
    if (parsed.nav != null) {
      const priced = pricedBalance(parsed.nav, parsed.currency, fx);
      account.qty = priced.balanceKnown ? priced.qty : 0;
      account.balanceKnown = priced.balanceKnown;
      if (priced.balanceKnown) prices[account.asset] = priced.unitUsd;
    }
    if (replacingLines) dropRolledUp(positions, account.linkId);
    parsed.positions.forEach((row, line) => {
      const category = text(row.asset_category).toUpperCase();
      const kind = text(row.asset_type).toLowerCase();
      if (category === "CASH" || kind === "cash") return;
      const name = text(row.name) || text(row.symbol) || text(row.description);
      if (!name || mentionsExchange([name, text(row.symbol), text(row.description), text(row.asset)])) return;
      const shares = amount(row.quantity);
      const label = shares == null ? name : `${name} · ${formatShare(shares)}`;
      const lineId = `${account.linkId}|pos:${safeToken(text(row.conid) || text(row.symbol) || String(line + 1)) || line + 1}`;
      if (positions.some((position) => position.linkId === lineId)) return;
      const asset = uniqueAsset(name, lineId, used);
      const lineCurrency = normaliseCurrency(text(row.currency)) || parsed.currency;
      const priced = pricedBalance(amount(row.value), lineCurrency, fx);
      if (priced.balanceKnown) prices[asset] = priced.unitUsd;
      positions.push({
        exchange: PICKLE_RICK_EXCHANGE,
        linkId: lineId,
        linkName: label,
        containerId,
        wallet: "Interactive Brokers",
        asset,
        qty: priced.balanceKnown ? priced.qty : 0,
        includeInTotal: false,
        parentLinkId: account.linkId,
        balanceKnown: priced.balanceKnown,
      });
    });
    const seenCash = new Set<string>();
    const cashRows = parsed.cash.filter((row) => {
      const code = normaliseCurrency(text(row.currency));
      return code.length > 0 && !mentionsExchange([code, text(row.name), text(row.description)]);
    });
    const specific = cashRows.filter((row) => !/base/i.test(normaliseCurrency(text(row.currency))));
    for (const row of (specific.length > 0 ? specific : cashRows)) {
      const rawCode = normaliseCurrency(text(row.currency));
      const code = /base/i.test(rawCode) ? parsed.currency || "Cash" : rawCode;
      if (!code || seenCash.has(code)) continue;
      const ending = amount(row.ending_cash) ?? amount(row.endingCash);
      const value = ending != null ? ending : amount(row.amount);
      if (value == null) continue;
      seenCash.add(code);
      const lineId = `${account.linkId}|cash:${safeToken(code)}`;
      const label = code === "Cash" ? "Cash" : `${code} cash`;
      const asset = uniqueAsset(label, lineId, used);
      const priced = pricedBalance(value, code === "Cash" ? parsed.currency : code, fx);
      if (priced.balanceKnown) prices[asset] = priced.unitUsd;
      positions.push({
        exchange: PICKLE_RICK_EXCHANGE,
        linkId: lineId,
        linkName: label,
        containerId,
        wallet: "Interactive Brokers",
        asset,
        qty: priced.balanceKnown ? priced.qty : 0,
        includeInTotal: false,
        parentLinkId: account.linkId,
        balanceKnown: priced.balanceKnown,
      });
    }
    const points: StatementPoint[] = [];
    for (const row of parsed.equity) {
      const date = text(row.date).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const pointCurrency = normaliseCurrency(text(row.currency)) || parsed.currency;
      points.push({
        date,
        value: amount(row.total),
        currency: pointCurrency,
        change: null,
        product: "equity",
      });
    }
    points.sort((a, b) => a.date.localeCompare(b.date));
    const flows = ibkrExternalFlows(view, parsed.currency);
    if (points.length > 0 && !series.some((item) => item.key === account.linkId && item.kind === "ibkr")) {
      series.push({
        key: account.linkId,
        kind: "ibkr",
        accountNumber: safeToken(parsed.accountId),
        product: "equity",
        containerId,
        asset: account.asset,
        currency: parsed.currency,
        points,
        ...(flows ? { flows } : {}),
      });
    }
  });
  if (claimed.size === 0) return;
  const stale = positions.filter((position) => isBrokerAccount(position) && !claimed.has(position.linkId) && position.balanceKnown === false);
  for (const position of stale) dropRolledUp(positions, position.linkId);
  const staleIds = new Set(stale.map((position) => position.linkId));
  for (let index = positions.length - 1; index >= 0; index -= 1) {
    const position = positions[index];
    if (!position || !staleIds.has(position.linkId)) continue;
    delete prices[position.asset];
    positions.splice(index, 1);
  }
}

/**
 * Maps a Pickle Rick holdings document onto asset-list positions.
 * Current asset-swap balances come only from `holdings[].balance`,
 * `currency`, and `as_of`. Trust is `investment:1` and personal is
 * `investment:3`; those profiles are not chosen by name.
 * Daily asset-swap points keep both `brokerage` and `perec-as`.
 * WEIB and EIB stay on that same investment as drill-down layers. They are
 * not list rows and are not added to the asset-swap balance. A line with
 * `rolls_up_into` is nested on its parent and does not count toward net worth.
 * `interactive_brokers` is the Flex report. Its account balance is the net
 * asset value, on Personal unless that payload says trust. Open positions
 * and ending cash nest on the account and are not added to it. Equity history
 * charts that account only. Deposits and withdrawals are external flows and
 * are not added to the balance. Other report sections are not summed. Address,
 * email, and date of birth are dropped.
 * Rows that mention Binance or Luno are omitted.
 * A row whose name, institution, holder, or other label names exactly one of
 * Laden (statements spell this Landen), Ivelle, or Greyson is filed on that
 * child's profile. Trust and personal Peresec keys are not moved.
 */
export function mapPickleRickHoldings(
  body: unknown,
  fx: number | null,
  containers: readonly ContainerInfo[] = [],
): { positions: Position[]; prices: Record<string, number>; series: StatementSeries[] } {
  const record = isRecord(body) ? body : {};
  const holdings = Array.isArray(record.holdings) ? record.holdings : [];
  const positions: Position[] = [];
  const prices: Record<string, number> = {};
  const used = new Set<string>();
  const series: StatementSeries[] = [];
  const asByKey = new Map<string, StatementSeries>();

  for (const row of holdings) {
    if (!isRecord(row)) continue;
    if (rowMentionsExchange(row)) continue;
    const institution = text(row.institution);
    const key = text(row.key);
    const name = text(row.name) || key || "Holding";
    const linkId = key || name;
    const asset = uniqueAsset(name, linkId, used);
    const rollsUp = text(row.rolls_up_into);
    const currency = normaliseCurrency(text(row.currency));
    const isAs = key === TRUST_AS_KEY || key === PERSONAL_AS_KEY;
    const reported = isAs
      ? typeof row.balance === "number" && Number.isFinite(row.balance)
        ? row.balance
        : null
      : row.balance_known === true && typeof row.balance === "number" && Number.isFinite(row.balance)
        ? row.balance
        : null;
    const priced = pricedBalance(reported, currency, fx);
    if (priced.balanceKnown) prices[asset] = priced.unitUsd;
    const containerId = profileForRow(linkId, labelParts(row), containers);
    positions.push({
      exchange: PICKLE_RICK_EXCHANGE,
      linkId,
      linkName: name,
      containerId,
      wallet: institution,
      asset,
      qty: priced.balanceKnown ? priced.qty : 0,
      includeInTotal: rollsUp.length === 0,
      ...(rollsUp ? { parentLinkId: rollsUp } : {}),
      balanceKnown: priced.balanceKnown,
    });
    if (!isAs) continue;
    const points: StatementPoint[] = [];
    const holdingPoints: StatementPoint[] = [];
    for (const item of pointList(row)) {
      const parsed = readPoint(item);
      if (!parsed) continue;
      if (!parsed.currency) parsed.currency = currency;
      holdingPoints.push(parsed);
    }
    addPoints(points, holdingPoints, true);
    const asOfDay = text(row.as_of).slice(0, 10);
    const asSeries: StatementSeries = {
      key,
      kind: "as",
      accountNumber: text(row.account_number) || (key === TRUST_AS_KEY ? TRUST_ACCOUNT : PERSONAL_ACCOUNT),
      product: "",
      containerId,
      asset,
      currency,
      points,
      ...(/^\d{4}-\d{2}-\d{2}$/.test(asOfDay) ? { asOf: asOfDay } : {}),
    };
    for (const item of pointList(row)) rememberFlow(asSeries, item);
    asByKey.set(key, asSeries);
    series.push(asSeries);
  }

  for (const raw of collectHistory(record)) {
    if (mentionsExchange([raw.name, raw.key])) continue;
    if (raw.key === TRUST_AS_KEY || raw.key === PERSONAL_AS_KEY) {
      const asSeries = asByKey.get(raw.key);
      if (!asSeries) continue;
      addPoints(
        asSeries.points,
        raw.points.map((point) => ({ ...point, currency: point.currency || asSeries.currency })),
        true,
      );
      for (const flow of raw.flows) rememberFlow(asSeries, { date: flow.date, currency: flow.currency, contributions: flow.amount, withdrawals: 0 });
      continue;
    }
    const pointProduct = raw.points.find((point) => point.product === "perec-weib" || point.product === "perec-eib")?.product ?? "";
    const kind = sideKind(raw.account, raw.product || pointProduct, raw.key);
    if (!kind) continue;
    const account = raw.account;
    const parentKey = account === TRUST_ACCOUNT ? TRUST_AS_KEY : account === PERSONAL_ACCOUNT ? PERSONAL_AS_KEY : "";
    const parent = asByKey.get(parentKey);
    if (!parent) continue;
    const linkId = `${account}|perec-${kind}`;
    if (series.some((item) => item.key === linkId)) continue;
    const currency = raw.currency || raw.points.find((point) => point.currency)?.currency || parent.currency || "USD";
    const points: StatementPoint[] = [];
    addPoints(
      points,
      raw.points.map((point) => ({ ...point, currency: point.currency || currency })),
      false,
    );
    points.sort((a, b) => a.date.localeCompare(b.date) || a.product.localeCompare(b.product));
    series.push({
      key: linkId,
      kind,
      accountNumber: account,
      product: kind === "weib" ? "perec-weib" : "perec-eib",
      containerId: parent.containerId,
      asset: parent.asset,
      currency,
      points,
    });
  }

  for (const item of series) {
    if (item.kind === "as") item.points.sort((a, b) => a.date.localeCompare(b.date) || a.product.localeCompare(b.product));
  }
  attachInteractiveBrokers(record, fx, containers, positions, prices, used, series);
  appendChildHistoryPositions(record, fx, containers, positions, prices, used);
  return { positions, prices, series };
}

function isSideLayerKey(key: string, product: string): boolean {
  const haystack = `${key}\n${product}`.toLowerCase();
  return haystack.includes("perec-weib") || haystack.includes("perec-eib");
}

/**
 * Statement series that name a child and are not already a holding become that
 * child's position. The latest finite point is the balance. A series with only
 * null points stays unknown. WEIB and EIB are not turned into list rows.
 */
function appendChildHistoryPositions(
  body: Record<string, unknown>,
  fx: number | null,
  containers: readonly ContainerInfo[],
  positions: Position[],
  prices: Record<string, number>,
  used: Set<string>,
): void {
  const history = Array.isArray(body.history) ? body.history : [];
  const seen = new Set(positions.map((position) => position.linkId));
  const grouped = new Map<string, { labels: string[]; name: string; institution: string; currency: string; amount: number | null; date: string }>();
  for (const item of history) {
    if (!isRecord(item)) continue;
    const key = text(item.key);
    if (!key || seen.has(key) || isUserPeresecLink(key)) continue;
    const product = text(item.product);
    if (isSideLayerKey(key, product)) continue;
    const labels = labelParts(item);
    if (mentionsExchange(labels)) continue;
    const current = grouped.get(key) ?? { labels: [], name: "", institution: "", currency: "", amount: null, date: "" };
    current.labels.push(...labels);
    if (!current.name) current.name = text(item.name) || [text(item.holder), text(item.institution)].filter(Boolean).join(" — ");
    if (!current.institution) current.institution = text(item.institution);
    if (!current.currency) current.currency = normaliseCurrency(text(item.currency));
    const points = [readPoint(item), ...pointList(item).map((point) => readPoint(point))].filter((point): point is StatementPoint => point != null);
    for (const point of points) {
      if (typeof point.value !== "number" || !Number.isFinite(point.value)) continue;
      if (current.date && point.date < current.date) continue;
      current.amount = point.value;
      current.date = point.date;
      if (point.currency) current.currency = point.currency;
    }
    grouped.set(key, current);
  }
  for (const [key, entry] of grouped) {
    const child = childProfileForLabel(entry.labels);
    if (!child) continue;
    const name = entry.name || key;
    const asset = uniqueAsset(name, key, used);
    const currency = entry.currency || "USD";
    const priced = pricedBalance(entry.amount, currency, fx);
    if (priced.balanceKnown) prices[asset] = priced.unitUsd;
    positions.push({
      exchange: PICKLE_RICK_EXCHANGE,
      linkId: key,
      linkName: name,
      containerId: profileForRow(key, entry.labels, containers) ?? child,
      wallet: entry.institution || PICKLE_RICK_PLACE,
      asset,
      qty: priced.balanceKnown ? priced.qty : 0,
      includeInTotal: true,
      balanceKnown: priced.balanceKnown,
    });
  }
}

/** Files child-named statement rows onto child profiles and drops exchange statement rows. */
export function separateChildHoldings(state: PortfolioState): PortfolioState {
  const containers = ensureChildProfiles(state.containers);
  const positions: Position[] = [];
  const dropped = new Set<string>();
  for (const position of state.positions) {
    if (positionMentionsExchange(position)) {
      dropped.add(position.asset);
      continue;
    }
    positions.push(assignProfile(position, containers));
  }
  const prices = { ...state.prices };
  for (const asset of dropped) {
    if (!positions.some((position) => position.asset === asset)) delete prices[asset];
  }
  const statementSeries = state.statementSeries
    ?.filter((item) => !mentionsExchange([item.asset, item.key]))
    .map((item) => {
      if (isUserPeresecLink(item.key) || isSideLayerKey(item.key, item.product) || isIbkrLink(item.key) || item.kind === "ibkr") return item;
      const child = childProfileForLabel([item.asset, item.key]);
      return child ? { ...item, containerId: child } : item;
    });
  return { ...state, containers, positions, prices, ...(statementSeries ? { statementSeries } : {}) };
}

function layerFrom(series: StatementSeries, kind: "weib" | "eib", name: string): InvestmentLayer {
  const points = [...series.points].sort((a, b) => a.date.localeCompare(b.date) || a.product.localeCompare(b.product));
  let value: number | null = null;
  let currency = series.currency;
  for (const point of points) {
    if (typeof point.value !== "number" || !Number.isFinite(point.value)) continue;
    value = point.value;
    if (point.currency) currency = point.currency;
  }
  return {
    kind,
    name,
    value,
    currency,
    points: points.map((point) => ({
      date: point.date,
      value: point.value,
      currency: point.currency || currency,
      change: point.change,
      product: point.product,
    })),
    inside: null,
  };
}

/**
 * WEIB is the layer inside an asset-swap investment. EIB is inside WEIB.
 * Side series match the parent asset, or the same account when an older
 * snapshot stored them under their own names. A null value is kept.
 */
export function investmentLayers(series: readonly StatementSeries[], asset: string): InvestmentLayer | null {
  const parent = series.find((item) => item.kind === "as" && item.asset === asset);
  const account = parent?.accountNumber ?? "";
  const findKind = (kind: "weib" | "eib") =>
    series.find((item) => item.kind === kind && (item.asset === asset || (account !== "" && item.accountNumber === account)));
  const weib = findKind("weib");
  const eib = findKind("eib");
  const eibLayer = eib ? layerFrom(eib, "eib", "EIB") : null;
  if (weib) {
    const layer = layerFrom(weib, "weib", "WEIB");
    layer.inside = eibLayer;
    return layer;
  }
  return eibLayer;
}

/** Keeps the last Pickle Rick rows when the source answers 401 or 503. Exchange statement rows are never kept. */
export function applyPickleRick(state: PortfolioState, previous: PortfolioState | null, outcome: PickleOutcome): void {
  if (outcome.status === "skipped") return;
  if (outcome.status === "ok") {
    const droppedAssets = new Set<string>();
    for (const position of outcome.positions) {
      if (positionMentionsExchange(position)) {
        droppedAssets.add(position.asset);
        continue;
      }
      state.positions.push(assignProfile(position, state.containers));
    }
    for (const [asset, price] of Object.entries(outcome.prices)) {
      if (!droppedAssets.has(asset)) state.prices[asset] = price;
    }
    state.statementSeries = outcome.series.filter((item) => !mentionsExchange([item.asset, item.key]));
    return;
  }
  state.errors.push(`pickle_rick:${outcome.code}`);
  if (!previous) return;
  for (const position of previous.positions) {
    if (position.exchange !== PICKLE_RICK_EXCHANGE || positionMentionsExchange(position)) continue;
    const kept = assignProfile({ ...position }, state.containers);
    state.positions.push(kept);
    const price = previous.prices[kept.asset];
    if (typeof price === "number" && Number.isFinite(price) && price > 0) state.prices[kept.asset] = price;
  }
  if (previous.statementSeries) state.statementSeries = previous.statementSeries.map((item) => ({ ...item, points: [...item.points] }));
}

async function discard(res: Response): Promise<void> {
  await res.arrayBuffer().catch(() => undefined);
}

/** Reads holdings when the token is set. A missing token skips the call. */
export async function loadPickleRick(
  fx: number | null,
  fetchImpl: typeof fetch = fetch,
  containers: readonly ContainerInfo[] = [],
): Promise<PickleOutcome> {
  const token = process.env.PICKLE_RICK_HOLDINGS_TOKEN?.trim();
  if (!token) {
    logger.info({ op: "portfolio.collect.pickle" }, "pickle rick holdings skipped — PICKLE_RICK_HOLDINGS_TOKEN unset");
    return { status: "skipped" };
  }
  try {
    const res = await fetchImpl(HOLDINGS_URL, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401 || res.status === 503) {
      await discard(res);
      logger.warn({ op: "portfolio.collect.pickle", status: res.status }, "pickle rick holdings failed");
      return { status: "error", code: res.status };
    }
    if (!res.ok) {
      await discard(res);
      logger.warn({ op: "portfolio.collect.pickle", status: res.status }, "pickle rick holdings failed");
      return { status: "error", code: 503 };
    }
    const body: unknown = await res.json();
    const mapped = mapPickleRickHoldings(body, fx, containers);
    return { status: "ok", positions: mapped.positions, prices: mapped.prices, series: mapped.series };
  } catch {
    logger.warn({ op: "portfolio.collect.pickle" }, "pickle rick holdings failed");
    return { status: "error", code: 503 };
  }
}
