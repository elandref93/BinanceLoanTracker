import { Feather } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import React, { useEffect } from "react";
import { Platform, StyleSheet, View } from "react-native";

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
} from "@workspace/api-client-react";

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
  const { isLoaded, isSignedIn, getToken } = useSession();
  const accountsCount = useStoredAccountsCount();

  useEffect(() => {
    setAuthTokenGetter(() => getToken());
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
    };
  }, [getToken]);

  if (!isLoaded || accountsCount === null) return null;
  if (!isSignedIn) return <Redirect href="/(auth)/sign-in" />;
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
          title: "Crypto",
          tabBarIcon: ({ color }) => (
            <Feather name="trending-up" size={22} color={color} />
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
