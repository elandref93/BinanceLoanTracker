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
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { CurrencyProvider } from "@/context/CurrencyContext";
import { SessionProvider } from "@/context/SessionContext";

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

export default function RootLayout() {
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

  if (!fontsLoaded && !fontError) return null;

  return (
    <SessionProvider>
      <SafeAreaProvider>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <GestureHandlerRootView
              style={{ flex: 1, backgroundColor: "#06090C" }}
            >
              <KeyboardProvider>
                <CurrencyProvider>
                  <AppLockGate>
                    <Stack
                      screenOptions={{
                        headerStyle: { backgroundColor: "#06090C" },
                        headerTintColor: "#E6F1F7",
                        headerShadowVisible: false,
                        contentStyle: { backgroundColor: "#06090C" },
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
                        name="loan/[id]"
                        options={{ title: "Loan", presentation: "card" }}
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
                </CurrencyProvider>
              </KeyboardProvider>
            </GestureHandlerRootView>
          </QueryClientProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </SessionProvider>
  );
}
