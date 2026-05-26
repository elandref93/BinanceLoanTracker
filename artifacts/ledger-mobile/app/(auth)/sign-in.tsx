import { useSSO } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import * as AppleAuthentication from "expo-apple-authentication";
import * as AuthSession from "expo-auth-session";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

WebBrowser.maybeCompleteAuthSession();

type Provider = "google" | "apple";

function useWarmUpBrowser() {
  useEffect(() => {
    if (Platform.OS !== "android") return;
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);
}

// User-cancellation surfaces under several shapes across Apple's native
// dialog, the in-app browser used by Clerk, and Clerk's own error envelopes.
// Treat all of them as "user backed out, no-op" rather than an error banner.
function isUserCancel(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown; errors?: unknown };
  if (typeof e.code === "string") {
    if (
      e.code === "ERR_REQUEST_CANCELED" ||
      e.code === "ERR_CANCELED" ||
      e.code === "access_denied" ||
      e.code === "USER_CANCELED"
    ) {
      return true;
    }
  }
  if (typeof e.message === "string" && /cancel/i.test(e.message)) return true;
  if (Array.isArray(e.errors)) {
    for (const inner of e.errors) {
      if (
        inner &&
        typeof inner === "object" &&
        "code" in inner &&
        typeof (inner as { code: unknown }).code === "string" &&
        ((inner as { code: string }).code === "oauth_access_denied" ||
          (inner as { code: string }).code === "access_denied")
      ) {
        return true;
      }
    }
  }
  return false;
}

export default function SignInScreen() {
  useWarmUpBrowser();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { startSSOFlow } = useSSO();
  const [busy, setBusy] = useState<Provider | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Apple Sign In is iOS 13+ only; the module returns false on simulators
  // without an Apple ID and on Android entirely.
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    AppleAuthentication.isAvailableAsync()
      .then(setAppleAvailable)
      .catch(() => setAppleAvailable(false));
  }, []);

  const start = useCallback(
    async (provider: Provider) => {
      setBusy(provider);
      setError(null);
      if (Platform.OS !== "web") {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
      try {
        // No explicit `scheme` — AuthSession reads it from app.json
        // (currently `binance-loan-tracker`), so we don't have to keep two
        // copies of the same string in sync.
        const { createdSessionId, setActive } = await startSSOFlow({
          strategy: provider === "apple" ? "oauth_apple" : "oauth_google",
          redirectUrl: AuthSession.makeRedirectUri(),
        });
        if (createdSessionId && setActive) {
          await setActive({ session: createdSessionId });
        }
      } catch (err) {
        if (!isUserCancel(err)) {
          console.error(JSON.stringify(err, null, 2));
          setError("Sign-in failed. Please try again.");
        }
      } finally {
        setBusy(null);
      }
    },
    [startSSOFlow],
  );

  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: colors.background,
          paddingTop: insets.top + 80,
          paddingBottom: insets.bottom + 40,
        },
      ]}
    >
      <View style={styles.hero}>
        <Image
          source={require("../../assets/images/icon.png")}
          style={styles.icon}
          contentFit="contain"
        />
        <Text style={[styles.title, { color: colors.foreground }]}>Ledger</Text>
        <Text style={[styles.tagline, { color: colors.mutedForeground }]}>
          Read-only Binance loan tracker
        </Text>
      </View>

      <View style={styles.footer}>
        {error ? (
          <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>
        ) : null}

        {appleAvailable ? (
          busy === "apple" ? (
            <View
              style={[
                styles.button,
                styles.appleButtonFallback,
                { borderRadius: colors.radius },
              ]}
            >
              <ActivityIndicator color="#FFFFFF" />
            </View>
          ) : (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={
                AppleAuthentication.AppleAuthenticationButtonType.CONTINUE
              }
              buttonStyle={
                AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
              }
              cornerRadius={colors.radius}
              style={styles.appleButton}
              onPress={() => start("apple")}
            />
          )
        ) : null}

        <Pressable
          onPress={() => start("google")}
          disabled={busy !== null}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: colors.primary,
              borderRadius: colors.radius,
              opacity: pressed || busy !== null ? 0.7 : 1,
            },
          ]}
        >
          {busy === "google" ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <>
              <Feather name="chrome" size={18} color={colors.primaryForeground} />
              <Text
                style={[styles.buttonText, { color: colors.primaryForeground }]}
              >
                Continue with Google
              </Text>
            </>
          )}
        </Pressable>

        <Text style={[styles.fine, { color: colors.mutedForeground }]}>
          Private TestFlight build. API keys are read-only and stay on device.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: "space-between",
  },
  hero: { alignItems: "center", gap: 12 },
  icon: { width: 96, height: 96, borderRadius: 22 },
  title: {
    fontSize: 32,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  footer: { gap: 12 },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
  },
  // Apple's native button manages its own internal layout; we only control
  // outer dimensions (must match the Google button's tap target).
  appleButton: {
    height: 52,
  },
  appleButtonFallback: {
    backgroundColor: "#000000",
    height: 52,
    paddingVertical: 0,
  },
  buttonText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  fine: {
    textAlign: "center",
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    lineHeight: 16,
  },
  error: {
    textAlign: "center",
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
});
