import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useMemo } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AssetIcon } from "@/components/AssetIcon";
import { Container } from "@/components/Container";
import { ErrorView } from "@/components/ErrorView";
import { ScreenLoader } from "@/components/ScreenLoader";
import { Sparkline } from "@/components/Sparkline";
import { useColors } from "@/hooks/useColors";
import { useCurrency } from "@/context/CurrencyContext";
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
  useListLunoPending,
  useListLunoTransactions,
  useListLunoWallets,
  type LunoTransaction,
  type LunoWallet,
} from "@workspace/api-client-react";

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

  const wallets = walletsQ.data?.wallets ?? [];
  const transactions = txQ.data?.transactions ?? [];
  const pending = pendingQ.data?.withdrawals ?? [];

  // Pair coverage: derive the set of pairs we need to quote from the
  // assets the user actually holds, against their display currency.
  // Pure-fiat balances (ZAR holding when currency=ZAR) need no ticker.
  const neededPairs = useMemo(
    () => pairsForAssets(wallets.map((w) => w.asset), currency),
    [wallets, currency],
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

  const grouped = useMemo(() => groupByAsset(wallets), [wallets]);
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

  // Record a history sample on every fresh, successful render where we
  // actually have a usable fiat figure. Skipping when totalFiat=0
  // prevents a spurious "zero" sample landing during a cold start while
  // tickers are still loading.
  useEffect(() => {
    if (
      !walletsQ.isFetching &&
      !tickersQ.isFetching &&
      wallets.length > 0 &&
      totalFiat > 0
    ) {
      void recordLunoSample({ btc: btcReady, fiat: totalFiat, currency });
    }
  }, [
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
    ]).then(([w, p, t, k]) => {
      if (w.isError || p.isError || t.isError || k.isError) haptic.error();
      else haptic.success();
    });
  };

  const loading =
    walletsQ.isLoading && pendingQ.isLoading && txQ.isLoading && tickersQ.isLoading;
  const allError =
    walletsQ.isError && pendingQ.isError && txQ.isError && tickersQ.isError;

  if (loading) return <ScreenLoader hint="Reading Luno…" />;
  if (allError && wallets.length === 0) {
    return <ErrorView message="Couldn't reach Luno. Pull to retry." />;
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
        <Text style={[styles.title, { color: colors.foreground }]}>Crypto</Text>

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
              width={320}
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

        {/* Wallets */}
        {wallets.length > 0 ? (
          <View style={{ gap: 8 }}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              WALLETS
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
              {wallets
                .filter((w) => w.balance > 0 || w.reserved > 0 || w.unconfirmed > 0)
                .map((w, i) => (
                  <View key={`${w.walletId}_${w.accountId}`}>
                    {i > 0 ? (
                      <View
                        style={[styles.divider, { backgroundColor: colors.border }]}
                      />
                    ) : null}
                    <WalletRow
                      w={w}
                      onPress={() => {
                        haptic.tap();
                        router.push(`/crypto/${displayAsset(w.asset)}`);
                      }}
                    />
                  </View>
                ))}
            </View>
          </View>
        ) : null}

        {/* Transactions */}
        {transactions.length > 0 ? (
          <View style={{ gap: 8 }}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              RECENT TRANSACTIONS
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
              {transactions.map((t, i) => (
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

        {!noLunoLinked && transactions.length === 0 && pending.length === 0 ? (
          <Text style={[styles.empty, { color: colors.mutedForeground }]}>
            No recent activity.
          </Text>
        ) : null}
      </Container>
    </ScrollView>
  );
}

function WalletRow({
  w,
  onPress,
}: {
  w: LunoWallet;
  onPress?: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.txRow, { opacity: pressed ? 0.6 : 1 }]}
    >
      <AssetIcon asset={w.asset} size={32} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.txTitle, { color: colors.foreground }]}>
          {fmtCrypto(w.balance, w.asset)}
        </Text>
        <Text style={[styles.txSub, { color: colors.mutedForeground }]}>
          {w.accountName}
          {w.reserved > 0 ? ` · ${fmtCrypto(w.reserved, w.asset)} reserved` : ""}
          {w.unconfirmed > 0
            ? ` · ${fmtCrypto(w.unconfirmed, w.asset)} unconfirmed`
            : ""}
        </Text>
      </View>
      <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
    </Pressable>
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
});
