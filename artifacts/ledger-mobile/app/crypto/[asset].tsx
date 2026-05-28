import { Feather } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import {
  Linking,
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
import { useCurrency } from "@/context/CurrencyContext";
import { useColors } from "@/hooks/useColors";
import { useLunoHistory } from "@/hooks/useLunoHistory";
import { haptic } from "@/lib/haptics";
import {
  displayAsset,
  pairsForAssets,
  quoteWalletInFiat,
} from "@/lib/lunoPricing";
import { fmtMoney } from "@/utils/format";

import {
  useGetLunoTickers,
  useListLunoPending,
  useListLunoTransactions,
  useListLunoWallets,
  type LunoTransaction,
  type LunoWallet,
} from "@workspace/api-client-react";

/**
 * Asset detail screen. Pathed by the *display* symbol (BTC, ETH, ZAR,
 * etc) — not Luno's wire symbol (XBT) — so URLs read naturally and
 * deep-link friendly. We match wallets by comparing both sides through
 * `displayAsset()` so an `/crypto/BTC` route still picks up XBT wallets.
 */
export default function AssetDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { currency } = useCurrency();
  const params = useLocalSearchParams<{ asset: string }>();
  const symbol = displayAsset(params.asset ?? "");

  const walletsQ = useListLunoWallets();
  const pendingQ = useListLunoPending();
  // Bumped past the dashboard's 30 because this screen is the place
  // where someone goes specifically to scroll history for one asset.
  const txQ = useListLunoTransactions({ limit: 200 });

  const allWallets = walletsQ.data?.wallets ?? [];
  const wallets = useMemo(
    () => allWallets.filter((w) => displayAsset(w.asset) === symbol),
    [allWallets, symbol],
  );
  const pending = useMemo(
    () =>
      (pendingQ.data?.withdrawals ?? []).filter(
        (p) => displayAsset(p.asset) === symbol,
      ),
    [pendingQ.data, symbol],
  );
  const transactions = useMemo(
    () =>
      (txQ.data?.transactions ?? []).filter(
        (t) => displayAsset(t.asset) === symbol,
      ),
    [txQ.data, symbol],
  );

  // Price quote: ask only for the one pair we need on this screen.
  const neededPairs = useMemo(
    () => pairsForAssets([symbol], currency),
    [symbol, currency],
  );
  const tickersQ = useGetLunoTickers(
    { pairs: neededPairs.join(",") },
    { query: { enabled: neededPairs.length > 0 } as never },
  );
  const tickerMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tickersQ.data?.tickers ?? []) m.set(t.pair, t.lastTrade);
    return m;
  }, [tickersQ.data]);

  const totals = useMemo(() => {
    let balance = 0;
    let reserved = 0;
    let unconfirmed = 0;
    for (const w of wallets) {
      balance += w.balance;
      reserved += w.reserved;
      unconfirmed += w.unconfirmed;
    }
    return { balance, reserved, unconfirmed };
  }, [wallets]);

  const fiatValue = quoteWalletInFiat(
    symbol,
    totals.balance + totals.reserved,
    tickerMap,
    currency,
  );
  // Unit price = quote 1 unit of the asset in the display currency.
  // For cash assets this is just 1 (USD↔USD is meaningless; ZAR in ZAR is 1).
  const unitPrice = quoteWalletInFiat(symbol, 1, tickerMap, currency);

  // BTC-only sparkline: reuse the recorded LunoSample.btc field from
  // the dashboard history. Other assets have no per-asset history yet,
  // so the chart card just doesn't render.
  const history = useLunoHistory(7 * 24, currency);
  const btcSeries = useMemo(
    () =>
      symbol === "BTC"
        ? history.map((s) => s.btc).filter((v) => v > 0)
        : [],
    [symbol, history],
  );

  // 30-day net flow: sum the asset's transactions over the last 30d.
  // Cheap to compute, gives a useful "have I been net-buying or sending
  // out?" signal. Computed BEFORE the loading/error early returns so the
  // hook count stays stable across renders.
  const netFlow30d = useMemo(() => {
    const cutoff = Date.now() - 30 * 86_400_000;
    return transactions
      .filter((t) => new Date(t.ts).getTime() >= cutoff)
      .reduce((acc, t) => acc + t.amount, 0);
  }, [transactions]);

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
    walletsQ.isLoading && pendingQ.isLoading && txQ.isLoading;
  if (loading) {
    return (
      <>
        <Stack.Screen options={{ title: symbol }} />
        <ScreenLoader hint={`Loading ${symbol}…`} />
      </>
    );
  }
  if (
    walletsQ.isError &&
    pendingQ.isError &&
    txQ.isError &&
    wallets.length === 0
  ) {
    return (
      <>
        <Stack.Screen options={{ title: symbol }} />
        <ErrorView message={`Couldn't load ${symbol}. Pull to retry.`} />
      </>
    );
  }

  const hasMultipleAccounts = wallets.length > 1;

  return (
    <>
      <Stack.Screen
        options={{
          title: symbol,
          headerBackTitle: "Crypto",
        }}
      />
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={{
          paddingTop: 16,
          paddingBottom: insets.bottom + 32,
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
          {/* Hero: icon + balance + fiat */}
          <View
            style={[
              styles.hero,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: colors.radius,
              },
            ]}
          >
            <AssetIcon asset={symbol} size={56} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.heroSymbol, { color: colors.foreground }]}>
                {symbol}
              </Text>
              <Text style={[styles.heroBalance, { color: colors.foreground }]}>
                {fmtAsset(totals.balance, symbol)}
              </Text>
              {fiatValue > 0 ? (
                <Text
                  style={[styles.heroFiat, { color: colors.mutedForeground }]}
                >
                  ≈ {fmtMoney(fiatValue, currency)}
                </Text>
              ) : null}
            </View>
          </View>

          {/* Price + 30d net flow */}
          {unitPrice > 0 || transactions.length > 0 ? (
            <View style={styles.tilesRow}>
              {unitPrice > 0 ? (
                <Tile
                  label={`PRICE · 1 ${symbol}`}
                  value={fmtMoney(unitPrice, currency)}
                />
              ) : null}
              {transactions.length > 0 ? (
                <Tile
                  label="NET FLOW · 30D"
                  value={`${netFlow30d >= 0 ? "+" : ""}${fmtAsset(netFlow30d, symbol)}`}
                  valueColor={netFlow30d >= 0 ? colors.ok : colors.warn}
                />
              ) : null}
            </View>
          ) : null}

          {/* BTC sparkline (reuses dashboard history) */}
          {btcSeries.length >= 2 ? (
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
                <Text
                  style={[
                    styles.sectionLabel,
                    { color: colors.mutedForeground },
                  ]}
                >
                  HOLDINGS · 7D
                </Text>
                <Text
                  style={[styles.sparkDelta, { color: colors.mutedForeground }]}
                >
                  {fmtBtcDelta(btcSeries[0], btcSeries[btcSeries.length - 1])}
                </Text>
              </View>
              <Sparkline
                values={btcSeries}
                width={320}
                height={48}
                reference={btcSeries[0]}
              />
            </View>
          ) : null}

          {/* Balance breakdown — only worth showing when there's
              something locked or in-flight. */}
          {totals.reserved > 0 || totals.unconfirmed > 0 ? (
            <View style={{ gap: 8 }}>
              <Text
                style={[styles.sectionLabel, { color: colors.mutedForeground }]}
              >
                BALANCE BREAKDOWN
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
                <BreakdownRow
                  label="Available"
                  value={fmtAsset(totals.balance, symbol)}
                />
                {totals.reserved > 0 ? (
                  <>
                    <View
                      style={[
                        styles.divider,
                        { backgroundColor: colors.border },
                      ]}
                    />
                    <BreakdownRow
                      label="Reserved"
                      value={fmtAsset(totals.reserved, symbol)}
                      hint="Held against open orders or pending sends"
                    />
                  </>
                ) : null}
                {totals.unconfirmed > 0 ? (
                  <>
                    <View
                      style={[
                        styles.divider,
                        { backgroundColor: colors.border },
                      ]}
                    />
                    <BreakdownRow
                      label="Unconfirmed"
                      value={fmtAsset(totals.unconfirmed, symbol)}
                      hint="Network deposit awaiting confirmations"
                    />
                  </>
                ) : null}
              </View>
            </View>
          ) : null}

          {/* Per-account split — only when more than one Luno account holds it */}
          {hasMultipleAccounts ? (
            <View style={{ gap: 8 }}>
              <Text
                style={[styles.sectionLabel, { color: colors.mutedForeground }]}
              >
                ACCOUNTS
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
                {wallets.map((w, i) => (
                  <View key={`${w.walletId}_${w.accountId}`}>
                    {i > 0 ? (
                      <View
                        style={[
                          styles.divider,
                          { backgroundColor: colors.border },
                        ]}
                      />
                    ) : null}
                    <AccountRow w={w} symbol={symbol} />
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {/* Pending */}
          {pending.length > 0 ? (
            <View style={{ gap: 8 }}>
              <Text
                style={[styles.sectionLabel, { color: colors.mutedForeground }]}
              >
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
                        style={[
                          styles.divider,
                          { backgroundColor: colors.border },
                        ]}
                      />
                    ) : null}
                    <View style={styles.txRow}>
                      <Feather name="upload" size={14} color={colors.warn} />
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.txTitle,
                            { color: colors.foreground },
                          ]}
                        >
                          {fmtAsset(p.amount, symbol)}
                        </Text>
                        <Text
                          style={[
                            styles.txSub,
                            { color: colors.mutedForeground },
                          ]}
                        >
                          {p.accountName} · {p.status.toLowerCase()} ·{" "}
                          {fmtTime(p.createdAt)}
                        </Text>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {/* Transactions */}
          <View style={{ gap: 8 }}>
            <Text
              style={[styles.sectionLabel, { color: colors.mutedForeground }]}
            >
              TRANSACTIONS · {transactions.length}
            </Text>
            {transactions.length === 0 ? (
              <View
                style={[
                  styles.card,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    borderRadius: colors.radius,
                    paddingVertical: 24,
                    alignItems: "center",
                  },
                ]}
              >
                <Text
                  style={[styles.empty, { color: colors.mutedForeground }]}
                >
                  No {symbol} activity in the recent window.
                </Text>
              </View>
            ) : (
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
                        style={[
                          styles.divider,
                          { backgroundColor: colors.border },
                        ]}
                      />
                    ) : null}
                    <TxRow t={t} symbol={symbol} />
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* External link */}
          <Pressable
            onPress={() => {
              haptic.tap();
              void Linking.openURL("https://www.luno.com/wallet");
            }}
            style={({ pressed }) => [
              styles.action,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: colors.radius,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Feather
              name="external-link"
              size={16}
              color={colors.mutedForeground}
            />
            <Text style={[styles.actionText, { color: colors.foreground }]}>
              Open on Luno
            </Text>
          </Pressable>

          {/* Back affordance for users who prefer tap over swipe */}
          <Pressable
            onPress={() => {
              haptic.tap();
              if (router.canGoBack()) router.back();
              else router.replace("/(tabs)/crypto");
            }}
            style={({ pressed }) => [
              styles.action,
              {
                backgroundColor: colors.background,
                borderColor: colors.border,
                borderRadius: colors.radius,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Feather
              name="arrow-left"
              size={16}
              color={colors.mutedForeground}
            />
            <Text
              style={[styles.actionText, { color: colors.mutedForeground }]}
            >
              Back to Crypto
            </Text>
          </Pressable>
        </Container>
      </ScrollView>
    </>
  );
}

function Tile({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  const colors = useColors();
  return (
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
        {label}
      </Text>
      <Text
        style={[styles.tileValue, { color: valueColor ?? colors.foreground }]}
      >
        {value}
      </Text>
    </View>
  );
}

function BreakdownRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  const colors = useColors();
  return (
    <View style={styles.breakdownRow}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.breakdownLabel, { color: colors.foreground }]}>
          {label}
        </Text>
        {hint ? (
          <Text style={[styles.txSub, { color: colors.mutedForeground }]}>
            {hint}
          </Text>
        ) : null}
      </View>
      <Text style={[styles.breakdownValue, { color: colors.foreground }]}>
        {value}
      </Text>
    </View>
  );
}

function AccountRow({ w, symbol }: { w: LunoWallet; symbol: string }) {
  const colors = useColors();
  return (
    <View style={styles.txRow}>
      <Feather name="briefcase" size={14} color={colors.mutedForeground} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.txTitle, { color: colors.foreground }]}>
          {w.accountName}
        </Text>
        <Text style={[styles.txSub, { color: colors.mutedForeground }]}>
          {fmtAsset(w.balance, symbol)}
          {w.reserved > 0 ? ` · ${fmtAsset(w.reserved, symbol)} reserved` : ""}
        </Text>
      </View>
    </View>
  );
}

