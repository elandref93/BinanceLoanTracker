import { readRecordByHash } from "../accountStorage";
import { binancePublicGet, createRealBinanceClient, fetchUsdPrices } from "../binance";
import type { PlainAccount } from "../credentialStore";
import { fetchUsdToZar } from "../fx";
import { logger } from "../logger";
import { createRealLunoClient, lunoFetch } from "../luno";
import { applyPickleRick, loadPickleRick, separateChildHoldings } from "./pickleRick";
import { normaliseAsset, STABLECOINS, type ContainerInfo, type DebtPosition, type PortfolioState, type Position } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function targetFrom(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 10 && value <= 95 ? Math.round(value) : null;
}

/** Profiles from the synced accounts record, with each profile's LTV target. */
export async function readContainers(hash: string): Promise<ContainerInfo[]> {
  const [accounts, settingsRecord] = await Promise.all([readRecordByHash(hash, "accounts"), readRecordByHash(hash, "settings")]);
  const settings = isRecord(settingsRecord?.settings) ? settingsRecord.settings : settingsRecord ?? {};
  const globalTarget = targetFrom(settings.targetLtv);
  const overrides = isRecord(settings.targetOverrides) ? settings.targetOverrides : {};
  const raw = Array.isArray(accounts?.containers) ? accounts.containers : [];
  const out: ContainerInfo[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.id !== "string") continue;
    const links = Array.isArray(item.links) ? item.links : [];
    out.push({
      id: item.id,
      name: typeof item.name === "string" ? item.name : "Profile",
      type: item.type === "trust" ? "trust" : "personal",
      linkIds: links.flatMap((link) => (isRecord(link) && typeof link.id === "string" ? [link.id] : [])),
      targetLtv: targetFrom(overrides[item.id]) ?? globalTarget,
    });
  }
  return out;
}

export function linkContainerMap(containers: ContainerInfo[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const container of containers) for (const linkId of container.linkIds) map.set(linkId, container.id);
  return map;
}

/**
 * 24-hour percent by asset from a Binance 24hr ticker payload.
 * The MINI ticker omits `priceChangePercent`; that figure is (last − open) / open.
 * A FULL ticker includes `priceChangePercent`, which is the same number.
 */
export function parseTicker24hPercents(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const rows = Array.isArray(raw) ? raw : isRecord(raw) ? [raw] : [];
  for (const row of rows) {
    if (!isRecord(row) || typeof row.symbol !== "string" || !row.symbol.endsWith("USDT")) continue;
    const asset = row.symbol.slice(0, -4);
    if (!asset) continue;
    const listed = Number(row.priceChangePercent);
    if (Number.isFinite(listed)) {
      out[asset] = listed;
      continue;
    }
    const open = Number(row.openPrice);
    const last = Number(row.lastPrice);
    if (open > 0 && Number.isFinite(last)) out[asset] = ((last - open) / open) * 100;
  }
  return out;
}

async function fetch24hChange(assets: string[]): Promise<Record<string, number>> {
  const wanted = assets.filter((asset) => !STABLECOINS.has(asset) && asset !== "ZAR");
  if (wanted.length === 0) return {};
  try {
    return parseTicker24hPercents(await binancePublicGet("/api/v3/ticker/24hr", { symbols: JSON.stringify(wanted.map((asset) => `${asset}USDT`)), type: "MINI" }));
  } catch {
    const settled = await Promise.allSettled(wanted.map((asset) => binancePublicGet("/api/v3/ticker/24hr", { symbol: `${asset}USDT`, type: "MINI" })));
    return parseTicker24hPercents(settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])));
  }
}

/** Live USD→ZAR: Luno USDC/ZAR mid, then the reference API. */
export async function currentFx(): Promise<{ rate: number | null; source: PortfolioState["fxSource"] }> {
  try {
    const ticker = await lunoFetch<{ bid?: string; ask?: string; last_trade?: string }>("/api/1/ticker?pair=USDCZAR", null);
    const bid = Number(ticker.bid);
    const ask = Number(ticker.ask);
    const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : Number(ticker.last_trade);
    if (mid > 5 && mid < 100) return { rate: mid, source: "luno" };
  } catch {
    // Fall through to the reference rate.
  }
  const reference = await fetchUsdToZar();
  return reference ? { rate: reference, source: "reference" } : { rate: null, source: "none" };
}

/**
 * Reads every linked account once and returns positions per wallet, open
 * loans, prices, and FX. One failing account is recorded in `errors` and the
 * rest still count, so the snapshot is never blank because of one key.
 */
