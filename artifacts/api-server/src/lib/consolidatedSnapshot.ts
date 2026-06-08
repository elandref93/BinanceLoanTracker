import type { BinanceClient } from "./binance";
import type { LoanSummary } from "./loanCompute";
import type { PlainAccount } from "./credentialStore";
import {
  createMultiplexLunoClient,
  createRealLunoClient,
} from "./luno";
import { fetchUsdToZar } from "./fx";
import { readRecordByHash } from "./accountStorage";
import {
  MAX_DAILY_CHARGE,
  type ContainerLtv,
  type DailyChargePoint,
  type LtvSnapshot,
  type SnapshotLoan,
} from "./ltvSnapshot";
import { logger } from "./logger";

// Builds the Phase-3 "consolidated bundle" the mobile app pulls on launch so it
// has loans, holdings, interest, per-container LTV, a daily-charge history and
// an FX rate immediately — even while closed during the scheduler run. Every
// section degrades to "absent" on failure so one broken upstream never sinks
// the whole snapshot.

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

const STABLES = new Set(["USDT", "USDC", "USD", "BUSD", "FDUSD", "DAI", "TUSD"]);

// Luno uses XBT for Bitcoin; everything else maps 1:1 to the Binance symbol.
function lunoToBinanceSymbol(asset: string): string {
  const a = asset.toUpperCase();
  return a === "XBT" ? "BTC" : a;
}

interface ConsolidatedInput {
  hash: string;
  client: BinanceClient;
  summary: LoanSummary;
  lunoAccounts: PlainAccount[];
  prev: LtvSnapshot | null;
}

export type ConsolidatedExtras = Pick<
  LtvSnapshot,
  | "loans"
  | "holdingsUsd"
  | "interestLifetimeUsd"
  | "interestProjected30dUsd"
  | "perContainer"
  | "dailyCharge"
  | "fxUsdToZar"
>;

function toSnapshotLoans(summary: LoanSummary): SnapshotLoan[] {
  return summary.loans.map((l) => ({
    id: l.id,
    accountId: l.accountId,
    asset: l.asset,
    debtUsd: round(l.debtUsd, 2),
    collateralAsset: l.collateral.asset,
    collateralValueUsd: round(l.collateral.valueUsd, 2),
    ltv: round(l.ltv, 2),
    apr: round(l.apr, 3),
  }));
}

// Today's projected interest charge across all loans (debt × hourly × 24).
function projectedDailyChargeUsd(summary: LoanSummary): number {
  return round(
    summary.loans.reduce(
      (s, l) => s + l.debt * l.hourlyInterestRate * 24,
      0,
    ),
    2,
  );
}

// Append/replace today's bucket in the rolling daily-charge series.
function rollDailyCharge(
  prev: DailyChargePoint[] | undefined,
  todayUsd: number,
): DailyChargePoint[] {
  const today = utcDay();
  const kept = (prev ?? []).filter((p) => p.t !== today);
  return [...kept, { t: today, usd: todayUsd }].slice(-MAX_DAILY_CHARGE);
}

interface RawContainer {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  links?: unknown;
}

async function perContainerLtv(
  hash: string,
  summary: LoanSummary,
): Promise<ContainerLtv[] | undefined> {
  const rec = await readRecordByHash(hash, "accounts");
  const containers = rec?.containers;
  if (!Array.isArray(containers)) return undefined;
  const out: ContainerLtv[] = [];
  for (const raw of containers as RawContainer[]) {
    if (!raw || typeof raw !== "object") continue;
    const id = typeof raw.id === "string" ? raw.id : null;
    if (!id) continue;
    const linkIds = new Set(
      (Array.isArray(raw.links) ? raw.links : [])
        .map((l) =>
          l && typeof l === "object" && typeof (l as { id?: unknown }).id === "string"
            ? (l as { id: string }).id
            : null,
        )
        .filter((x): x is string => x !== null),
    );
    const ls = summary.loans.filter((l) => linkIds.has(l.accountId));
    const debtUsd = round(ls.reduce((s, l) => s + l.debtUsd, 0), 2);
    const collateralUsd = round(
      ls.reduce((s, l) => s + l.collateral.valueUsd, 0),
      2,
    );
    out.push({
      containerId: id,
      name: typeof raw.name === "string" ? raw.name : undefined,
      type: typeof raw.type === "string" ? raw.type : undefined,
      debtUsd,
      collateralUsd,
      ltv: collateralUsd > 0 ? round((debtUsd / collateralUsd) * 100, 2) : 0,
      loanCount: ls.length,
    });
  }
  return out;
}

