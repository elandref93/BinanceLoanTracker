import { Router, type IRouter, type Request, type Response } from "express";
import {
  GetPortfolioAnalyticsQueryParams,
  GetPortfolioAssetQueryParams,
  GetPortfolioAssetsQueryParams,
  GetPortfolioLoansQueryParams,
  GetPortfolioOverviewQueryParams,
  GetPortfolioPerformanceQueryParams,
  type ImportStatus,
  type LoanPosition,
  type PerformanceRange,
  type PnlPeriod,
  type PortfolioAnalytics,
  type PortfolioAssetDetail,
  type PortfolioAssets,
  type PortfolioLoans,
  type PortfolioOverview,
  type PortfolioPerformance,
} from "@workspace/api-zod";
import { readRecordByHash } from "../lib/accountStorage";
import { logger } from "../lib/logger";
import { loadDecryptedByHash } from "../lib/credentialStore";
import { readSnapshotByHash, type LtvSnapshot, type SnapshotLoan } from "../lib/ltvSnapshot";
import { DEFAULT_CGT_METHOD, TOP_MARGINAL_RATE, type CgtMethod } from "../lib/portfolio/cgt";
import { saTaxYear } from "../lib/portfolio/time";
import { buildLoans } from "../lib/portfolio/loans";
import { isCryptoConfigured } from "../lib/secretCrypto";
import { userStorageKey } from "../lib/userWriteLock";
import { loadDerived, type Derived } from "../lib/portfolio/derived";
import { readLedger } from "../lib/portfolio/ledgerStore";
import { ensureImportRunning, isImportRunning } from "../lib/portfolio/importer";
import { isSnapshotRunning, nextRefreshAllowedAt, refreshUser, snapshotNow } from "../lib/portfolio/service";
import { normaliseAsset, portfolioAssetParam } from "../lib/portfolio/types";
import {
  buildAnalytics,
  buildAssetDetail,
  buildAssets,
  buildImportStatus,
  buildOverview,
  buildPerformance,
} from "../lib/portfolio/views";

// Mounted at /api/portfolio, behind requireAuth. Everything is read from the
// user's encrypted portfolio and ledger files; only /refresh calls exchanges.

const router: IRouter = Router();

type Unavailable = { reason: string };

function hashFor(req: Request): string {
  return userStorageKey(req.userId!);
}

/** Loads the derived views, taking a first snapshot if the user has none yet. */
async function derivedFor(req: Request): Promise<Derived | Unavailable> {
  if (!isCryptoConfigured()) return { reason: "encryption_not_configured" };
  const hash = hashFor(req);
  const existing = await loadDerived(hash);
  if (existing) return existing;
  const creds = await loadDecryptedByHash(hash);
  if (!creds || (creds.binance.length === 0 && creds.luno.length === 0)) return { reason: "no_accounts" };
  if (!isSnapshotRunning(hash) && nextRefreshAllowedAt(hash) > Date.now()) return { reason: "snapshot_failed" };
  await snapshotNow(hash, creds);
  void ensureImportRunning(hash, creds);
  return (await loadDerived(hash)) ?? { reason: "snapshot_failed" };
}

function isUnavailable(value: Derived | Unavailable): value is Unavailable {
  return "reason" in value;
}

const zeroTotals = { assetsUsd: 0, debtUsd: 0, netUsd: 0 };
const emptyPeriod = (): PnlPeriod => ({
  from: new Date().toISOString(),
  startUsd: null,
  endUsd: null,
  pnlUsd: null,
  pct: null,
  flowsUsd: 0,
  basis: "none",
  attribution: null,
  byProfile: [],
  spark: [],
});

function badRequest(res: Response, message: string): void {
  res.status(400).json({ error: message });
}

