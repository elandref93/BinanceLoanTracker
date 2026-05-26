import { Feather } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import React, { useEffect } from "react";
import { Platform, StyleSheet, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { useSession } from "@/context/SessionContext";
import {
  listAccountsWithSecrets,
  useStoredAccountsCount,
} from "@/lib/binanceKeys";
import { toBase64 } from "@/lib/encoding";
import {
  setAuthTokenGetter,
  setExtraHeadersGetter,
} from "@workspace/api-client-react";

export default function TabLayout() {
  const colors = useColors();
  const isWeb = Platform.OS === "web";
  const { isLoaded, isSignedIn, getToken } = useSession();
  const accountsCount = useStoredAccountsCount();

  useEffect(() => {
    setAuthTokenGetter(() => getToken());
    setExtraHeadersGetter(async () => {
      const accounts = await listAccountsWithSecrets();
      if (accounts.length === 0) return null;
      const payload = accounts.map((a) => ({
        id: a.id,
        name: a.name,
        apiKey: a.apiKey,
        apiSecret: a.apiSecret,
      }));
      return { "X-Binance-Accounts": toBase64(JSON.stringify(payload)) };
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
        name="history"
        options={{
          title: "Interest",
          tabBarIcon: ({ color }) => (
            <Feather name="activity" size={22} color={color} />
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
