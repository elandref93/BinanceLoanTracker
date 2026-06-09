import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { Redirect, Tabs } from "expo-router";
import React, { useEffect } from "react";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { useSession } from "@/context/SessionContext";
import {
  getBinanceLinks,
  getLunoLinks,
  useStoredAccountsCount,
} from "@/lib/accountStore";
import { toBase64 } from "@/lib/encoding";
import {
  setAuthTokenGetter,
  setExtraHeadersGetter,
  setAuthFailureHandler,
  getListAccountsQueryOptions,
  getListLoansQueryOptions,
  getListHoldingsQueryOptions,
  getListLunoWalletsQueryOptions,
  getListLunoPendingQueryOptions,
  getListLunoTransactionsQueryOptions,
  getGetLunoTickersQueryOptions,
  getGetPricesQueryOptions,
} from "@workspace/api-client-react";
import { notifyAuthFailure } from "@/lib/authEvents";
import { useCurrency } from "@/context/CurrencyContext";
import { pairsForAssets, displayAsset } from "@/lib/lunoPricing";

function payloadFor(
  links: Array<{
    id: string;
    name: string;
    apiKey: string;
    apiSecret: string;
  }>,
): string {
  return toBase64(
    JSON.stringify(
      links.map((l) => ({
        id: l.id,
        name: l.name,
        apiKey: l.apiKey,
        apiSecret: l.apiSecret,
      })),
    ),
  );
}

export default function TabLayout() {
  const colors = useColors();
  const isWeb = Platform.OS === "web";
  const { isLoaded, isSignedIn, getToken, accountsHydrated } = useSession();
  const accountsCount = useStoredAccountsCount();
  const queryClient = useQueryClient();
  const { currency } = useCurrency();

  useEffect(() => {
    setAuthTokenGetter(() => getToken());
    // Route the central api-client's 401s through the same app-wide handler the
    // sync modules use (SessionContext registers it to sign the user out).
    setAuthFailureHandler(() => notifyAuthFailure());
    setExtraHeadersGetter(async () => {
      const [binance, luno] = await Promise.all([
        getBinanceLinks(),
        getLunoLinks(),
      ]);
      const headers: Record<string, string> = {};
      if (binance.length > 0) headers["X-Binance-Accounts"] = payloadFor(binance);
      if (luno.length > 0) headers["X-Luno-Accounts"] = payloadFor(luno);
      return Object.keys(headers).length > 0 ? headers : null;
    });
    return () => {
      setExtraHeadersGetter(null);
      setAuthFailureHandler(null);
    };
  }, [getToken]);

  // Warm the query caches the Home and Portfolio tabs read, so the data is
  // already in place the moment the user opens a tab instead of each tab
  // kicking off its own fetch (and flashing a skeleton) on first visit.
  // Gated on a hydrated, signed-in session with at least one linked account so
  // the auth token + X-Binance/Luno-Accounts headers registered above are in
  // place before these requests fire. prefetchQuery respects staleTime, so the
  // tabs reuse this data rather than refetching when they mount.
  useEffect(() => {
    if (!isSignedIn || !accountsHydrated || !accountsCount) return;
    let cancelled = false;

    // Lists the Home + Portfolio tabs read directly.
    void queryClient.prefetchQuery(getListAccountsQueryOptions());
    void queryClient.prefetchQuery(getListLoansQueryOptions());
    void queryClient.prefetchQuery(getListHoldingsQueryOptions());
    void queryClient.prefetchQuery(getListLunoPendingQueryOptions());
    void queryClient.prefetchQuery(
      getListLunoTransactionsQueryOptions({ limit: 30 }),
    );

    // The Portfolio valuation layer (Luno tickers + Binance USD prices) is
    // parameterised by the assets actually held, so it can only be warmed once
    // the wallet list is in. Fetch wallets first, derive the same pair/symbol
    // sets the Portfolio screen computes for the default ("All") view, then
    // prefetch the quotes so dollar values render without a second round-trip.
    void (async () => {
      try {
        const walletsRes = await queryClient.fetchQuery(
          getListLunoWalletsQueryOptions(),
        );
        if (cancelled) return;
        const assets = (walletsRes?.wallets ?? []).map((w) => w.asset);

        const pairs = pairsForAssets(assets, currency);
        if (pairs.length > 0) {
          void queryClient.prefetchQuery(
            getGetLunoTickersQueryOptions({ pairs: pairs.join(",") }),
          );
        }

        const symbols = Array.from(
          new Set(
            assets
              .map((a) => displayAsset(a))
              .filter(
                (s) =>
                  s !== "ZAR" &&
                  s !== currency &&
                  s !== "USDT" &&
                  s !== "USDC" &&
                  s !== "USD",
              ),
          ),
        );
        if (symbols.length > 0) {
          void queryClient.prefetchQuery(
            getGetPricesQueryOptions({ assets: symbols.join(",") }),
          );
        }
      } catch {
        // Best-effort warm-up; if it fails (e.g. offline) the Portfolio screen
        // will fetch on open as before.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isSignedIn, accountsHydrated, accountsCount, currency, queryClient]);

  if (!isLoaded || accountsCount === null) return null;
  if (!isSignedIn) return <Redirect href="/(auth)/sign-in" />;
  // A fresh device starts with empty local storage even when the user already
  // has accounts synced under their Apple ID. Wait for the first server pull to
  // settle before sending them to onboarding, otherwise we'd flash (or get
  // stuck on) "connect your account" while the synced profile is still loading.
  if (accountsCount === 0 && !accountsHydrated) {
    return (
      <View
        style={[styles.loading, { backgroundColor: colors.background }]}
      >
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (accountsCount === 0) return <Redirect href="/(onboarding)" />;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          elevation: 0,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarBackground: () => (
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: colors.background },
            ]}
          />
        ),
        tabBarLabelStyle: {
          fontFamily: "Inter_600SemiBold",
          fontSize: 11,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color }) => (
            <Feather name="home" size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="crypto"
        options={{
          title: "Portfolio",
          tabBarIcon: ({ color }) => (
            <Feather name="pie-chart" size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: "Interest",
          tabBarIcon: ({ color }) => (
            <Feather name="activity" size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="strategy"
        options={{
          title: "Strategy",
          tabBarIcon: ({ color }) => (
            <Feather name="bar-chart-2" size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color }) => (
            <Feather name="settings" size={22} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
});