/** Last saved LTV snapshot, so Home still has a net worth when the encrypted ledger is not on this machine. */
function overviewFromSnapshot(snap: LtvSnapshot): PortfolioOverview {
  const assets = snap.holdingsUsd ?? snap.totalCollateralUsd;
  const debt = snap.totalDebtUsd;
  const daily = (snap.loans ?? []).reduce((sum, loan) => sum + (loan.debtUsd * loan.apr) / 100 / 365, 0);
  const round2 = (value: number) => Math.round(value * 100) / 100;
  return {
    available: true,
    asOf: snap.asOf,
    scope: "all",
    fxUsdToZar: typeof snap.fxUsdToZar === "number" ? snap.fxUsdToZar : null,
    fxSource: typeof snap.fxUsdToZar === "number" ? "reference" : "none",
    totals: { assetsUsd: round2(assets), debtUsd: round2(debt), netUsd: round2(assets - debt) },
    today: emptyPeriod(),
    week: emptyPeriod(),
    month: emptyPeriod(),
    allocation: collateralAllocation(snap),
    movers: [],
    profiles: (snap.perContainer ?? []).map((container) => ({
      containerId: container.containerId,
      name: container.name ?? "Profile",
      type: container.type ?? "personal",
      assetsUsd: round2(container.collateralUsd),
      debtUsd: round2(container.debtUsd),
      netUsd: round2(container.collateralUsd - container.debtUsd),
      ltv: container.ltv,
      targetLtv: null,
    })),
    exchanges: [],
    loans: {
      count: snap.loans?.length ?? 0,
      debtUsd: round2(debt),
      collateralUsd: round2(snap.totalCollateralUsd),
      ltv: snap.aggregateLtv,
      dailyInterestUsd: round2(daily),
    },
    sparkline: [],
    import: { state: "unavailable", progress: 0, earliest: null, flaggedCount: 0 },
    flags: ["saved_snapshot"],
  };
}

const USD_STABLES = new Set(["USDT", "USDC", "FDUSD", "TUSD", "DAI", "BUSD", "USD"]);
const MARGIN_CALL_LTV = 85;
const LIQUIDATION_LTV = 91;
const RANGE_MS: Record<PerformanceRange, number | null> = {
  "1D": 86_400_000,
  "1W": 7 * 86_400_000,
  "1M": 30 * 86_400_000,
  "3M": 90 * 86_400_000,
  "1Y": 365 * 86_400_000,
  ALL: null,
};

type SavedLink = { exchange: "binance" | "luno"; name: string; containerId: string; containerName: string };

function linksById(record: Record<string, unknown> | null): Map<string, SavedLink> {
  const map = new Map<string, SavedLink>();
  if (!record || !Array.isArray(record.containers)) return map;
  for (const container of record.containers) {
    if (!container || typeof container !== "object") continue;
    const profile = container as Record<string, unknown>;
    const containerId = typeof profile.id === "string" ? profile.id : "";
    const containerName = typeof profile.name === "string" ? profile.name : "Profile";
    if (!Array.isArray(profile.links)) continue;
    for (const link of profile.links) {
      if (!link || typeof link !== "object") continue;
      const row = link as Record<string, unknown>;
      if (typeof row.id !== "string" || (row.exchange !== "binance" && row.exchange !== "luno")) continue;
      map.set(row.id, { exchange: row.exchange, name: containerName, containerId, containerName });
    }
  }
  return map;
}

