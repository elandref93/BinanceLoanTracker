import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AccountChip } from "@/components/AccountChip";
import { AssetIcon } from "@/components/AssetIcon";
import { Container } from "@/components/Container";
import { DonutChart, type DonutSegment } from "@/components/DonutChart";
import { ExchangeLogo } from "@/components/ExchangeLogo";
import { ErrorView } from "@/components/ErrorView";
import { ScreenLoader } from "@/components/ScreenLoader";
import { Sparkline } from "@/components/Sparkline";
import { useColors } from "@/hooks/useColors";
import { useCurrency } from "@/context/CurrencyContext";
import { useRiskSettings } from "@/context/RiskSettingsContext";
import { useLunoHistory } from "@/hooks/useLunoHistory";
import { haptic } from "@/lib/haptics";
import {
  pairsForAssets,
  quoteWalletInFiat,
  displayAsset,
} from "@/lib/lunoPricing";
import { recordLunoSample } from "@/lib/lunoHistory";
import { fmtMoney } from "@/utils/format";

import {
  useGetLunoTickers,
  useGetPrices,
  useListHoldings,
  useListLunoPending,
  useListLunoTransactions,
  useListLunoWallets,
  type Holding,
  type LunoTransaction,
  type LunoWallet,
} from "@workspace/api-client-react";

type MergedHolding = {
  symbol: string;
  binance?: Holding;
  binanceQty: number;
  lunoQty: number;
  usd: number;
};

// Allocation colours, assigned by descending value so the largest holding
// always takes the lead (Binance gold) colour. Cycles if a user holds more
// assets than the palette — fine for the handful any of these accounts carry.
const ALLOC_PALETTE = [
  "#F0B90B",
  "#3B82F6",
  "#10B981",
  "#8B5CF6",
  "#EF4444",
  "#14B8A6",
  "#F59E0B",
  "#EC4899",
  "#0EA5E9",
  "#64748B",
];

function allocColor(index: number): string {
  return ALLOC_PALETTE[index % ALLOC_PALETTE.length];
}

function fmtPct(value: number, dp = 1): string {
  return `${value.toFixed(dp)}%`;
}