function TxRow({ t, symbol }: { t: LunoTransaction; symbol: string }) {
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
          {fmtAsset(t.amount, symbol)}
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

function fmtAsset(n: number, symbol: string): string {
  const dp = symbol === "BTC" || symbol === "ETH" ? 8 : 2;
  return `${n.toFixed(dp)} ${symbol}`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtBtcDelta(first: number, last: number): string {
  if (first <= 0) return "";
  const diff = last - first;
  const pct = (diff / first) * 100;
  const sign = diff >= 0 ? "+" : "";
  return `${sign}${diff.toFixed(6)} BTC · ${sign}${pct.toFixed(2)}%`;
}

const styles = StyleSheet.create({
  hero: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    padding: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  heroSymbol: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1.5,
  },
  heroBalance: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
    fontVariant: ["tabular-nums"],
  },
  heroFiat: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    fontVariant: ["tabular-nums"],
  },
  tilesRow: { flexDirection: "row", gap: 10 },
  tile: {
    flex: 1,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  tileLabel: {
    fontSize: 10,
    letterSpacing: 1,
    fontFamily: "Inter_600SemiBold",
  },
  tileValue: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
    fontVariant: ["tabular-nums"],
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
  breakdownRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    gap: 12,
  },
  breakdownLabel: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  breakdownValue: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    fontVariant: ["tabular-nums"],
  },
  empty: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
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
  action: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
});