function loanFromSnapshot(loan: SnapshotLoan, link: SavedLink | undefined): LoanPosition {
  const round2 = (value: number) => Math.round(value * 100) / 100;
  const stable = USD_STABLES.has(loan.asset.toUpperCase());
  return {
    loanId: loan.id,
    exchange: link?.exchange ?? "binance",
    linkId: loan.accountId,
    linkName: link?.name ?? "Account",
    containerId: link?.containerId ?? null,
    profileName: link?.containerName ?? null,
    asset: loan.asset,
    debtQty: stable ? loan.debtUsd : 0,
    debtUsd: round2(loan.debtUsd),
    collateralAsset: loan.collateralAsset,
    collateralQty: 0,
    collateralUsd: round2(loan.collateralValueUsd),
    collateralPriceUsd: null,
    ltv: loan.ltv,
    marginCallLtv: MARGIN_CALL_LTV,
    liqLtv: LIQUIDATION_LTV,
    targetLtv: null,
    apr: loan.apr,
    hourlyRate: loan.apr / 100 / 365 / 24,
    dailyInterestUsd: round2((loan.debtUsd * loan.apr) / 100 / 365),
    priceAtTargetUsd: null,
    priceAtMarginCallUsd: null,
    priceAtLiquidationUsd: null,
    ltvChange7d: null,
  };
}

function downsample<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const out: T[] = [];
  const step = (items.length - 1) / (max - 1);
  for (let index = 0; index < max; index += 1) out.push(items[Math.round(index * step)] as T);
  return out;
}

/** Saved loan list and combined LTV history when the encrypted ledger is unavailable. */
function loansFromSnapshot(snap: LtvSnapshot, range: PerformanceRange, scope: string | undefined, links: Map<string, SavedLink>): PortfolioLoans {
  const wanted = scope && scope !== "all" ? scope : null;
  const loans = (snap.loans ?? [])
    .map((loan) => loanFromSnapshot(loan, links.get(loan.accountId)))
    .filter((loan) => wanted == null || loan.containerId === wanted);
  const debt = loans.reduce((sum, loan) => sum + loan.debtUsd, 0);
  const collateral = loans.reduce((sum, loan) => sum + loan.collateralUsd, 0);
  const window = RANGE_MS[range];
  const cutoff = window == null ? 0 : Date.now() - window;
  const history = downsample(
    (snap.history ?? []).filter((point) => Date.parse(point.t) >= cutoff),
    240,
  ).map((point) => ({ t: point.t, ltv: point.ltv, loans: {}, profiles: {} }));
  const profiles = new Map<string, { name: string; debtUsd: number; collateralUsd: number; loanCount: number }>();
  for (const loan of loans) {
    const key = loan.containerId ?? "none";
    const row = profiles.get(key) ?? { name: loan.profileName ?? "Not in a profile", debtUsd: 0, collateralUsd: 0, loanCount: 0 };
    row.debtUsd += loan.debtUsd;
    row.collateralUsd += loan.collateralUsd;
    row.loanCount += 1;
    profiles.set(key, row);
  }
  const round2 = (value: number) => Math.round(value * 100) / 100;
  return {
    available: loans.length > 0,
    reason: loans.length > 0 ? undefined : "encryption_not_configured",
    asOf: snap.asOf,
    scope: wanted ?? "all",
    range,
    fxUsdToZar: typeof snap.fxUsdToZar === "number" ? snap.fxUsdToZar : null,
    totals: {
      count: loans.length,
      debtUsd: round2(debt),
      collateralUsd: round2(collateral),
      ltv: collateral > 0 ? round2((debt / collateral) * 100) : snap.aggregateLtv,
      dailyInterestUsd: round2(loans.reduce((sum, loan) => sum + loan.dailyInterestUsd, 0)),
    },
    loans,
    profiles: [...profiles.entries()].map(([containerId, row]) => ({
      containerId: containerId === "none" ? null : containerId,
      name: row.name,
      debtUsd: round2(row.debtUsd),
      collateralUsd: round2(row.collateralUsd),
      ltv: row.collateralUsd > 0 ? round2((row.debtUsd / row.collateralUsd) * 100) : null,
      targetLtv: null,
      loanCount: row.loanCount,
    })),
    history,
    historyBasis: history.length > 0 ? "aggregate" : "none",
  };
}

const SAVED_SNAPSHOT = ["saved_snapshot"] as const;

