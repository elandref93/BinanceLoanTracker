import type { AssetPosition, LedgerEventView, PortfolioAssetDetail } from "@workspace/api-client-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router";

import { PerformanceChart, type ChartTone } from "@/charts/PerformanceChart";
import { fmtDateTime, fmtDayMonth, fmtDisplayMoney, fmtNum, fmtPct, fmtQty, fmtSignedPct, fmtTime, fmtUsd, MINUS, NBSP } from "@/domain/format";
import {
  assetName,
  collapseRecurring,
  displayHoldingTitle,
  holdingTitle,
  isNinetyOneHolding,
  isPeresecHolding,
  holdingMovePct,
  isStatementName,
  eventLabel,
  eventsByMonth,
  exchangeLabel,
  sliceRange,
  describeHeldPosition,
  statementQuoteParts,
  unrealizedPct,
  whereLabel,
  type ActivityRow,
  type HeldRowCopy,
  type AssetRange,
} from "@/portfolio/holdings";
import { ExpectedReturnCard } from "@/portfolio/ExpectedReturnCard";
import { PortfolioUnavailable } from "@/portfolio/PortfolioUnavailable";
import { isSavedSnapshot } from "@/portfolio/snapshotFlags";
import { investmentPath, layerForStep, lookthroughLines, parseDrillStep, productLabel, readInvestmentLayer, type InvestmentLayer, type LookthroughLine } from "@/portfolio/perecDrill";
import { useAssetDetail } from "@/portfolio/queries";
import { Balance, useDiscreet } from "@/prefs/DiscreetMode";
import { DISCREET_PLACEHOLDER } from "@/prefs/discreet";
import { usePrefs, useProfileName } from "@/prefs/PreferencesProvider";
import { AssetIcon, displaySymbol, ExchangeMark } from "@/ui/AssetIcon";
import { Icon, type IconName } from "@/ui/Icon";
import { useRollingNumber } from "@/ui/motion";
import { Button, Card, cx, Delta, deltaTone, EmptyState, Notice, PageHeader, Segmented, Skeleton, SourceTag } from "@/ui/primitives";

type ChartMode = "value" | "price";

const MODES: ReadonlyArray<{ value: ChartMode; label: string }> = [
  { value: "value", label: "Value" },
  { value: "price", label: "Price" },
];

const RANGES: ReadonlyArray<{ value: AssetRange; label: string }> = [
  { value: "1W", label: "1W" },
  { value: "1M", label: "1M" },
  { value: "3M", label: "3M" },
  { value: "1Y", label: "1Y" },
];

const RANGE_CAPTION: Record<AssetRange, string> = {
  "1W": "past week",
  "1M": "past month",
  "3M": "past 3 months",
  "1Y": "past year",
};

const USD_STABLES = new Set(["USDT", "USDC", "FDUSD", "TUSD", "DAI", "BUSD"]);
const ACTIVITY_PAGE = 30;

function clientError(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" && status >= 400 && status < 500 && status !== 429;
}

export function AssetDetail(props: { asset: string; showBack?: boolean }) {
  const detail = useAssetDetail(props.asset);
  const data = detail.data;
  const { search } = useLocation();
  const [searchParams] = useSearchParams();
  const step = parseDrillStep(searchParams.get("inside"));
  const portfolioSearch = new URLSearchParams(search);
  portfolioSearch.delete("inside");
  const portfolioQuery = portfolioSearch.toString();
  const portfolioBack = props.showBack ? { to: portfolioQuery ? `/portfolio?${portfolioQuery}` : "/portfolio", label: "Portfolio" } : undefined;
  const symbol = displaySymbol(props.asset);
  const heading = holdingTitle(symbol);
  const up =
    step === "eib"
      ? { to: investmentPath(symbol, "weib"), label: "WEIB" }
      : step === "weib"
        ? { to: investmentPath(symbol), label: heading }
        : portfolioBack;

  if (detail.isPending) return <DetailSkeleton back={up} />;
  if (detail.isError && !data) {
    const finished = clientError(detail.error);
    return (
      <>
        {up ? <PageHeader title={heading} back={up} /> : null}
        <Notice tone="danger" title={finished ? `${heading} is not available` : `${heading} could not be loaded`} action={<Button size="sm" onClick={() => void detail.refetch()}>Try again</Button>}>
          {finished ? "This holding could not be opened." : "Ledger will keep retrying in the background."}
        </Notice>
      </>
    );
  }
  if (!data || !data.available) return <PortfolioUnavailable reason={(data as { reason?: string } | undefined)?.reason} title="This asset is not available yet" />;
  const inside = readInvestmentLayer((data as { inside?: unknown }).inside);
  const drill = layerForStep(inside, step);
  if (drill.current) return <LayerScreen layer={drill.current} next={drill.next} asset={symbol} back={up} stale={detail.isPlaceholderData} />;
  return <DetailContent detail={data} back={portfolioBack} next={drill.next} stale={detail.isPlaceholderData} />;
}

