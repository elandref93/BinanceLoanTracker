import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import React, { useEffect } from "react";
import { Platform, StyleSheet, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import {
  listAccountsWithSecrets,
  useStoredAccountsCount,
} from "@/lib/binanceKeys";
import {
  setAuthTokenGetter,
  setExtraHeadersGetter,
} from "@workspace/api-client-react";

// base64-encode without relying on Buffer (not in RN by default) or btoa
// (not in older RN engines). Hand-rolled to keep zero deps.
function toBase64(input: string): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else {
      bytes.push(
        0xe0 | (c >> 12),
        0x80 | ((c >> 6) & 0x3f),
        0x80 | (c & 0x3f),
      );
    }
  }
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i];
    const b2 = i + 1 < bytes.length ? bytes[i + 1] : -1;
    const b3 = i + 2 < bytes.length ? bytes[i + 2] : -1;
    const c1 = b1 >> 2;
    const c2 = ((b1 & 0x03) << 4) | (b2 >= 0 ? b2 >> 4 : 0);
    const c3 = b2 >= 0 ? ((b2 & 0x0f) << 2) | (b3 >= 0 ? b3 >> 6 : 0) : 64;
    const c4 = b3 >= 0 ? b3 & 0x3f : 64;
    out += chars[c1] + chars[c2] + (c3 === 64 ? "=" : chars[c3]) +
      (c4 === 64 ? "=" : chars[c4]);
  }
  return out;
}

export default function TabLayout() {
  const colors = useColors();
  const isWeb = Platform.OS === "web";
  const { isLoaded, isSignedIn, getToken } = useAuth();
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
