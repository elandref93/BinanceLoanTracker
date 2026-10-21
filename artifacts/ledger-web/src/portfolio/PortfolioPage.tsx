import type { PortfolioAsset } from "@workspace/api-client-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";

import { fmtPct } from "@/domain/format";
import { AssetDetail } from "@/portfolio/AssetDetail";
import {
  assetName,
  debtProfileLabel,
  holdingTitle,
  listHoldings,
  matchesQuery,
  owedWarningText,
  profileBlocks,
  holdingMovePct,
  sourcePlaces,
  statementQuoteParts,
  usdcOwedLineText,
  usdcOwedSplit,
  whereLabel,
  type HoldingPlace,
  type HoldingRow,
  type LunoUsdcQuote,
  type ProfileDebtSlice,
} from "@/portfolio/holdings";
import { PortfolioUnavailable } from "@/portfolio/PortfolioUnavailable";
import { isSavedSnapshot } from "@/portfolio/snapshotFlags";
import { lunoUsdcQuote, useAssets, useLoans, useLunoUsdcTicker } from "@/portfolio/queries";
import { Balance } from "@/prefs/DiscreetMode";
import { usePrefs, useProfileName } from "@/prefs/PreferencesProvider";
import { assetColor } from "@/theme/ledgerColors";
import { AssetIcon, displaySymbol, ExchangeMark } from "@/ui/AssetIcon";
import { Icon } from "@/ui/Icon";
import { Button, Card, cx, Delta, EmptyState, Notice, PageHeader, Skeleton } from "@/ui/primitives";
import { useSplitView } from "@/ui/useMediaQuery";

const STABLE = new Set(["USDT", "USDC", "FDUSD", "TUSD", "DAI", "BUSD", "ZAR", "USD"]);

export function PortfolioPage() {
  const params = useParams();
  const selected = params.asset ? displaySymbol(params.asset) : null;
  const split = useSplitView();
  const assets = useAssets();
  const data = assets.data;

  if (!split && selected) return <AssetDetail asset={selected} showBack />;
  if (assets.isPending) return <PortfolioSkeleton split={split} />;
  if (assets.isError && !data) {
    return (
      <Notice tone="danger" title="Holdings could not be loaded" action={<Button size="sm" onClick={() => void assets.refetch()}>Try again</Button>}>
        Ledger will keep retrying in the background.
      </Notice>
    );
  }
  if (!data || !data.available) return <PortfolioUnavailable reason={data?.reason} title="Holdings are not available yet" />;

  const savedSnapshot = isSavedSnapshot(data);
  if (!split) return <HoldingsList assets={data.assets} active={null} stale={assets.isPlaceholderData} savedSnapshot={savedSnapshot} />;
  const active = selected ?? data.assets[0]?.asset ?? null;
  return (
    <div className="grid grid-cols-[minmax(320px,380px)_minmax(0,1fr)] items-start gap-6 wide:grid-cols-[400px_minmax(0,1fr)]">
      <div className="sticky top-[5.25rem] max-h-[calc(100dvh-6.75rem)] overflow-y-auto overscroll-contain rounded-ledger pb-2 [scrollbar-width:thin]">
        <HoldingsList assets={data.assets} active={active} stale={assets.isPlaceholderData} savedSnapshot={isSavedSnapshot(data)} />
      </div>
      <div className="min-w-0">
        {active ? (
          <AssetDetail key={active} asset={active} />
        ) : (
          <Card>
            <EmptyState icon="portfolio" title="No holdings in this profile" body="Pick another profile from the top bar." />
          </Card>
        )}
      </div>
    </div>
  );
}