export async function collectState(
  hash: string,
  creds: { binance: PlainAccount[]; luno: PlainAccount[] },
  previous: PortfolioState | null = null,
): Promise<PortfolioState> {
  const containers = await readContainers(hash);
  const linkContainer = linkContainerMap(containers);
  const positions: Position[] = [];
  const debts: DebtPosition[] = [];
  const errors: string[] = [];
  const binancePrices: Record<string, number> = {};

  await Promise.all(
    creds.binance.map(async (account) => {
      const client = createRealBinanceClient({ id: account.id, name: account.name }, { apiKey: account.apiKey, apiSecret: account.apiSecret });
      const containerId = linkContainer.get(account.id) ?? null;
      const [holdings, loans] = await Promise.allSettled([client.getHoldings(), client.listLoans()]);
      if (holdings.status === "fulfilled") {
        for (const holding of holdings.value) {
          const asset = normaliseAsset(holding.asset);
          if (holding.total > 0 && holding.usd > 0) binancePrices[asset] = holding.usd / holding.total;
          const wallets: Array<[Position["wallet"], number]> = [
            ["spot", holding.spot],
            ["earn", holding.funding],
            ["collateral", holding.collateral],
          ];
          for (const [wallet, qty] of wallets) {
            if (qty > 0) positions.push({ exchange: "binance", linkId: account.id, linkName: account.name, containerId, wallet, asset, qty });
          }
        }
      } else {
        errors.push(`binance:${account.id}:holdings`);
        logger.warn({ err: holdings.reason, op: "portfolio.collect.holdings" }, "binance holdings failed for one account");
      }
      if (loans.status === "fulfilled") {
        for (const loan of loans.value) {
          if (!(loan.debt > 0)) continue;
          debts.push({
            loanId: loan.id,
            exchange: "binance",
            linkId: account.id,
            containerId,
            asset: normaliseAsset(loan.asset),
            qty: loan.debt,
            collateralAsset: normaliseAsset(loan.collateral.asset),
            collateralQty: loan.collateral.qty,
            ltv: loan.ltv,
            marginCallLtv: loan.marginCallLtv,
            liqLtv: loan.liqLtv,
            apr: loan.apr,
            hourlyRate: loan.hourlyInterestRate,
          });
        }
      } else {
        errors.push(`binance:${account.id}:loans`);
        logger.warn({ err: loans.reason, op: "portfolio.collect.loans" }, "binance loans failed for one account");
      }
    }),
  );

  await Promise.all(
    creds.luno.map(async (account) => {
      const client = createRealLunoClient({ id: account.id, name: account.name }, { keyId: account.apiKey, keySecret: account.apiSecret });
      try {
        const wallets = await client.listWallets();
        for (const wallet of wallets) {
          const qty = wallet.balance;
          if (!(qty > 0)) continue;
          positions.push({
            exchange: "luno",
            linkId: account.id,
            linkName: account.name,
            containerId: linkContainer.get(account.id) ?? null,
            wallet: "wallet",
            asset: normaliseAsset(wallet.asset),
            qty,
          });
        }
      } catch (err) {
        errors.push(`luno:${account.id}:wallets`);
        logger.warn({ err, op: "portfolio.collect.luno" }, "luno wallets failed for one account");
      }
    }),
  );

  const assets = [...new Set([...positions.map((p) => p.asset), ...debts.map((d) => d.asset)])];
  const needPrice = assets.filter((asset) => !STABLECOINS.has(asset) && asset !== "ZAR" && binancePrices[asset] == null);
  const prices: Record<string, number> = { ...binancePrices };
  if (needPrice.length > 0) {
    try {
      const quoted = await fetchUsdPrices(needPrice);
      for (const price of quoted.prices) if (price.usd > 0) prices[normaliseAsset(price.asset)] = price.usd;
    } catch (err) {
      logger.warn({ err, op: "portfolio.collect.prices" }, "price lookup failed");
    }
  }
  for (const asset of assets) if (STABLECOINS.has(asset)) prices[asset] = 1;
  const [change24h, fx] = await Promise.all([fetch24hChange(assets).catch(() => ({})), currentFx()]);
  if (fx.rate) prices.ZAR = 1 / fx.rate;

  const state: PortfolioState = {
    asOf: Date.now(),
    positions,
    debts,
    prices,
    change24h,
    fx: fx.rate,
    fxSource: fx.source,
    containers,
    errors,
  };
  // Pickle Rick is an extra statement source. A missing token is a skip.
  // 401/503 keeps the previous Pickle Rick rows and does not touch Binance or Luno.
  const pickle = await loadPickleRick(fx.rate, fetch, containers);
  applyPickleRick(state, previous, pickle);
  const separated = separateChildHoldings(state);
  state.positions = separated.positions;
  state.containers = separated.containers;
  state.prices = separated.prices;
  if (separated.statementSeries) state.statementSeries = separated.statementSeries;
  return state;
}