function DetailContent(props: { detail: PortfolioAssetDetail; back?: { to: string; label: string }; next: InvestmentLayer | null; stale: boolean }) {
  const prefs = usePrefs();
  const { detail } = props;
  const row = detail.asset;
  const symbol = displaySymbol(row.asset);
  const heading = assetName(symbol) || holdingTitle(symbol, row.positions);
  const statement = isStatementName(symbol);
  const savedSnapshot = isSavedSnapshot(detail);
  const held = row.qty > 0 || row.debtQty > 0 || (savedSnapshot && row.usd > 0) || statement;
  const quote = statementQuoteParts({
    quoteDate: row.quoteDate,
    quoteCurrency: row.quoteCurrency,
    qty: row.qty,
    places: row.positions.map((position) => ({ balanceKnown: position.balanceKnown !== false && position.includeInTotal !== false })),
  });
  const movePct = holdingMovePct(row);

  return (
    <div className={cx("@container transition-opacity duration-200", props.stale ? "opacity-60" : "opacity-100")}>
      <PageHeader
        title={heading}
        back={props.back}
        leading={<AssetIcon asset={symbol} places={row.positions} size={44} />}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="tabular">
              {savedSnapshot ? (
                `${heading} · loan collateral from the saved snapshot`
              ) : statement ? (
                quote ? (
                  <>
                    {quote.date} · <Balance text={quote.amount} />
                  </>
                ) : (
                  "Statement balance"
                )
              ) : (
                <>
                  {symbol} · {prefs.money(row.priceUsd)}
                </>
              )}
            </span>
            {row.change24hPct != null && !USD_STABLES.has(symbol) ? (
              <span className="inline-flex items-center gap-1">
                <Delta pct={row.change24hPct} currency={prefs.currency} size="sm" />
                <span className="text-micro">24h</span>
              </span>
            ) : movePct != null ? (
              <Delta pct={movePct} currency={prefs.currency} size="sm" />
            ) : null}
          </span>
        }
      />
      {!held ? (
        <Card className="mb-4">
          <EmptyState icon="portfolio" title={`No ${heading} in this profile`} body="Switch profile in the top bar, or browse price history below." />
        </Card>
      ) : null}
      <div className="grid grid-cols-1 gap-4 @[760px]:grid-cols-2 lg:gap-5">
        <HeroCard detail={detail} savedSnapshot={savedSnapshot} className="@[760px]:col-span-2" />
        {held ? <ExpectedReturnCard detail={detail} savedSnapshot={savedSnapshot} className="@[760px]:col-span-2" /> : null}
        {props.next ? <InsideLink layer={props.next} to={investmentPath(symbol, props.next.kind)} className="@[760px]:col-span-2" /> : null}
        {statement ? null : <CostCard detail={detail} savedSnapshot={savedSnapshot} />}
        <HeldCard detail={detail} savedSnapshot={savedSnapshot} />
        {statement ? null : <ActivityCard events={detail.events} symbol={symbol} savedSnapshot={savedSnapshot} className="@[760px]:col-span-2" />}
      </div>
    </div>
  );
}

