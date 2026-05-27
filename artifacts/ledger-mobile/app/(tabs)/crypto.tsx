import { Feather } from "@expo/vector-icons";
import { useMemo } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Container } from "@/components/Container";
import { ErrorView } from "@/components/ErrorView";
import { ScreenLoader } from "@/components/ScreenLoader";
import { useColors } from "@/hooks/useColors";
import { useCurrency } from "@/context/CurrencyContext";
import { haptic } from "@/lib/haptics";
import { fmtMoney } from "@/utils/format";

import {
  useGetLunoTicker,
  useListLunoPending,
  useListLunoTransactions,
  useListLunoWallets,
  type LunoTransaction,
  type LunoWallet,
} from "@workspace/api-client-react";

// Luno asset → display symbol. BTC is XBT on the wire.
function displayAsset(asset: string): string {
  return asset.toUpperCase() === "XBT" ? "BTC" : asset.toUpperCase();
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
  const { currency } = useCurrency();

  const walletsQ = useListLunoWallets();
  const pendingQ = useListLunoPending();
  const txQ = useListLunoTransactions({ limit: 30 });
  // Spot XBT/ZAR (Luno's primary BTC pair) so we can quote BTC ↔ ZAR locally.
  const tickerQ = useGetLunoTicker({ pair: "XBTZAR" });

  const wallets = walletsQ.data?.wallets ?? [];
  const transactions = txQ.data?.transactions ?? [];
  const pending = pendingQ.data?.withdrawals ?? [];
  const xbtZar = tickerQ.data?.lastTrade ?? 0;

  const grouped = useMemo(() => groupByAsset(wallets), [wallets]);
  const btcReady = grouped.get("XBT")?.totalBalance ?? 0;
  const zarReady = grouped.get("ZAR")?.totalBalance ?? 0;
  const btcReadyZar = btcReady * xbtZar;

  const onRefresh = () => {
    haptic.impact();
    void Promise.all([
      walletsQ.refetch(),
      pendingQ.refetch(),
      txQ.refetch(),
      tickerQ.refetch(),
    ]).then(([w, p, t, k]) => {
      if (w.isError || p.isError || t.isError || k.isError) haptic.error();
      else haptic.success();
    });
  };

  const loading =
    walletsQ.isLoading && pendingQ.isLoading && txQ.isLoading && tickerQ.isLoading;
  const allError =
    walletsQ.isError && pendingQ.isError && txQ.isError && tickerQ.isError;

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
              {xbtZar > 0 ? (
                <Text style={[styles.tileSub, { color: colors.mutedForeground }]}>
                  ≈ {fmtMoney(btcReadyZar, "ZAR")}
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
                ZAR READY
              </Text>
              <Text style={[styles.tileValue, { color: colors.foreground }]}>
                {fmtMoney(zarReady, "ZAR")}
              </Text>
              {xbtZar > 0 ? (
                <Text style={[styles.tileSub, { color: colors.mutedForeground }]}>
                  ≈ {(zarReady / xbtZar).toFixed(8)} BTC
                </Text>
              ) : null}
            </View>
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
                    <WalletRow w={w} />
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

function WalletRow({ w }: { w: LunoWallet }) {
  const colors = useColors();
  return (
    <View style={styles.txRow}>
      <View
        style={[
          styles.assetBadge,
          { backgroundColor: colors.background, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.assetBadgeText, { color: colors.foreground }]}>
          {displayAsset(w.asset)}
        </Text>
      </View>
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
  assetBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 44,
    alignItems: "center",
  },
  assetBadgeText: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.5,
  },
  empty: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    paddingVertical: 16,
  },
});
