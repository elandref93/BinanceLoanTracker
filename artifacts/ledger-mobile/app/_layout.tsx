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
import React, { useCallback, useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { isExpoGo } from "@/lib/runtime";

import { AppLockGate } from "@/components/AppLockGate";
import { AutoUpdater } from "@/components/AutoUpdater";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { CurrencyProvider } from "@/context/CurrencyContext";
import { RiskSettingsProvider } from "@/context/RiskSettingsContext";
import { SessionProvider } from "@/context/SessionContext";
import { registerBackgroundRefresh } from "@/lib/backgroundTask";
import { initCrashReporting, reportFatal } from "@/lib/crashReporting";
import { logLaunchDiagnostics } from "@/lib/launchDiagnostics";
import { initSentry, Sentry } from "@/lib/sentry";

// Initialise Sentry first so its global handlers are in place; the on-device
// reporter then chains on top of them. Launch diagnostics ingest a native
// abort saved from a previous launch (if any) and dump expo-updates logs.
initSentry();
initCrashReporting();
logLaunchDiagnostics();

// Expo Go / Metro: never pin the native BTC splash. preventAutoHideAsync plus
// a missing native module (Sentry) previously left the logo up forever because
// hideAsync never ran. Production still waits for the first paint, with a
// failsafe below.
if (isExpoGo() || __DEV__) {
  void SplashScreen.hideAsync().catch(() => undefined);
} else {
  void SplashScreen.preventAutoHideAsync();
}

// eslint-disable-next-line no-console
console.log("[launch] root module loaded", {
  dev: __DEV__,
  expoGo: isExpoGo(),
  domain: process.env.EXPO_PUBLIC_DOMAIN ?? null,
});

type KeyboardProviderComponent = React.ComponentType<{
  children: React.ReactNode;
}>;

function loadKeyboardProvider(): KeyboardProviderComponent {
  try {
    return require("react-native-keyboard-controller")
      .KeyboardProvider as KeyboardProviderComponent;
  } catch {
    return ({ children }: { children: React.ReactNode }) => children;
  }
}

const KeyboardProvider = loadKeyboardProvider();

const domain =
  process.env.EXPO_PUBLIC_DOMAIN ||
  "binance-loan-tracker-backend.azurewebsites.net";
setBaseUrl(`https://${domain}`);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false },
  },
});

function RootLayout() {
  const [launchReady, setLaunchReady] = useState(false);
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  const onLaunchReady = useCallback(() => {
    setLaunchReady(true);
  }, []);

  useEffect(() => {
    void SplashScreen.hideAsync().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!launchReady) return;
    void SplashScreen.hideAsync().catch(() => undefined);
  }, [launchReady]);

  // Never leave the BTC splash up if fonts or AutoUpdater stall.
  useEffect(() => {
    const timer = setTimeout(() => {
      setLaunchReady(true);
      void SplashScreen.hideAsync().catch(() => undefined);
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    void registerBackgroundRefresh();
  }, []);

  // Keep loading Inter in the background; do not block the tree on it.
  void fontsLoaded;
  void fontError;

  return (
    <>
      <AutoUpdater onLaunchReady={onLaunchReady} />
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
                  </RiskSettingsProvider>
                </CurrencyProvider>
              </KeyboardProvider>
            </GestureHandlerRootView>
          </QueryClientProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </SessionProvider>
    </>
  );
}

// Wrap the root so Sentry can attach routing/component context to events.
export default Sentry.wrap(RootLayout);