function HeroCard(props: { detail: PortfolioAssetDetail; savedSnapshot?: boolean; className?: string }) {
  const prefs = usePrefs();
  const { detail } = props;
  const row = detail.asset;
  const symbol = displaySymbol(row.asset);
  const statement = isStatementName(symbol);
  const [mode, setMode] = useState<ChartMode>(row.qty > 0 || statement ? "value" : "price");
  const [range, setRange] = useState<AssetRange>("1M");
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const heroRef = useRef<HTMLSpanElement | null>(null);

  const asOfMs = useMemo(() => {
    const last = detail.priceHistory[detail.priceHistory.length - 1];
    return last ? Date.parse(last.t) : Date.now();
  }, [detail.priceHistory]);

  const points = useMemo(() => {
    if (mode === "price") return sliceRange(detail.priceHistory, range, asOfMs).map((point) => ({ t: point.t, usd: point.usd }));
    const history = detail.holdingHistory.map((point) => ({ t: point.t, usd: point.usd }));
    const lastT = history[history.length - 1]?.t;
    if (!lastT || Date.parse(lastT) < asOfMs - 60_000) history.push({ t: new Date(asOfMs).toISOString(), usd: row.usd });
    return sliceRange(history, range, asOfMs);
  }, [asOfMs, detail.holdingHistory, detail.priceHistory, mode, range, row.usd]);

  const values = useMemo(() => points.map((point) => point.usd), [points]);
  const first = points[0];
  const last = points[points.length - 1];
  const enough = values.length >= 2 && values.some((value) => value !== values[0]);
  const change = first && last ? last.usd - first.usd : null;
  const changePct = first && last && first.usd > 0 ? (last.usd / first.usd - 1) * 100 : null;
  const tone: ChartTone = deltaTone(change);
  const scrubbed = scrubIndex != null ? points[scrubIndex] ?? null : null;

  const discreet = useDiscreet();
  const headline = mode === "value" ? row.usd : row.priceUsd;
  const display = prefs.convert(headline) ?? headline;
  const currency = prefs.convert(headline) == null ? "USD" : prefs.currency;
  const format = useCallback(
    (value: number) => (discreet.hidden ? DISCREET_PLACEHOLDER : fmtDisplayMoney(value, currency)),
    [currency, discreet.hidden],
  );
  useRollingNumber(heroRef, display, format);

  const label =
    enough && first && last
      ? `${mode === "value" ? `${symbol} holdings value` : `${symbol} price`} from ${discreet.mask(prefs.formatMoney(first.usd))} on ${fmtDayMonth(first.t)} to ${discreet.mask(prefs.formatMoney(last.usd))}, ${RANGE_CAPTION[range]}.`
      : "Not enough history for a chart yet.";

  return (
    <Card className={props.className} aria-labelledby="asset-hero-label">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p id="asset-hero-label" className="text-caption font-medium text-muted-foreground">
            {scrubbed ? fmtDateTime(scrubbed.t) : mode === "value" ? "Holdings value" : `Price per ${symbol}`}
          </p>
          <p className="mt-1 tabular max-w-full text-[clamp(1.6rem,8vw,2rem)] font-semibold leading-tight tracking-tight sm:text-[36px] sm:leading-[42px]">
            <span ref={heroRef} aria-hidden="true" data-balance={discreet.enabled ? "" : undefined} className={scrubbed ? "hidden" : undefined} />
            <span className="sr-only">{prefs.money(headline)}</span>
            {scrubbed ? <span aria-hidden="true">{prefs.money(scrubbed.usd)}</span> : null}
          </p>
          <p className="mt-1 text-caption tabular text-muted-foreground">
            {props.savedSnapshot ? "Quantity is not in the saved snapshot" : statement ? "Statement balance" : <Balance text={fmtQty(row.qty, symbol)} />}
            {row.pct > 0 ? ` · ${fmtPct(row.pct)} of ${props.savedSnapshot ? "collateral" : "holdings"}` : ""}
          </p>
        </div>
        {row.qty > 0 && !statement ? <Segmented label="Chart shows" options={MODES} value={mode} onChange={(next) => { setScrubIndex(null); setMode(next); }} size="sm" className="w-[160px]" /> : null}
      </div>
      <div className="mt-4 mb-2 flex min-h-5 items-center gap-2">
        {change != null && enough ? (
          <>
            <Delta amount={prefs.convert(change)} pct={changePct} currency={prefs.currency} size="sm" />
            <span className="text-micro text-muted-foreground">
              {mode === "value" ? "change in value" : "price change"}, {RANGE_CAPTION[range]}
            </span>
          </>
        ) : null}
      </div>
      <div className="relative h-[180px] sm:h-[220px] lg:h-[240px] wide:h-[280px]">
        {enough ? (
          <PerformanceChart values={values} baseline={first?.usd ?? null} tone={tone} label={label} onScrub={setScrubIndex} className="h-full w-full" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 text-center">
            <Icon name="history" size={22} className="text-subtle" />
            <p className="mt-2 text-caption text-muted-foreground">
              {props.savedSnapshot
                ? "Price and holding history are not in the saved snapshot."
                : mode === "value"
                  ? "Holding history fills in as snapshots and the import build up."
                  : "No price history for this asset yet."}
            </p>
          </div>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <Segmented label="Chart range" options={RANGES} value={range} onChange={(next) => { setScrubIndex(null); setRange(next); }} size="sm" className="w-full max-w-[280px]" />
        {prefs.currency === "ZAR" ? <span className="hidden text-micro text-subtle sm:inline">Rand at today's rate</span> : null}
      </div>
    </Card>
  );
}

function CostCard(props: { detail: PortfolioAssetDetail; savedSnapshot?: boolean }) {
  const prefs = usePrefs();
  const { detail } = props;
  const row = detail.asset;
  const basis = detail.costBasis;
  const symbol = displaySymbol(row.asset);
  const pct = unrealizedPct(row);

  return (
    <Card aria-labelledby="asset-cost-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="asset-cost-title" className="text-heading font-semibold">
          Cost and returns
        </h2>
        {basis ? (
          <span className="flex flex-wrap gap-1.5">
            <SourceTag>{basis.method === "fifo" ? "First in, first out" : "Weighted average"}</SourceTag>
            {!basis.complete ? <SourceTag tone="warn">Partial history</SourceTag> : null}
          </span>
        ) : null}
      </div>
      {basis && row.asset !== "ZAR" ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
          <div className="min-w-0">
            <dt className="text-micro font-medium uppercase tracking-wider text-muted-foreground">Average cost</dt>
            <dd className="mt-1 truncate text-body font-semibold tabular">{basis.avgCostUsd != null ? prefs.money(basis.avgCostUsd) : "—"}</dd>
            <dd className="mt-0.5 text-micro text-muted-foreground">per {symbol}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-micro font-medium uppercase tracking-wider text-muted-foreground">Cost basis</dt>
            <dd className="mt-1 truncate text-body font-semibold tabular">{prefs.money(basis.totalCostUsd, { whole: true })}</dd>
            <dd className="mt-0.5 text-micro text-muted-foreground tabular">
              <Balance text={fmtQty(basis.qty, symbol)} />
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-micro font-medium uppercase tracking-wider text-muted-foreground">Unrealised</dt>
            <dd className="mt-1">
              {row.unrealizedUsd != null ? <Delta amount={prefs.convert(row.unrealizedUsd)} currency={prefs.currency} /> : <span className="text-body text-muted-foreground">—</span>}
            </dd>
            {pct != null ? <dd className="mt-0.5 text-micro text-muted-foreground tabular">{fmtSignedPct(pct)} on cost</dd> : null}
          </div>
          <div className="min-w-0">
            <dt className="text-micro font-medium uppercase tracking-wider text-muted-foreground">Realised</dt>
            <dd className="mt-1">
              <Delta amount={prefs.convert(basis.realizedUsd)} currency={prefs.currency} />
            </dd>
            <dd className="mt-0.5 text-micro text-muted-foreground">from sales and conversions</dd>
          </div>
        </dl>
      ) : (
        <p className="text-caption text-muted-foreground">
          {props.savedSnapshot
            ? "Cost basis is not in the saved snapshot."
            : row.asset === "ZAR"
              ? "Rand is cash, so it has no cost basis."
              : "Cost basis appears once the transaction history import finishes."}
        </p>
      )}
      {basis && !basis.complete ? (
        <p className="mt-3 text-micro text-muted-foreground">Some history is missing or was adjusted to match exchange balances, so these figures are estimates.</p>
      ) : null}
    </Card>
  );
}

function HeldCard(props: { detail: PortfolioAssetDetail; savedSnapshot?: boolean }) {
  const prefs = usePrefs();
  const profileName = useProfileName();
  const row = props.detail.asset;
  const raw = displaySymbol(row.asset);
  const symbol = holdingTitle(raw, row.positions);
  const positions = [...row.positions].sort((a, b) => b.usd - a.usd);
  const showProfile = new Set(positions.map((position) => position.containerId ?? "none")).size > 1 || (prefs.person === "user" && prefs.scope === "all");
  const entries = positions.flatMap((position) => {
    const copy = heldCopy(position, symbol, showProfile ? profileName(position.containerId ?? "none") : null);
    return copy ? [{ position, copy }] : [];
  });

  return (
    <Card aria-labelledby="asset-held-title">
      <h2 id="asset-held-title" className="mb-2 text-heading font-semibold">
        Where it's held
      </h2>
      {entries.length === 0 && row.debtQty <= 0 ? (
        <p className="text-caption text-muted-foreground">{positions.length > 0 ? "No open positions in this account." : "Nothing held right now."}</p>
      ) : null}
      <ul className="-mx-1">
        {entries.map(({ position, copy }) => (
          <li key={`${position.linkId}:${position.wallet}`}>
            <PositionRow position={position} copy={copy} share={row.usd > 0 ? (position.usd / row.usd) * 100 : 0} symbol={symbol} savedSnapshot={props.savedSnapshot} />
          </li>
        ))}
        {row.debtQty > 0 ? (
          <li>
            <Link to="/loans" viewTransition className="mt-1 flex min-h-14 items-center gap-3 rounded-xl px-1 py-2 transition-colors hover:bg-card-elevated">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-warn/10 text-warn">
                <Icon name="loans" size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-body font-medium">Borrowed</span>
                <span className="block truncate text-caption text-muted-foreground tabular">
                  <Balance text={`${fmtQty(row.debtQty, symbol)} owed on loans`} />
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-body font-semibold tabular text-warn">{prefs.money(row.debtUsd, { whole: true })}</span>
                {USD_STABLES.has(symbol) && prefs.currency === "ZAR" ? (
                  <span className="block text-micro text-muted-foreground tabular">
                    <Balance text={fmtUsd(row.debtQty, { whole: true })} />
                  </span>
                ) : null}
              </span>
              <Icon name="chevronRight" size={16} className="shrink-0 text-subtle" />
            </Link>
          </li>
        ) : null}
      </ul>
    </Card>
  );
}

function heldCopy(position: AssetPosition, symbol: string, profile: string | null): HeldRowCopy | null {
  const nested = position.includeInTotal === false;
  const instrument = displayHoldingTitle(position.linkName, isPeresecHolding(position.linkName, [position]));
  const hideSource = !nested && position.exchange === "pickle_rick" && isNinetyOneHolding(position.linkName, [position]);
  const where = hideSource ? "" : whereLabel(position.exchange, position.wallet, null);
  return describeHeldPosition(position, { instrument, profile, where, hideSource, symbol });
}

function PositionRow(props: { position: AssetPosition; copy: HeldRowCopy; share: number; symbol: string; savedSnapshot?: boolean }) {
  const prefs = usePrefs();
  const { position, copy } = props;
  const balanceKnown = position.balanceKnown !== false;
  const exchangeMark = copy.markOn === "none" ? null : <ExchangeMark exchange={position.exchange} />;
  const titleClass = copy.wrap ? "min-w-0 break-words" : "min-w-0 truncate";
  return (
    <div className="px-1 py-2.5">
      <div className={cx("flex gap-3", copy.wrap ? "items-start" : "items-center")}>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1 text-body font-medium">
            {copy.markOn === "title" ? exchangeMark : null}
            <span className={titleClass}>{copy.title}</span>
          </span>
          {copy.caption ? (
            <span className="flex min-w-0 items-center gap-1 text-caption text-muted-foreground">
              {copy.markOn === "caption" ? exchangeMark : null}
              <span className={copy.wrap ? "min-w-0 break-words" : "min-w-0 truncate"}>{copy.caption}</span>
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-body font-semibold tabular">{balanceKnown ? prefs.money(position.usd, { whole: true }) : "—"}</span>
          {copy.repeatAccountQuantity ? (
            <span className="block text-micro text-muted-foreground tabular">
              {!balanceKnown ? "—" : props.savedSnapshot && position.qty === 0 ? "Qty not in snapshot" : <Balance text={fmtQty(position.qty, props.symbol)} />}
            </span>
          ) : null}
        </span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-card-elevated" aria-hidden="true">
        <div className="h-full origin-left animate-grow-x rounded-full bg-primary/70" style={{ width: `${Math.max(props.share, 1)}%` }} />
      </div>
    </div>
  );
}

function ActivityCard(props: { events: LedgerEventView[]; symbol: string; savedSnapshot?: boolean; className?: string }) {
  const [limit, setLimit] = useState(ACTIVITY_PAGE);
  const months = useMemo(() => eventsByMonth(props.events).map((month) => ({ ...month, rows: collapseRecurring(month.events) })), [props.events]);
  const total = months.reduce((sum, month) => sum + month.rows.length, 0);
  let budget = limit;

  return (
    <Card className={props.className} aria-labelledby="asset-activity-title">
      <div className="mb-1 flex items-end justify-between gap-3">
        <h2 id="asset-activity-title" className="text-heading font-semibold">
          Activity
        </h2>
        {props.events.length > 0 ? <span className="text-micro text-muted-foreground">Latest {props.events.length} entries</span> : null}
      </div>
      {months.length === 0 ? (
        <p className="py-4 text-caption text-muted-foreground">
          {props.savedSnapshot ? `Transactions for ${props.symbol} are not in the saved snapshot.` : `No transactions for ${props.symbol} have been imported yet.`}
        </p>
      ) : (
        months.map((month) => {
          if (budget <= 0) return null;
          const rows = month.rows.slice(0, budget);
          budget -= rows.length;
          return (
            <section key={month.key} aria-label={month.label} className="mt-3">
              <h3 className="sticky top-0 z-[1] -mx-1 bg-card px-1 py-1 text-micro font-medium uppercase tracking-wider text-muted-foreground">{month.label}</h3>
              <ul>
                {rows.map((row) => (
                  <li key={row.key}>
                    <ActivityItem row={row} symbol={props.symbol} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
      {total > limit ? (
        <div className="mt-3 flex justify-center">
          <Button size="sm" variant="ghost" onClick={() => setLimit((value) => value + ACTIVITY_PAGE * 2)}>
            Show more
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function activityIcon(type: string, debt: boolean): IconName {
  if (debt || type === "borrow" || type === "repay" || type === "interest") return "loans";
  if (type === "deposit") return "arrowDown";
  if (type === "withdrawal") return "arrowUp";
  if (type === "buy") return "plus";
  if (type === "sell" || type === "convert") return "swap";
  if (type === "income") return "sparkle";
  if (type === "fee") return "bolt";
  return "edit";
}

function signedQty(qty: number, symbol: string): string {
  const text = fmtQty(Math.abs(qty), symbol);
  return qty > 0 ? `+${text}` : qty < 0 ? `${MINUS}${text}` : text;
}

function ActivityItem(props: { row: ActivityRow; symbol: string }) {
  const prefs = usePrefs();
  const profileName = useProfileName();
  const { row } = props;
  const type = row.kind === "event" ? row.event.type : row.type;
  const debt = row.kind === "event" ? row.event.debt : row.debt;
  const qty = row.kind === "event" ? row.event.qty : row.qty;
  const usd = row.kind === "event" ? row.event.usd : row.usd;
  const exchange = row.kind === "event" ? row.event.exchange : row.exchange;
  const containerId = row.kind === "event" ? row.event.containerId : row.containerId;
  const title =
    row.kind === "summary"
      ? `${type === "income" ? "Earn rewards" : debt ? "Interest added to loans" : "Interest"} · ${row.count}${NBSP}entries`
      : debt
        ? type === "borrow"
          ? "Loan taken"
          : type === "repay"
            ? "Loan repaid"
            : type === "interest"
              ? "Interest added to loan"
              : `${eventLabel(row.event)} (loan)`
        : eventLabel(row.event);
  const when =
    row.kind === "summary"
      ? `${fmtDayMonth(row.from)} to ${fmtDayMonth(row.to)}`
      : `${fmtDayMonth(row.event.t)}, ${fmtTime(row.event.t)}`;
  const note = row.kind === "event" && row.event.note ? row.event.note : null;
  const where = [exchangeLabel(exchange), prefs.person === "user" && prefs.scope === "all" && prefs.containers.length > 1 ? profileName(containerId ?? "none") : null].filter(Boolean).join(" · ");
  // Debt rows carry a negative qty when the amount owed grows.
  const owedGrows = debt && qty < 0;
  const tone = debt ? (owedGrows ? "text-loss" : "text-gain") : qty > 0 ? "text-gain" : qty < 0 ? "text-foreground" : "text-muted-foreground";
  const amount = debt ? `${owedGrows ? "+" : MINUS}${fmtQty(Math.abs(qty), props.symbol)} owed` : signedQty(qty, props.symbol);

  return (
    <div className="flex min-h-14 items-center gap-3 py-2">
      <span className={cx("flex size-9 shrink-0 items-center justify-center rounded-full", debt ? "bg-warn/10 text-warn" : "bg-card-elevated text-muted-foreground")}>
        <Icon name={activityIcon(type, debt)} size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium">{title}</span>
        <span className="block truncate text-caption text-muted-foreground">
          {when}
          {where ? ` · ${where}` : ""}
          {note && note !== title ? ` · ${note}` : ""}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className={cx("block text-caption font-semibold tabular", tone)}>
          <Balance text={amount} />
        </span>
        {usd != null ? <span className="block text-micro text-muted-foreground tabular">{prefs.money(Math.abs(usd), { whole: Math.abs(usd) >= 100 })}</span> : null}
      </span>
    </div>
  );
}

function layerMoney(value: number | null, currency: string): string {
  if (value == null) return "—";
  return currency ? `${fmtNum(value, 2)} ${currency}` : fmtNum(value, 2);
}

function lineQuantity(value: number | null): string {
  if (value == null) return "—";
  if (Number.isInteger(value)) return fmtNum(value, 0);
  const places = Math.abs(value) >= 1 ? 4 : 6;
  return fmtNum(value, places);
}

function InsideLink(props: { layer: InvestmentLayer; to: string; className?: string }) {
  return (
    <Card className={props.className} aria-labelledby="asset-inside-title">
      <h2 id="asset-inside-title" className="mb-1 text-heading font-semibold">
        Inside
      </h2>
      <Link to={props.to} viewTransition className="flex min-h-14 items-center gap-3 rounded-xl px-1 py-2 transition-colors hover:bg-card-elevated">
        <span className="min-w-0 flex-1">
          <span className="block text-body font-medium">{props.layer.name}</span>
          <span className="block text-caption text-muted-foreground">{props.layer.currency || "Statement layer"}</span>
        </span>
        <span className="shrink-0 text-body font-semibold tabular">
          <Balance text={layerMoney(props.layer.value, props.layer.currency)} />
        </span>
        <Icon name="chevronRight" size={16} className="shrink-0 text-subtle" />
      </Link>
    </Card>
  );
}

function LineList(props: { title: string; lines: LookthroughLine[] }) {
  if (props.lines.length === 0) return null;
  return (
    <div className="mt-3">
      <h3 className="text-caption font-medium text-muted-foreground">{props.title}</h3>
      <ul>
        {props.lines.map((line, index) => (
          <li key={`${props.title}|${index}`} className="flex min-h-14 items-center gap-3 border-t border-border py-2 first:border-t-0">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body font-medium">{line.name}</span>
              <span className="block text-caption text-muted-foreground tabular">{lineQuantity(line.quantity)}</span>
            </span>
            <span className="shrink-0 text-caption font-semibold tabular">
              <Balance text={layerMoney(line.value, line.currency)} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LayerLines(props: { layer: InvestmentLayer }) {
  const lines = lookthroughLines(props.layer);
  if (lines == null) return null;
  if (lines === "unavailable") {
    return (
      <Card aria-labelledby="layer-lines-title">
        <h2 id="layer-lines-title" className="text-heading font-semibold">
          Lines
        </h2>
        <p className="mt-3 text-caption text-muted-foreground">The portal did not return the lines.</p>
      </Card>
    );
  }
  const asOf = props.layer.linesAsOf;
  return (
    <Card aria-labelledby="layer-lines-title">
      <h2 id="layer-lines-title" className="text-heading font-semibold">
        Lines
      </h2>
      {asOf ? <p className="mt-1 text-caption text-muted-foreground">{fmtDayMonth(`${asOf}T12:00:00+02:00`)}</p> : null}
      <LineList title="Assets" lines={lines.assets} />
      <LineList title="Cash" lines={lines.cash} />
    </Card>
  );
}

function LayerScreen(props: { layer: InvestmentLayer; next: InvestmentLayer | null; asset: string; back?: { to: string; label: string }; stale: boolean }) {
  const { layer } = props;
  return (
    <div className={cx("flex flex-col gap-4 transition-opacity duration-200", props.stale ? "opacity-60" : "opacity-100")}>
      <PageHeader
        title={layer.name}
        back={props.back}
        subtitle={<span>{holdingTitle(props.asset)}</span>}
      />
      <Card aria-labelledby="layer-value-title">
        <p id="layer-value-title" className="text-caption font-medium text-muted-foreground">
          {layer.currency ? `${layer.name} · ${layer.currency}` : layer.name}
        </p>
        <p className="mt-1 text-[clamp(1.6rem,8vw,2rem)] font-semibold leading-tight tracking-tight tabular">
          <Balance text={layerMoney(layer.value, layer.currency)} />
        </p>
      </Card>
      {props.next ? <InsideLink layer={props.next} to={investmentPath(props.asset, props.next.kind)} /> : null}
      <LayerLines layer={layer} />
      <Card aria-labelledby="layer-history-title">
        <h2 id="layer-history-title" className="text-heading font-semibold">
          History
        </h2>
        {layer.points.length === 0 ? (
          <p className="mt-3 text-caption text-muted-foreground">No history for this layer yet.</p>
        ) : (
          <ul className="mt-2">
            {layer.points.map((point) => (
              <li key={`${point.date}|${point.product}`} className="flex min-h-14 items-center gap-3 border-t border-border py-2 first:border-t-0">
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-medium">{fmtDayMonth(`${point.date}T12:00:00+02:00`)}</span>
                  <span className="block text-caption text-muted-foreground">{productLabel(point.product)}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-caption font-semibold tabular">
                    <Balance text={layerMoney(point.value, point.currency || layer.currency)} />
                  </span>
                  <span className="block text-micro text-muted-foreground tabular">
                    {point.change == null ? "—" : <Balance figure text={fmtNum(point.change, 2)} />}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function DetailSkeleton(props: { back?: { to: string; label: string } }) {
  return (
    <div aria-busy="true" aria-label="Loading asset">
      {props.back ? (
        <Link to={props.back.to} viewTransition className="-ml-2 mb-2 inline-flex min-h-11 items-center gap-1 rounded-ledger px-2 text-body text-primary">
          <Icon name="chevronLeft" size={18} />
          {props.back.label}
        </Link>
      ) : null}
      <div className="mb-5 flex items-center gap-3">
        <Skeleton className="size-11 rounded-full" />
        <div>
          <Skeleton className="h-6 w-32 rounded-lg" />
          <Skeleton className="mt-1.5 h-4 w-44 rounded" />
        </div>
      </div>
      <Card>
        <Skeleton className="h-4 w-28 rounded" />
        <Skeleton className="mt-2 h-9 w-56 rounded-lg" />
        <Skeleton className="mt-6 h-[200px] w-full rounded-xl" />
      </Card>
    </div>
  );
}