function HoldingsList(props: { assets: PortfolioAsset[]; active: string | null; stale: boolean; savedSnapshot?: boolean }) {
  const prefs = usePrefs();
  const profileName = useProfileName();
  const owesUsdc = props.assets.some((asset) => asset.asset.trim().toUpperCase() === "USDC" && asset.debtQty > 0);
  const splitProfiles = prefs.person === "user" && prefs.scope === "all";
  const loans = useLoans("1D", !props.savedSnapshot && splitProfiles && owesUsdc);
  const lunoUsdc = useLunoUsdcTicker(!props.savedSnapshot && owesUsdc);
  const lunoQuote = lunoUsdcQuote(lunoUsdc.data);
  const [query, setQuery] = useState("");
  const listed = props.savedSnapshot ? [] : props.assets;
  const rows = useMemo(() => listHoldings(listed, { profile: profileName }), [listed, profileName]);
  const usdcDebts = useMemo(() => {
    if (!splitProfiles || !loans.data?.available) return null;
    const slices: ProfileDebtSlice[] = [];
    for (const loan of loans.data.loans) {
      if (loan.asset.trim().toUpperCase() !== "USDC" || !(loan.debtQty > 0)) continue;
      const profile = debtProfileLabel(loan.containerId, loan.profileName, profileName);
      if (!profile) continue;
      slices.push({ profile, debtQty: loan.debtQty, containerId: loan.containerId });
    }
    return slices;
  }, [loans.data, profileName, splitProfiles]);
  const filtered = useMemo(() => rows.filter((row) => matchesQuery(row.asset, query)), [query, rows]);
  const totalUsd = listed.reduce((sum, asset) => {
    const counts = asset.positions.length === 0 || asset.positions.some((position) => position.includeInTotal !== false);
    return counts ? sum + asset.usd : sum;
  }, 0);
  const debtUsd = listed.reduce((sum, asset) => sum + asset.debtUsd, 0);
  const assetCount = listed.filter((asset) => asset.usd > 0 || asset.qty > 0 || asset.debtUsd > 0 || asset.positions.length > 0).length;

  return (
    <div className={cx("flex w-full min-w-0 flex-col gap-4 transition-opacity duration-200", props.stale ? "opacity-60" : "opacity-100")}>
      <PageHeader
        title="Portfolio"
        subtitle={props.savedSnapshot ? undefined : `${assetCount} ${assetCount === 1 ? "asset" : "assets"}`}
      />
      {props.savedSnapshot ? null : <SummaryCard rows={rows} totalUsd={totalUsd} debtUsd={debtUsd} />}
      <div className="flex min-w-0 flex-col gap-2.5">
        {listed.length > 6 ? (
          <label className="relative block">
            <span className="sr-only">Filter assets</span>
            <Icon name="search" size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-subtle" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter assets"
              autoComplete="off"
              spellCheck={false}
              className="min-h-11 w-full rounded-full border border-border bg-card pl-10 pr-4 text-body text-foreground placeholder:text-subtle focus:border-primary/50 focus:outline-none"
            />
          </label>
        ) : null}
      </div>
      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon="search"
            title={query ? `Nothing matches “${query}”` : "No holdings yet"}
            body={query ? "Try a symbol such as BTC or a name such as Ethereum." : "Balances appear after the next snapshot."}
          />
        </Card>
      ) : (
        <Card padded={false} className="min-w-0 max-w-full px-2 py-2" aria-label="Holdings">
          <ul className="min-w-0">
            {filtered.map((row) => (
              <li key={row.asset} className="min-w-0">
                <HoldingRowLink row={row} active={props.active === row.asset} lunoUsdc={lunoQuote} usdcDebts={usdcDebts} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function SummaryCard(props: { rows: HoldingRow[]; totalUsd: number; debtUsd: number }) {
  const prefs = usePrefs();
  const segments = useMemo(() => {
    const top = props.rows.slice(0, 6).filter((row) => row.pctOfTotal > 0);
    const rest = props.rows.slice(6).reduce((sum, row) => sum + row.pctOfTotal, 0);
    const list = top.map((row, index) => ({ key: row.asset, label: holdingTitle(displaySymbol(row.asset), row.places), pct: row.pctOfTotal, color: assetColor(row.asset, index) }));
    if (rest > 0.05) list.push({ key: "other", label: "Other", pct: rest, color: "#3A4854" });
    return list;
  }, [props.rows]);
  const summary = segments.map((segment) => `${segment.label} ${fmtPct(segment.pct)}`).join(", ");

  return (
    <Card>
      <p className="text-caption font-medium text-muted-foreground">Holdings</p>
      <p className="mt-1 text-[28px] font-semibold leading-[34px] tracking-tight tabular">{prefs.money(props.totalUsd, { whole: true })}</p>
      {props.debtUsd > 0 ? (
        <p className="mt-1 text-caption text-muted-foreground tabular">
          Owed {prefs.money(props.debtUsd, { compact: true })} · Net {prefs.money(props.totalUsd - props.debtUsd, { compact: true })}
        </p>
      ) : null}
      {segments.length > 0 ? (
        <>
          <div className="mt-4 flex h-2 min-w-0 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`Holdings: ${summary}`}>
            {segments.map((segment, index) => (
              <span
                key={segment.key}
                className="block h-full origin-left animate-grow-x rounded-full"
                style={{ width: `${Math.max(segment.pct, 0.8)}%`, background: segment.color, animationDelay: `${index * 50}ms` }}
              />
            ))}
          </div>
        </>
      ) : null}
    </Card>
  );
}

function placeText(place: HoldingPlace): string {
  return whereLabel(place.exchange, place.wallet, place.profile);
}

function OwedWarning(props: { row: HoldingRow; lunoUsdc: LunoUsdcQuote | null }) {
  const prefs = usePrefs();
  const fallback = prefs.formatMoney(props.row.debtUsd, { compact: true });
  return (
    <span className="mt-0.5 block break-words text-micro font-medium text-warn tabular">
      <Balance text={owedWarningText(props.row, prefs.currency, props.lunoUsdc, fallback)} />
    </span>
  );
}

function HoldingRowLink(props: { row: HoldingRow; active: boolean; lunoUsdc: LunoUsdcQuote | null; usdcDebts: ProfileDebtSlice[] | null }) {
  const prefs = usePrefs();
  const { row } = props;
  const symbol = displaySymbol(row.asset);
  const title = holdingTitle(symbol, row.places);
  const quote = statementQuoteParts(row);
  const movePct = holdingMovePct(row);
  const balanceKnown = row.places.length === 0 || row.places.some((place) => place.balanceKnown);
  const places = sourcePlaces(symbol, row.places);
  const split =
    prefs.currency === "ZAR" && symbol === "USDC" && props.usdcDebts ? usdcOwedSplit(props.usdcDebts, props.lunoUsdc) : null;
  const blocks = profileBlocks(places, split?.lines);
  const showBlocks = blocks.some((block) => block.places.length > 0 || block.owed);
  return (
    <Link
      to={`/portfolio/${encodeURIComponent(symbol)}`}
      viewTransition
      preventScrollReset
      aria-current={props.active ? "page" : undefined}
      className={cx(
        "group flex min-h-16 w-full min-w-0 max-w-full items-start gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-card-elevated focus-visible:bg-card-elevated",
        props.active && "bg-card-elevated shadow-[inset_0_0_0_1px_var(--color-border-strong)]",
      )}
    >
      <AssetIcon asset={row.asset} places={row.places} size={36} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="text-body font-semibold">{title}</span>
          <span className="min-w-0 truncate text-caption text-muted-foreground">{assetName(symbol)}</span>
        </span>
        {showBlocks ? (
          <span className="mt-0.5 block min-w-0 text-caption text-muted-foreground">
            {blocks.map((block, groupIndex) => (
              <span key={`${block.profile ?? "none"}-${groupIndex}`} className="block min-w-0">
                {groupIndex > 0 ? <span className="my-1 block h-px bg-foreground/15" aria-hidden="true" /> : null}
                {block.places.map((place) => (
                  <span key={`${place.exchange}-${place.wallet}-${place.profile ?? ""}`} className="flex min-w-0 items-center gap-1 break-words">
                    <ExchangeMark exchange={place.exchange} />
                    <span className="min-w-0">
                      {placeText(place)}
                      {places.length > 1 ? <span className="tabular"> · {prefs.money(place.usd, { compact: true })}</span> : null}
                    </span>
                  </span>
                ))}
                {block.owed ? (
                  <span className="block min-w-0 break-words text-micro font-medium text-warn tabular">
                    <Balance text={usdcOwedLineText(block.owed)} />
                  </span>
                ) : null}
              </span>
            ))}
          </span>
        ) : row.places.length === 0 ? (
          <span className="mt-0.5 block text-caption text-muted-foreground">{fmtPct(row.pctOfTotal)}</span>
        ) : null}
        {split ? (
          <span className="mt-0.5 block break-words text-micro font-medium text-warn tabular">
            <Balance text={split.priceLabel} />
          </span>
        ) : row.debtUsd > 0 ? (
          <OwedWarning row={row} lunoUsdc={props.lunoUsdc} />
        ) : null}
      </span>
      <span className="shrink-0 text-right">
        {quote ? (
          <>
            <span className="block text-micro text-muted-foreground tabular">{quote.date}</span>
            <span className="block text-body font-semibold tabular">
              <Balance text={quote.amount} />
            </span>
            {movePct != null ? <Delta pct={movePct} currency={prefs.currency} size="sm" /> : null}
          </>
        ) : (
          <>
            <span className="block text-body font-semibold tabular">{balanceKnown ? prefs.money(row.usd, { whole: true }) : "—"}</span>
            {row.change24hPct != null && !STABLE.has(symbol) ? (
              <Delta pct={row.change24hPct} currency={prefs.currency} size="sm" />
            ) : movePct != null ? (
              <Delta pct={movePct} currency={prefs.currency} size="sm" />
            ) : (
              <span className="block text-micro text-subtle">—</span>
            )}
          </>
        )}
      </span>
    </Link>
  );
}

function PortfolioSkeleton(props: { split: boolean }) {
  const list = (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading holdings">
      <Skeleton className="h-8 w-40 rounded-lg" />
      <Card>
        <Skeleton className="h-4 w-20 rounded" />
        <Skeleton className="mt-2 h-8 w-48 rounded-lg" />
        <Skeleton className="mt-4 h-2 w-full rounded-full" />
      </Card>
      <Skeleton className="h-11 w-full rounded-full" />
      <Card>
        {[0, 1, 2, 3, 4].map((index) => (
          <div key={index} className="flex items-center gap-3 py-2.5">
            <Skeleton className="size-9 rounded-full" />
            <div className="flex-1">
              <Skeleton className="h-4 w-24 rounded" />
              <Skeleton className="mt-1.5 h-3 w-32 rounded" />
            </div>
            <Skeleton className="h-4 w-20 rounded" />
          </div>
        ))}
      </Card>
    </div>
  );
  if (!props.split) return list;
  return (
    <div className="grid grid-cols-[minmax(320px,380px)_minmax(0,1fr)] gap-6 wide:grid-cols-[400px_minmax(0,1fr)]">
      {list}
      <Card className="h-[420px]">
        <Skeleton className="h-full w-full rounded-xl" />
      </Card>
    </div>
  );
}