function roundMoney(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function wantedScope(scope: string | undefined): string | null {
  return scope && scope !== "all" ? scope : null;
}

type ScopedLoan = { loan: SnapshotLoan; link: SavedLink | undefined };

function scopedSnapshotLoans(snap: LtvSnapshot, scope: string | undefined, links: Map<string, SavedLink>): ScopedLoan[] {
  const wanted = wantedScope(scope);
  return (snap.loans ?? [])
    .filter((loan) => loan.collateralAsset.trim().length > 0 || loan.asset.trim().length > 0)
    .map((loan) => ({ loan, link: links.get(loan.accountId) }))
    .filter((row) => wanted == null || row.link?.containerId === wanted);
}

/** Collateral mix only. The snapshot has no per-asset spot balances. */
function collateralAllocation(snap: LtvSnapshot): PortfolioOverview["allocation"] {
  const totals = new Map<string, number>();
  for (const loan of snap.loans ?? []) {
    const asset = normaliseAsset(loan.collateralAsset);
    if (!asset || !(loan.collateralValueUsd > 0)) continue;
    totals.set(asset, (totals.get(asset) ?? 0) + loan.collateralValueUsd);
  }
  const gross = [...totals.values()].reduce((sum, usd) => sum + usd, 0);
  return [...totals.entries()]
    .map(([asset, usd]) => ({
      asset,
      qty: 0,
      usd: roundMoney(usd),
      pct: gross > 0 ? roundMoney((usd / gross) * 100) : 0,
    }))
    .sort((a, b) => b.usd - a.usd || a.asset.localeCompare(b.asset));
}

/**
 * Collateral rows from the saved LTV snapshot. Quantity and spot wallets are
 * not in the file, so qty stays 0 and every position is labelled collateral.
 */
export function assetsFromSnapshot(snap: LtvSnapshot, scope: string | undefined, links: Map<string, SavedLink>): PortfolioAssets & { flags: string[] } {
  const wanted = wantedScope(scope);
  const groups = new Map<string, { usd: number; positions: PortfolioAssets["assets"][number]["positions"] }>();
  for (const { loan, link } of scopedSnapshotLoans(snap, scope, links)) {
    const asset = normaliseAsset(loan.collateralAsset);
    if (!asset || !(loan.collateralValueUsd > 0)) continue;
    const group = groups.get(asset) ?? { usd: 0, positions: [] };
    group.usd += loan.collateralValueUsd;
    const existing = group.positions.find((position) => position.linkId === loan.accountId && position.wallet === "collateral");
    if (existing) existing.usd = roundMoney(existing.usd + loan.collateralValueUsd);
    else {
      group.positions.push({
        exchange: link?.exchange ?? "binance",
        linkId: loan.accountId,
        linkName: link?.containerName ?? link?.name ?? "Account",
        containerId: link?.containerId ?? null,
        wallet: "collateral",
        qty: 0,
        usd: roundMoney(loan.collateralValueUsd),
      });
    }
    groups.set(asset, group);
  }
  const gross = [...groups.values()].reduce((sum, group) => sum + group.usd, 0);
  const assets = [...groups.entries()]
    .map(([asset, group]) => ({
      asset,
      qty: 0,
      usd: roundMoney(group.usd),
      priceUsd: 0,
      pct: gross > 0 ? roundMoney((group.usd / gross) * 100) : 0,
      change24hPct: null,
      debtQty: 0,
      debtUsd: 0,
      costBasisUsd: null,
      unrealizedUsd: null,
      positions: group.positions,
    }))
    .sort((a, b) => b.usd - a.usd || a.asset.localeCompare(b.asset));
  return {
    available: true,
    asOf: snap.asOf,
    scope: wanted ?? "all",
    fxUsdToZar: typeof snap.fxUsdToZar === "number" ? snap.fxUsdToZar : null,
    assets,
    flags: [...SAVED_SNAPSHOT],
  };
}

/** Interest, collateral concentration, and loan LTV bands. No forecast, cost, or CGT. */
export function analyticsFromSnapshot(
  snap: LtvSnapshot,
  scope: string | undefined,
  method: CgtMethod,
  links: Map<string, SavedLink>,
): PortfolioAnalytics & { flags: string[] } {
  const wanted = wantedScope(scope);
  const rows = scopedSnapshotLoans(snap, scope, links);
  const collateral = new Map<string, number>();
  let debt = 0;
  let collateralUsd = 0;
  let aprWeighted = 0;
  for (const { loan } of rows) {
    debt += loan.debtUsd;
    aprWeighted += loan.debtUsd * loan.apr;
    const asset = normaliseAsset(loan.collateralAsset);
    if (!asset || !(loan.collateralValueUsd > 0)) continue;
    collateral.set(asset, (collateral.get(asset) ?? 0) + loan.collateralValueUsd);
    collateralUsd += loan.collateralValueUsd;
  }
  const daily = rows.reduce((sum, { loan }) => sum + (loan.debtUsd * loan.apr) / 100 / 365, 0);
  const gross = wanted == null ? (snap.holdingsUsd ?? collateralUsd) : collateralUsd;
  let hhi = 0;
  let topAsset: string | null = null;
  let topUsd = 0;
  let stableUsd = 0;
  for (const [asset, usd] of collateral) {
    const weight = collateralUsd > 0 ? usd / collateralUsd : 0;
    hhi += weight * weight;
    if (usd > topUsd) {
      topUsd = usd;
      topAsset = asset;
    }
    if (USD_STABLES.has(asset.toUpperCase())) stableUsd += usd;
  }
  const year = saTaxYear(Date.now());
  return {
    available: true,
    asOf: snap.asOf,
    scope: wanted ?? "all",
    fxUsdToZar: typeof snap.fxUsdToZar === "number" ? snap.fxUsdToZar : null,
    totals: {
      assetsUsd: roundMoney(gross),
      debtUsd: roundMoney(debt),
      netUsd: roundMoney(gross - debt),
    },
    interest: {
      dailyUsd: roundMoney(daily),
      monthlyUsd: roundMoney(daily * 30),
      yearlyUsd: roundMoney(daily * 365),
      paidLast30dUsd: null,
      weightedApr: debt > 0 ? roundMoney(aprWeighted / debt, 4) : null,
      dragPctOfAssets: gross > 0 ? roundMoney(((daily * 365) / gross) * 100, 4) : null,
    },
    concentration: {
      hhi: roundMoney(hhi, 6),
      effectiveAssets: hhi > 0 ? roundMoney(1 / hhi, 4) : 0,
      topAsset,
      topPct: collateralUsd > 0 ? roundMoney((topUsd / collateralUsd) * 100) : 0,
    },
    contributions: {
      depositedUsd: 0,
      withdrawnUsd: 0,
      netContributedUsd: 0,
      growthUsd: null,
      since: null,
      basis: "none",
      monthly: [],
    },
    income: { last30dUsd: 0, last365dUsd: 0 },
    risk: {
      volatility30dPct: null,
      maxDrawdownPct: null,
      bestDayPct: null,
      worstDayPct: null,
      stablePct: collateralUsd > 0 ? roundMoney((stableUsd / collateralUsd) * 100) : 0,
    },
    cgt: {
      method,
      taxYear: year.label,
      profileType: "individual",
      realizedGainUsd: 0,
      realizedGainZar: null,
      annualExclusionZar: 0,
      inclusionRate: 0,
      taxableGainZar: null,
      unrealizedGainUsd: null,
      disposals: 0,
      complete: false,
      taxRate: TOP_MARGINAL_RATE,
      profiles: [],
      taxIfSoldZar: null,
    },
    assetReturns: [],
    loans: rows.map(({ loan, link }) => ({
      id: loan.id,
      containerId: link?.containerId ?? null,
      asset: normaliseAsset(loan.asset),
      collateralAsset: normaliseAsset(loan.collateralAsset),
      debtUsd: roundMoney(loan.debtUsd),
      collateralUsd: roundMoney(loan.collateralValueUsd),
      ltv: loan.ltv,
      marginCallLtv: MARGIN_CALL_LTV,
      liqLtv: LIQUIDATION_LTV,
      apr: loan.apr,
    })),
    flags: [...SAVED_SNAPSHOT],
  };
}

router.get("/overview", async (req, res, next) => {
  try {
    const query = GetPortfolioOverviewQueryParams.safeParse(req.query);
    if (!query.success) return badRequest(res, "Invalid scope");
    const derived = await derivedFor(req);
    if (isUnavailable(derived)) {
      const saved = await readSnapshotByHash(hashFor(req));
      if (saved && (saved.holdingsUsd != null || saved.totalCollateralUsd > 0 || saved.totalDebtUsd > 0)) {
        const body = overviewFromSnapshot(saved);
        logger.info({ op: "portfolio.overview", available: body.available, flags: body.flags }, "portfolio overview");
        res.json(body);
        return;
      }
      const body: PortfolioOverview = {
        available: false,
        reason: derived.reason,
        asOf: null,
        scope: "all",
        fxUsdToZar: null,
        fxSource: "none",
        totals: zeroTotals,
        today: emptyPeriod(),
        week: emptyPeriod(),
        month: emptyPeriod(),
        allocation: [],
        movers: [],
        profiles: [],
        exchanges: [],
        loans: { count: 0, debtUsd: 0, collateralUsd: 0, ltv: null, dailyInterestUsd: 0 },
        sparkline: [],
        import: { state: "unavailable", progress: 0, earliest: null, flaggedCount: 0 },
        flags: [],
      };
      logger.info({ op: "portfolio.overview", available: false, reason: derived.reason }, "portfolio overview");
      res.json(body);
      return;
    }
    const built = buildOverview(derived, query.data.scope);
    logger.info({ op: "portfolio.overview", available: built.available, flags: built.flags }, "portfolio overview");
    res.json(built);
  } catch (err) {
    next(err);
  }
});

router.get("/performance", async (req, res, next) => {
  try {
    const query = GetPortfolioPerformanceQueryParams.safeParse(req.query);
    if (!query.success) return badRequest(res, "Invalid range or scope");
    const range = query.data.range ?? "1M";
    const derived = await derivedFor(req);
    if (isUnavailable(derived)) {
      const body: PortfolioPerformance = {
        available: false,
        range,
        scope: "all",
        basis: "none",
        points: [],
        summary: { startUsd: null, endUsd: null, pnlUsd: null, twrPct: null, flowsUsd: 0, highUsd: null, lowUsd: null, maxDrawdownPct: null },
        attribution: null,
      };
      res.json(body);
      return;
    }
    res.json(buildPerformance(derived, range, query.data.scope));
  } catch (err) {
    next(err);
  }
});

router.get("/assets", async (req, res, next) => {
  try {
    const query = GetPortfolioAssetsQueryParams.safeParse(req.query);
    if (!query.success) return badRequest(res, "Invalid scope");
    const derived = await derivedFor(req);
    if (isUnavailable(derived)) {
      const hash = hashFor(req);
      const saved = await readSnapshotByHash(hash);
      if (saved && (saved.loans?.length ?? 0) > 0) {
        const accounts = await readRecordByHash(hash, "accounts");
        const body = assetsFromSnapshot(saved, query.data.scope, linksById(accounts));
        logger.info({ op: "portfolio.assets", available: body.available, flags: body.flags }, "portfolio assets");
        res.json(body);
        return;
      }
      const body: PortfolioAssets = { available: false, reason: derived.reason, asOf: null, scope: "all", fxUsdToZar: null, assets: [] };
      logger.info({ op: "portfolio.assets", available: false, reason: derived.reason }, "portfolio assets");
      res.json(body);
      return;
    }
    res.json(buildAssets(derived, query.data.scope));
  } catch (err) {
    next(err);
  }
});

router.get("/loans", async (req, res, next) => {
  try {
    const query = GetPortfolioLoansQueryParams.safeParse(req.query);
    if (!query.success) return badRequest(res, "Invalid scope or range");
    const range = query.data.range ?? "1M";
    const derived = await derivedFor(req);
    if (isUnavailable(derived)) {
      const hash = hashFor(req);
      const saved = await readSnapshotByHash(hash);
      if (saved && (saved.loans?.length ?? 0) > 0) {
        const accounts = await readRecordByHash(hash, "accounts");
        res.json(loansFromSnapshot(saved, range, query.data.scope, linksById(accounts)));
        return;
      }
      const body: PortfolioLoans = {
        available: false,
        reason: derived.reason,
        asOf: null,
        scope: "all",
        range,
        fxUsdToZar: null,
        totals: { count: 0, debtUsd: 0, collateralUsd: 0, ltv: null, dailyInterestUsd: 0 },
        loans: [],
        profiles: [],
        history: [],
        historyBasis: "none",
      };
      res.json(body);
      return;
    }
    const aggregate = (await readSnapshotByHash(hashFor(req)))?.history ?? [];
    res.json(buildLoans(derived, range, query.data.scope, aggregate));
  } catch (err) {
    next(err);
  }
});

router.get("/assets/:asset", async (req, res, next) => {
  try {
    const asset = portfolioAssetParam(req.params.asset ?? "");
    if (!asset) return badRequest(res, "Invalid asset");
    const query = GetPortfolioAssetQueryParams.safeParse(req.query);
    if (!query.success) return badRequest(res, "Invalid scope");
    const derived = await derivedFor(req);
    if (isUnavailable(derived)) {
      const hash = hashFor(req);
      const saved = await readSnapshotByHash(hash);
      if (saved && (saved.loans?.length ?? 0) > 0) {
        const accounts = await readRecordByHash(hash, "accounts");
        const list = assetsFromSnapshot(saved, query.data.scope, linksById(accounts));
        const row = list.assets.find((item) => item.asset === asset);
        if (row) {
          const body: PortfolioAssetDetail & { flags: string[] } = {
            available: true,
            asset: row,
            priceHistory: [],
            holdingHistory: [],
            events: [],
            costBasis: null,
            fxUsdToZar: list.fxUsdToZar,
            flags: [...SAVED_SNAPSHOT],
          };
          res.json(body);
          return;
        }
      }
      const body: PortfolioAssetDetail = {
        available: false,
        asset: {
          asset,
          qty: 0,
          usd: 0,
          priceUsd: 0,
          pct: 0,
          change24hPct: null,
          debtQty: 0,
          debtUsd: 0,
          costBasisUsd: null,
          unrealizedUsd: null,
          positions: [],
        },
        priceHistory: [],
        holdingHistory: [],
        events: [],
        costBasis: null,
        fxUsdToZar: null,
      };
      res.json(body);
      return;
    }
    res.json(buildAssetDetail(derived, asset, query.data.scope));
  } catch (err) {
    next(err);
  }
});

router.get("/import-status", async (req, res, next) => {
  try {
    if (!isCryptoConfigured()) {
      const body: ImportStatus = {
        state: "unavailable",
        progress: 0,
        startedAt: null,
        finishedAt: null,
        earliest: null,
        eventCount: 0,
        sources: [],
        reconciliation: [],
        notes: [],
      };
      res.json(body);
      return;
    }
    const hash = hashFor(req);
    const derived = await loadDerived(hash);
    const ledger = derived?.ledger ?? (await readLedger(hash));
    const unfinished = Object.values(ledger?.cursors ?? {}).some((cursor) => cursor.state !== "unavailable" && !cursor.backfillDone);
    if (unfinished) {
      const creds = await loadDecryptedByHash(hash);
      if (creds && (creds.binance.length > 0 || creds.luno.length > 0)) void ensureImportRunning(hash, creds);
    }
    const body = buildImportStatus(derived, ledger);
    if (isImportRunning(hash) && body.state !== "error") body.state = "running";
    res.json(body);
  } catch (err) {
    next(err);
  }
});

router.get("/analytics", async (req, res, next) => {
  try {
    const query = GetPortfolioAnalyticsQueryParams.safeParse(req.query);
    if (!query.success) return badRequest(res, "Invalid scope or method");
    const method = query.data.cgtMethod ?? DEFAULT_CGT_METHOD;
    const derived = await derivedFor(req);
    if (isUnavailable(derived)) {
      const hash = hashFor(req);
      const saved = await readSnapshotByHash(hash);
      if (saved && (saved.loans?.length ?? 0) > 0) {
        const accounts = await readRecordByHash(hash, "accounts");
        const body = analyticsFromSnapshot(saved, query.data.scope, method, linksById(accounts));
        logger.info({ op: "portfolio.analytics", available: body.available, flags: body.flags }, "portfolio analytics");
        res.json(body);
        return;
      }
      const body: PortfolioAnalytics = {
        available: false,
        asOf: null,
        scope: "all",
        fxUsdToZar: null,
        totals: zeroTotals,
        interest: { dailyUsd: 0, monthlyUsd: 0, yearlyUsd: 0, paidLast30dUsd: null, weightedApr: null, dragPctOfAssets: null },
        concentration: { hhi: 0, effectiveAssets: 0, topAsset: null, topPct: 0 },
        contributions: { depositedUsd: 0, withdrawnUsd: 0, netContributedUsd: 0, growthUsd: null, since: null, basis: "none", monthly: [] },
        income: { last30dUsd: 0, last365dUsd: 0 },
        risk: { volatility30dPct: null, maxDrawdownPct: null, bestDayPct: null, worstDayPct: null, stablePct: 0 },
        cgt: {
          method,
          taxYear: "",
          profileType: "individual",
          realizedGainUsd: 0,
          realizedGainZar: null,
          annualExclusionZar: 0,
          inclusionRate: 0,
          taxableGainZar: null,
          unrealizedGainUsd: null,
          disposals: 0,
          complete: false,
          taxRate: TOP_MARGINAL_RATE,
          profiles: [],
          taxIfSoldZar: null,
        },
        assetReturns: [],
        loans: [],
      };
      res.json(body);
      return;
    }
    res.json(buildAnalytics(derived, query.data.scope, method));
  } catch (err) {
    next(err);
  }
});

router.post("/refresh", async (req, res, next) => {
  try {
    if (!isCryptoConfigured()) {
      res.status(503).json({ error: "Encryption is not configured" });
      return;
    }
    const hash = hashFor(req);
    const now = Date.now();
    const allowedAt = nextRefreshAllowedAt(hash);
    if (allowedAt > now || isSnapshotRunning(hash)) {
      res.status(429).json({ accepted: false, running: isSnapshotRunning(hash) || isImportRunning(hash), nextAllowedAt: new Date(Math.max(allowedAt, now)).toISOString() });
      return;
    }
    const creds = await loadDecryptedByHash(hash);
    if (!creds || (creds.binance.length === 0 && creds.luno.length === 0)) {
      res.status(202).json({ accepted: false, running: false, nextAllowedAt: new Date(now).toISOString() });
      return;
    }
    // Wait for the snapshot (a few seconds) so the client's refetch sees it.
    await refreshUser(hash, creds);
    res.status(202).json({ accepted: true, running: isImportRunning(hash), nextAllowedAt: new Date(nextRefreshAllowedAt(hash)).toISOString() });
  } catch (err) {
    next(err);
  }
});

export default router;