// Total holdings USD = Binance holdings (already USD-valued) + Luno wallets
// valued via Binance spot prices (crypto), $1 (stablecoins) and the FX rate (ZAR).
async function totalHoldingsUsd(
  client: BinanceClient,
  lunoAccounts: PlainAccount[],
  fxUsdToZar: number | null,
): Promise<number> {
  let usd = 0;
  try {
    const holdings = await client.getHoldings();
    usd += holdings.reduce((s, h) => s + h.usd, 0);
  } catch (err) {
    logger.warn({ err, op: "snapshot.holdings.binance" }, "binance holdings failed");
  }
  if (lunoAccounts.length > 0) {
    try {
      const luno = createMultiplexLunoClient(
        lunoAccounts.map((a) => ({
          account: { id: a.id, name: a.name },
          client: createRealLunoClient(
            { id: a.id, name: a.name },
            { keyId: a.apiKey, keySecret: a.apiSecret },
          ),
        })),
      );
      const wallets = await luno.listWallets();
      const cryptoSymbols = Array.from(
        new Set(
          wallets
            .map((w) => lunoToBinanceSymbol(w.asset))
            .filter((s) => !STABLES.has(s) && s !== "ZAR"),
        ),
      );
      const priceMap = new Map<string, number>();
      if (cryptoSymbols.length > 0) {
        const { prices } = await client.getPrices(cryptoSymbols);
        for (const p of prices) priceMap.set(p.asset.toUpperCase(), p.usd);
      }
      for (const w of wallets) {
        const qty = w.balance + w.reserved;
        if (qty <= 0) continue;
        const sym = lunoToBinanceSymbol(w.asset);
        if (sym === "ZAR") {
          if (fxUsdToZar && fxUsdToZar > 0) usd += qty / fxUsdToZar;
        } else if (STABLES.has(sym)) {
          usd += qty;
        } else {
          usd += qty * (priceMap.get(sym) ?? 0);
        }
      }
    } catch (err) {
      logger.warn({ err, op: "snapshot.holdings.luno" }, "luno holdings failed");
    }
  }
  return round(usd, 2);
}

async function lifetimeInterestUsd(
  client: BinanceClient,
  summary: LoanSummary,
): Promise<number> {
  const settled = await Promise.allSettled(
    summary.loans.map((l) => client.getLifetimeInterestUsd(l.id)),
  );
  let sum = 0;
  for (const r of settled) {
    if (r.status === "fulfilled") sum += r.value.lifetimeInterestUsd;
  }
  return round(sum, 2);
}

export async function buildConsolidatedExtras({
  hash,
  client,
  summary,
  lunoAccounts,
  prev,
}: ConsolidatedInput): Promise<ConsolidatedExtras> {
  const fxUsdToZar = await fetchUsdToZar();
  const [holdingsUsd, interestLifetimeUsd, perContainer] = await Promise.all([
    totalHoldingsUsd(client, lunoAccounts, fxUsdToZar),
    lifetimeInterestUsd(client, summary),
    perContainerLtv(hash, summary),
  ]);
  const interestProjected30dUsd = round(projectedDailyChargeUsd(summary) * 30, 2);
  const dailyCharge = rollDailyCharge(
    prev?.dailyCharge,
    projectedDailyChargeUsd(summary),
  );
  return {
    loans: toSnapshotLoans(summary),
    holdingsUsd,
    interestLifetimeUsd,
    interestProjected30dUsd,
    perContainer,
    dailyCharge,
    ...(fxUsdToZar != null ? { fxUsdToZar: round(fxUsdToZar, 4) } : {}),
  };
}
