import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setBaseUrl } from "@workspace/api-client-react";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppLockGate } from "@/components/AppLockGate";
import { AutoUpdater } from "@/components/AutoUpdater";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { CurrencyProvider } from "@/context/CurrencyContext";
import { RiskSettingsProvider } from "@/context/RiskSettingsContext";
import { SessionProvider } from "@/context/SessionContext";
import { registerBackgroundRefresh } from "@/lib/backgroundTask";
import { initCrashReporting, reportFatal } from "@/lib/crashReporting";
import { initSentry, Sentry } from "@/lib/sentry";

// Initialise Sentry first so its global handlers are in place; the on-device
// reporter then chains on top of them.
initSentry();
initCrashReporting();

SplashScreen.preventAutoHideAsync();

const domain = process.env.EXPO_PUBLIC_DOMAIN;
if (domain) {
  setBaseUrl(`https://${domain}`);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false },
  },
});

function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    void registerBackgroundRefresh();
  }, []);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SessionProvider>
      <SafeAreaProvider>
        <ErrorBoundary
          onError={(error, componentStack) =>
            reportFatal(error, { componentStack })
          }
        >
          <QueryClientProvider client={queryClient}>
            <GestureHandlerRootView
              style={{ flex: 1, backgroundColor: "#06090C" }}
            >
              <KeyboardProvider>
                <CurrencyProvider>
                  <RiskSettingsProvider>
                    <AppLockGate>
                    <Stack
                      screenOptions={{
                        headerStyle: { backgroundColor: "#06090C" },
                        headerTintColor: "#E6F1F7",
                        headerShadowVisible: false,
                        contentStyle: { backgroundColor: "#06090C" },
                        // Pushed cards (loan/account/crypto) sit on top of the
                        // tab group, whose route name is "(tabs)". iOS would
                        // otherwise render that raw group name as the back-button
                        // label; "minimal" shows just the chevron.
                        headerBackButtonDisplayMode: "minimal",
                      }}
                    >
                      <Stack.Screen
                        name="(tabs)"
                        options={{ headerShown: false }}
                      />
                      <Stack.Screen
                        name="(auth)"
                        options={{ headerShown: false }}
                      />
                      <Stack.Screen
                        name="(onboarding)"
                        options={{ headerShown: false }}
                      />
                      <Stack.Screen
                        name="accounts"
                        options={{ title: "Accounts", presentation: "card" }}
                      />
                      <Stack.Screen
                        name="account/[id]"
                        options={{ title: "Account", presentation: "card" }}
                      />
                      <Stack.Screen
                        name="loan/[id]"
                        options={{ title: "Loan", presentation: "card" }}
                      />
                      <Stack.Screen
                        name="crypto/[asset]"
                        options={{ title: "Asset", presentation: "card" }}
                      />
                      <Stack.Screen
                        name="diagnostics"
                        options={{ title: "Diagnostics", presentation: "card" }}
                      />
                      <Stack.Screen
                        name="add-account"
                        options={{
                          presentation: "modal",
                          headerShown: false,
                        }}
                      />
                    </Stack>
                  </AppLockGate>
                  <AutoUpdater />
                  </RiskSettingsProvider>
                </CurrencyProvider>
              </KeyboardProvider>
            </GestureHandlerRootView>
          </QueryClientProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </SessionProvider>
  );
}

// Wrap the root so Sentry can attach routing/component context to events.
export default Sentry.wrap(RootLayout);