function fmtCrypto(n: number, asset: string): string {
  const sym = displayAsset(asset);
  const dp = sym === "BTC" || sym === "ETH" ? 8 : 2;
  return `${n.toFixed(dp)} ${sym}`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function CryptoScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { currency } = useCurrency();

  const walletsQ = useListLunoWallets();
  const pendingQ = useListLunoPending();
  const txQ = useListLunoTransactions({ limit: 30 });
  const holdingsQ = useListHoldings();

  const wallets = walletsQ.data?.wallets ?? [];
  const transactions = txQ.data?.transactions ?? [];
  const pending = pendingQ.data?.withdrawals ?? [];
  const binanceHoldings = holdingsQ.data?.holdings ?? [];

  // ── Account isolation (All / Personal / Trust) ──
  // `filter` is the selected container id, or null for the combined view.
  // We resolve each exchange link's owning container via RiskSettings and use
  // it to scope holdings (Luno wallet.accountId, Binance Holding.byAccount) and
  // the transaction list. Composition is derived from these `view*` sources so
  // the donut/totals/list all reflect the selected account.
  const { containers, containerForAccountId } = useRiskSettings();
  const [filter, setFilter] = useState<string | null>(null);

  const matchesFilter = useCallback(
    (accountId: string) =>
      filter == null || containerForAccountId(accountId)?.id === filter,
    [filter, containerForAccountId],
  );

  const viewWallets = useMemo(
    () =>
      filter == null ? wallets : wallets.filter((w) => matchesFilter(w.accountId)),
    [wallets, filter, matchesFilter],
  );

  const viewBinanceHoldings = useMemo<Holding[]>(() => {
    if (filter == null) return binanceHoldings;
    const out: Holding[] = [];
    for (const h of binanceHoldings) {
      const accts = h.byAccount.filter((a) => matchesFilter(a.accountId));
      if (accts.length === 0) continue;
      const fTotal = accts.reduce((s, a) => s + a.total, 0);
      if (fTotal <= 0) continue;
      out.push({
        ...h,
        spot: accts.reduce((s, a) => s + a.spot, 0),
        funding: accts.reduce((s, a) => s + a.funding, 0),
        collateral: accts.reduce((s, a) => s + a.collateral, 0),
        total: fTotal,
        // No per-account USD on the wire; pro-rate the asset's total by quantity.
        usd: h.total > 0 ? (h.usd * fTotal) / h.total : 0,
        byAccount: accts,
      });
    }
    return out;
  }, [binanceHoldings, filter, matchesFilter]);

  const viewTransactions = useMemo(
    () =>
      filter == null
        ? transactions
        : transactions.filter((t) => matchesFilter(t.accountId)),
    [transactions, filter, matchesFilter],
  );

  // Pair coverage: derive the set of pairs we need to quote from the
  // assets the user actually holds (in the selected view), against their
  // display currency. Pure-fiat balances (ZAR when currency=ZAR) need no ticker.
  const neededPairs = useMemo(
    () => pairsForAssets(viewWallets.map((w) => w.asset), currency),
    [viewWallets, currency],
  );
  const tickersQ = useGetLunoTickers(
    { pairs: neededPairs.join(",") },
    // orval's generated options demand a full UseQueryOptions; we only
    // need `enabled` to suppress the request when there are no pairs.
    { query: { enabled: neededPairs.length > 0 } as never },
  );
  const tickerMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tickersQ.data?.tickers ?? []) m.set(t.pair, t.lastTrade);
    return m;
  }, [tickersQ.data]);

  const grouped = useMemo(() => groupByAsset(viewWallets), [viewWallets]);
  const btcReady = grouped.get("XBT")?.totalBalance ?? 0;

  // Per-asset fiat values + portfolio total. Assets without a working
  // ticker contribute zero (already logged server-side); the BTC headline
  // still works as long as XBT→fiat resolves.
  const { perAssetFiat, totalFiat } = useMemo(() => {
    const per = new Map<string, number>();
    let sum = 0;
    for (const [asset, agg] of grouped) {
      const v = quoteWalletInFiat(asset, agg.totalBalance, tickerMap, currency);
      per.set(asset, v);
      sum += v;
    }
    return { perAssetFiat: per, totalFiat: sum };
  }, [grouped, tickerMap, currency]);
  const btcReadyFiat = perAssetFiat.get("XBT") ?? 0;
  const zarCashFiat = perAssetFiat.get("ZAR") ?? 0;

  // Unified holdings: merge Binance (spot + funding + collateral, valued
  // server-side in USD) with Luno per asset. Luno is valued in USD via
  // Binance spot prices so the two exchanges share one denominator —
  // crypto's natural currency. Pure-fiat cash (ZAR) is excluded; it lives
  // in the Luno cash tile above. Stablecoins count at $1.
  const lunoCryptoSymbols = useMemo(() => {
    const s = new Set<string>();
    for (const [asset] of grouped) {
      const sym = displayAsset(asset);
      if (sym === "ZAR" || sym === currency) continue;
      if (sym === "USDT" || sym === "USDC" || sym === "USD") continue;
      s.add(sym);
    }
    return Array.from(s);
  }, [grouped, currency]);

  const pricesQ = useGetPrices(
    { assets: lunoCryptoSymbols.join(",") },
    { query: { enabled: lunoCryptoSymbols.length > 0 } as never },
  );
  const usdPriceMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pricesQ.data?.prices ?? []) m.set(p.asset.toUpperCase(), p.usd);
    return m;
  }, [pricesQ.data]);

  const merged = useMemo<MergedHolding[]>(() => {
    const map = new Map<string, MergedHolding>();
    for (const h of viewBinanceHoldings) {
      const sym = h.asset.toUpperCase();
      map.set(sym, {
        symbol: sym,
        binance: h,
        binanceQty: h.total,
        lunoQty: 0,
        usd: h.usd,
      });
    }
    for (const [asset, agg] of grouped) {
      const sym = displayAsset(asset);
      // Exclude only true fiat cash (Luno's ZAR wallet) — it's surfaced in the
      // Luno cash tile. Composition must NOT depend on the display currency, or
      // a USD-denominated holding would vanish from totals when viewing in USD.
      if (sym === "ZAR") continue;
      const qty = agg.totalBalance + agg.totalReserved;
      if (qty <= 0) continue;
      const usd =
        sym === "USDT" || sym === "USDC" || sym === "USD"
          ? qty
          : qty * (usdPriceMap.get(sym) ?? 0);
      const ex = map.get(sym);
      if (ex) {
        ex.lunoQty += qty;
        ex.usd += usd;
      } else {
        map.set(sym, { symbol: sym, binanceQty: 0, lunoQty: qty, usd });
      }
    }
    return Array.from(map.values())
      .filter((m) => m.binanceQty > 0 || m.lunoQty > 0)
      .sort((a, b) => b.usd - a.usd);
  }, [viewBinanceHoldings, grouped, usdPriceMap, currency]);

  const combinedUsd = useMemo(
    () => merged.reduce((s, m) => s + m.usd, 0),
    [merged],
  );
  const hasBinance = viewBinanceHoldings.length > 0;

  // Stable colour per asset (by descending value, since `merged` is sorted),
  // shared by the donut and the per-row swatch so the legend reads cleanly.
  const colorBySymbol = useMemo(() => {
    const m = new Map<string, string>();
    merged.forEach((h, i) => m.set(h.symbol, allocColor(i)));
    return m;
  }, [merged]);
  const donutSegments = useMemo<DonutSegment[]>(
    () =>
      merged
        .filter((m) => m.usd > 0)
        .map((m) => ({
          value: m.usd,
          color: colorBySymbol.get(m.symbol) ?? allocColor(0),
        })),
    [merged, colorBySymbol],
  );

  // Record a history sample on every fresh, successful render where we
  // actually have a usable fiat figure. Skipping when totalFiat=0
  // prevents a spurious "zero" sample landing during a cold start while
  // tickers are still loading.
  useEffect(() => {
    // Only sample the ALL-account view; a filtered total would poison the
    // cross-device Luno history with a partial figure.
    if (
      filter === null &&
      !walletsQ.isFetching &&
      !tickersQ.isFetching &&
      wallets.length > 0 &&
      totalFiat > 0
    ) {
      void recordLunoSample({ btc: btcReady, fiat: totalFiat, currency });
    }
  }, [
    filter,
    walletsQ.isFetching,
    tickersQ.isFetching,
    wallets.length,
    totalFiat,
    btcReady,
    currency,
  ]);

  const history = useLunoHistory(7 * 24, currency);

  const onRefresh = () => {
    haptic.impact();
    void Promise.all([
      walletsQ.refetch(),
      pendingQ.refetch(),
      txQ.refetch(),
      tickersQ.refetch(),
      holdingsQ.refetch(),
      pricesQ.refetch(),
    ]).then((res) => {
      if (res.some((r) => r.isError)) haptic.error();
      else haptic.success();
    });
  };

  // Wait for ALL data before showing the consolidated view, so the user never
  // sees a partial portfolio that then reshuffles as Luno / prices arrive.
  // `isLoading` is true only for an ENABLED query on its first fetch; a disabled
  // query (e.g. tickers/prices before wallets resolve, or when nothing needs
  // quoting) reports `false`, so it never blocks. The dependent valuation
  // queries (tickersQ/pricesQ) enable once wallets/holdings resolve and then
  // block until their USD values are in — giving a fully-formed combined view.
  const loading =
    walletsQ.isLoading ||
    pendingQ.isLoading ||
    txQ.isLoading ||
    tickersQ.isLoading ||
    holdingsQ.isLoading ||
    pricesQ.isLoading;
  const allError =
    walletsQ.isError && pendingQ.isError && txQ.isError && tickersQ.isError;

  if (loading) return <ScreenLoader hint="Reading exchanges…" />;
  if (allError && wallets.length === 0 && !hasBinance) {
    return <ErrorView message="Couldn't reach your exchanges. Pull to retry." />;
  }

  const noLunoLinked = !walletsQ.isLoading && wallets.length === 0 && !walletsQ.isError;

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{
        paddingTop: insets.top + 16,
        paddingBottom: insets.bottom + 100,
        paddingHorizontal: 16,
        gap: 16,
      }}
      refreshControl={
        <RefreshControl
          refreshing={
            walletsQ.isFetching || pendingQ.isFetching || txQ.isFetching
          }
          onRefresh={onRefresh}
          tintColor={colors.primary}
        />
      }
    >
      <Container style={{ gap: 16 }}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          Portfolio
        </Text>

        {/* Account isolation chips — only meaningful with ≥2 containers. */}
        {containers.length >= 2 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            <AccountChip
              label="All"
              selected={filter === null}
              onPress={() => {
                haptic.tap();
                setFilter(null);
              }}
            />
            {containers.map((c) => (
              <AccountChip
                key={c.id}
                label={c.name}
                selected={filter === c.id}
                onPress={() => {
                  haptic.tap();
                  setFilter(c.id);
                }}
              />
            ))}
          </ScrollView>
        ) : null}

        {/* Consolidated portfolio — total value, allocation donut, and the
            per-asset list (each row expands to its Binance/Luno split). */}
        {merged.length > 0 ? (
          <View style={{ gap: 16 }}>
            <View style={{ gap: 2 }}>
              <Text
                style={[styles.sectionLabel, { color: colors.mutedForeground }]}
              >
                TOTAL · BINANCE + LUNO
              </Text>
              <Text style={[styles.heroValue, { color: colors.foreground }]}>
                {fmtMoney(combinedUsd, currency)}
              </Text>
            </View>

            {donutSegments.length > 0 ? (
              <View style={styles.donutWrap}>
                <DonutChart segments={donutSegments} size={168} strokeWidth={22}>
                  <Text
                    style={[
                      styles.donutCenterValue,
                      { color: colors.foreground },
                    ]}
                  >
                    {merged.length}
                  </Text>
                  <Text
                    style={[
                      styles.donutCenterLabel,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    {merged.length === 1 ? "asset" : "assets"}
                  </Text>
                </DonutChart>
                <View style={styles.legend}>
                  {merged.map((m, i) => (
                    <View key={m.symbol} style={styles.legendRow}>
                      <View
                        style={[
                          styles.legendDot,
                          { backgroundColor: allocColor(i) },
                        ]}
                      />
                      <Text
                        style={[styles.legendSym, { color: colors.foreground }]}
                        numberOfLines={1}
                      >
                        {m.symbol}
                      </Text>
                      <Text
                        style={[
                          styles.legendPct,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        {combinedUsd > 0
                          ? fmtPct((m.usd / combinedUsd) * 100)
                          : "—"}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            <View
              style={[
                styles.card,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  borderRadius: colors.radius,
                },
              ]}
            >
              {merged.map((m, i) => (
                <View key={m.symbol}>
                  {i > 0 ? (
                    <View
                      style={[styles.divider, { backgroundColor: colors.border }]}
                    />
                  ) : null}
                  <HoldingRow
                    m={m}
                    pct={combinedUsd > 0 ? (m.usd / combinedUsd) * 100 : 0}
                    currency={currency}
                    onViewTransactions={() => {
                      haptic.tap();
                      router.push(`/crypto/${m.symbol}`);
                    }}
                  />
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {noLunoLinked ? (
          <View
            style={[
              styles.emptyCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: colors.radius,
              },
            ]}
          >
            <Feather name="link" size={20} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              No Luno account linked
            </Text>
            <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
              Link a Luno read-only key from Settings → Add Luno to see your
              ZAR & BTC balances, recent buys, and pending sends.
            </Text>
          </View>
        ) : null}

        {/* Top tiles: BTC + ZAR ready */}
        {!noLunoLinked ? (
          <View style={styles.tilesRow}>
            <View
              style={[
                styles.tile,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  borderRadius: colors.radius,
                },
              ]}
            >
              <Text style={[styles.tileLabel, { color: colors.mutedForeground }]}>
                BTC ON LUNO
              </Text>
              <Text style={[styles.tileValue, { color: colors.foreground }]}>
                {btcReady.toFixed(8)}
              </Text>
              {btcReadyFiat > 0 ? (
                <Text style={[styles.tileSub, { color: colors.mutedForeground }]}>
                  ≈ {fmtMoney(btcReadyFiat, currency)}
                </Text>
              ) : null}
            </View>
            <View
              style={[
                styles.tile,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  borderRadius: colors.radius,
                },
              ]}
            >
              <Text style={[styles.tileLabel, { color: colors.mutedForeground }]}>
                TOTAL · LUNO
              </Text>
              <Text style={[styles.tileValue, { color: colors.foreground }]}>
                {fmtMoney(totalFiat, currency)}
              </Text>
              {/* "Cash" subtitle: pull the ZAR wallet (Luno's only native
                  cash asset) and quote it in the user's display currency
                  via the same pricing helper, so the label and value
                  always agree. */}
              {zarCashFiat > 0 ? (
                <Text style={[styles.tileSub, { color: colors.mutedForeground }]}>
                  incl. {fmtMoney(zarCashFiat, currency)} cash
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}

        {/* 7-day portfolio sparkline — only useful once we have ≥2 samples
            in the current display currency. Hidden cleanly otherwise. */}
        {history.length >= 2 ? (
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: colors.radius,
                paddingVertical: 14,
                gap: 8,
              },
            ]}
          >
            <View style={styles.sparkHeader}>
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
                LUNO · 7D
              </Text>
              <Text
                style={[styles.sparkDelta, { color: colors.mutedForeground }]}
              >
                {fmtDelta(history[0].fiat, history[history.length - 1].fiat, currency)}
              </Text>
            </View>
            <Sparkline
              values={history.map((s) => s.fiat)}
              height={48}
              reference={history[0].fiat}
            />
          </View>
        ) : null}

        {/* Highlight ready-to-deploy when there's meaningful BTC sitting on Luno */}
        {btcReady > 0.0001 ? (
          <View
            style={[
              styles.callout,
              {
                backgroundColor: colors.card,
                borderColor: colors.primary,
                borderRadius: colors.radius,
              },
            ]}
          >
            <Feather name="arrow-right-circle" size={18} color={colors.primary} />
            <Text style={[styles.calloutText, { color: colors.foreground }]}>
              <Text style={{ color: colors.primary }}>
                {btcReady.toFixed(8)} BTC
              </Text>{" "}
              sitting on Luno — ready to send to Binance and post as collateral.
            </Text>
          </View>
        ) : null}

        {/* Pending withdrawals */}
        {pending.length > 0 ? (
          <View style={{ gap: 8 }}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              IN-FLIGHT TRANSFERS
            </Text>
            <View
              style={[
                styles.card,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  borderRadius: colors.radius,
                },
              ]}
            >
              {pending.map((p, i) => (
                <View key={p.withdrawalId}>
                  {i > 0 ? (
                    <View
                      style={[styles.divider, { backgroundColor: colors.border }]}
                    />
                  ) : null}
                  <View style={styles.txRow}>
                    <Feather
                      name="upload"
                      size={14}
                      color={colors.warn}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.txTitle, { color: colors.foreground }]}>
                        {fmtCrypto(p.amount, p.asset)}
                      </Text>
                      <Text
                        style={[
                          styles.txSub,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        {p.accountName} · {p.status.toLowerCase()} · {fmtTime(p.createdAt)}
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* Transactions — Luno only. Binance has no general transaction
            history endpoint (only interest), so every row here is a Luno
            wallet movement; the badge makes the source explicit. */}
        {viewTransactions.length > 0 ? (
          <View style={{ gap: 8 }}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              {filter === null
                ? "ALL TRANSACTIONS · LUNO"
                : "TRANSACTIONS · LUNO"}
            </Text>
            <View
              style={[
                styles.card,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  borderRadius: colors.radius,
                },
              ]}
            >
              {viewTransactions.map((t, i) => (
                <View key={`${t.walletId}_${t.rowIndex}_${i}`}>
                  {i > 0 ? (
                    <View
                      style={[styles.divider, { backgroundColor: colors.border }]}
                    />
                  ) : null}
                  <TxRow t={t} />
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {!noLunoLinked &&
        viewTransactions.length === 0 &&
        pending.length === 0 ? (
          <Text style={[styles.empty, { color: colors.mutedForeground }]}>
            No recent activity.
          </Text>
        ) : null}
      </Container>
    </ScrollView>
  );
}

function HoldingRow({
  m,
  pct,
  currency,
  onViewTransactions,
}: {
  m: MergedHolding;
  pct: number;
  currency: "USD" | "ZAR";
  onViewTransactions?: () => void;
}) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const totalQty = m.binanceQty + m.lunoQty;
  // Split the combined USD value back into its two sources. Binance is valued
  // server-side (m.binance.usd); whatever's left of the merged total is Luno.
  const binanceUsd = m.binance?.usd ?? 0;
  const lunoUsd = Math.max(0, m.usd - binanceUsd);

  return (
    <View>
      <Pressable
        onPress={() => {
          haptic.tap();
          setOpen((o) => !o);
        }}
        style={({ pressed }) => [styles.txRow, { opacity: pressed ? 0.6 : 1 }]}
      >
        <AssetIcon asset={m.symbol} size={32} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[styles.txTitle, { color: colors.foreground }]}>
            {fmtCrypto(totalQty, m.symbol)}
          </Text>
          <Text style={[styles.txSub, { color: colors.mutedForeground }]}>
            {m.symbol}
            {pct > 0 ? ` · ${fmtPct(pct)} of portfolio` : ""}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 2 }}>
          {m.usd > 0 ? (
            <Text style={[styles.txTitle, { color: colors.foreground }]}>
              {fmtMoney(m.usd, currency)}
            </Text>
          ) : null}
          <Feather
            name={open ? "chevron-up" : "chevron-down"}
            size={16}
            color={colors.mutedForeground}
          />
        </View>
      </Pressable>

      {open ? (
        <View style={styles.splitWrap}>
          {m.binanceQty > 0 ? (
            <SourceSplitRow
              label="Binance"
              qty={fmtCrypto(m.binanceQty, m.symbol)}
              value={binanceUsd > 0 ? fmtMoney(binanceUsd, currency) : null}
            />
          ) : null}
          {m.lunoQty > 0 ? (
            <Pressable
              onPress={onViewTransactions}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <SourceSplitRow
                label="Luno"
                qty={fmtCrypto(m.lunoQty, m.symbol)}
                value={lunoUsd > 0 ? fmtMoney(lunoUsd, currency) : null}
                chevron
              />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function SourceSplitRow({
  label,
  qty,
  value,
  chevron,
}: {
  label: string;
  qty: string;
  value: string | null;
  chevron?: boolean;
}) {
  const colors = useColors();
  return (
    <View style={styles.splitRow}>
      <ExchangeLogo exchange={label} size={22} />
      <Text style={[styles.splitLabel, { color: colors.foreground }]}>
        {label}
      </Text>
      <View style={{ flex: 1, alignItems: "flex-end", justifyContent: "center" }}>
        <Text style={[styles.splitQty, { color: colors.foreground }]}>
          {qty}
        </Text>
        {value ? (
          <Text style={[styles.txSub, { color: colors.mutedForeground }]}>
            {value}
          </Text>
        ) : null}
      </View>
      {chevron ? (
        <Feather name="chevron-right" size={15} color={colors.mutedForeground} />
      ) : (
        <View style={{ width: 15 }} />
      )}
    </View>
  );
}

function TxRow({ t }: { t: LunoTransaction }) {
  const colors = useColors();
  const inflow = t.amount > 0;
  return (
    <View style={styles.txRow}>
      <Feather
        name={inflow ? "arrow-down-left" : "arrow-up-right"}
        size={14}
        color={inflow ? colors.ok : colors.warn}
      />
      <View style={{ flex: 1 }}>
        <Text style={[styles.txTitle, { color: colors.foreground }]}>
          {inflow ? "+" : ""}
          {fmtCrypto(t.amount, t.asset)}
        </Text>
        <Text
          style={[styles.txSub, { color: colors.mutedForeground }]}
          numberOfLines={1}
        >
          {t.accountName ? `${t.accountName} · ` : ""}Luno ·{" "}
          {t.description || (inflow ? "Inflow" : "Outflow")} · {fmtTime(t.ts)}
        </Text>
      </View>
    </View>
  );
}

function groupByAsset(
  wallets: LunoWallet[],
): Map<string, { totalBalance: number; totalReserved: number }> {
  const out = new Map<string, { totalBalance: number; totalReserved: number }>();
  for (const w of wallets) {
    const key = w.asset.toUpperCase();
    const existing = out.get(key) ?? { totalBalance: 0, totalReserved: 0 };
    existing.totalBalance += w.balance;
    existing.totalReserved += w.reserved;
    out.set(key, existing);
  }
  return out;
}

function fmtDelta(
  first: number,
  last: number,
  currency: "USD" | "ZAR",
): string {
  if (first <= 0) return "";
  const diff = last - first;
  const pct = (diff / first) * 100;
  const sign = diff >= 0 ? "+" : "";
  return `${sign}${fmtMoney(diff, currency, { compact: true })}  ·  ${sign}${pct.toFixed(2)}%`;
}

const styles = StyleSheet.create({
  title: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  chipRow: { gap: 8, paddingRight: 8 },
  emptyCard: {
    padding: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    gap: 10,
  },
  emptyTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  emptyBody: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 18,
  },
  tilesRow: { flexDirection: "row", gap: 10 },
  tile: {
    flex: 1,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  tileLabel: { fontSize: 10, letterSpacing: 1, fontFamily: "Inter_600SemiBold" },
  tileValue: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
    fontVariant: ["tabular-nums"],
  },
  tileSub: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    fontVariant: ["tabular-nums"],
  },
  callout: {
    flexDirection: "row",
    gap: 10,
    padding: 14,
    borderWidth: 1,
    alignItems: "center",
  },
  calloutText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: "Inter_500Medium",
  },
  sectionLabel: {
    fontSize: 10,
    letterSpacing: 1,
    fontFamily: "Inter_600SemiBold",
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
  },
  txRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
  },
  txTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    fontVariant: ["tabular-nums"],
  },
  txSub: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  divider: { height: StyleSheet.hairlineWidth },
  empty: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    paddingVertical: 16,
  },
  sparkHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sparkDelta: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    fontVariant: ["tabular-nums"],
  },
  heroValue: {
    fontSize: 32,
    fontFamily: "Inter_700Bold",
    letterSpacing: -1,
    fontVariant: ["tabular-nums"],
  },
  donutWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
  },
  donutCenterValue: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
    fontVariant: ["tabular-nums"],
  },
  donutCenterLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    marginTop: -2,
  },
  legend: {
    flex: 1,
    gap: 9,
  },
  legendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendSym: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  legendPct: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    fontVariant: ["tabular-nums"],
  },
  splitWrap: {
    paddingLeft: 44,
    paddingBottom: 12,
    gap: 8,
  },
  splitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  splitLabel: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  splitQty: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    fontVariant: ["tabular-nums"],
  },
});
