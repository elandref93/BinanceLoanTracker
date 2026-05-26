import * as AppleAuthentication from "expo-apple-authentication";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { useSession } from "@/context/SessionContext";
import { AuthRequestError } from "@/lib/session";

// User-cancellation reaches us either as Apple's native error code or — on
// older iOS builds and the simulator — as a generic Error with "cancel" in
// the message. Treat all of them as no-op rather than an error banner.
function isUserCancel(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown };
  if (typeof e.code === "string") {
    if (
      e.code === "ERR_REQUEST_CANCELED" ||
      e.code === "ERR_CANCELED" ||
      e.code === "USER_CANCELED"
    ) {
      return true;
    }
  }
  if (typeof e.message === "string" && /cancel/i.test(e.message)) return true;
  return false;
}

export default function SignInScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { signInWithApple } = useSession();

  const [busy, setBusy] = useState(false);
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

  const onPress = useCallback(async () => {
    setBusy(true);
    setError(null);
    if (Platform.OS !== "web") {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    try {
      await signInWithApple();
      // The (auth) layout watches isSignedIn and redirects to /(tabs) once
      // SessionContext updates — no manual navigation needed here.
    } catch (err) {
      if (isUserCancel(err)) {
        // User backed out; not an error.
      } else if (err instanceof AuthRequestError) {
        setError(
          err.status === 401
            ? "Sign-in failed: backend rejected the Apple identity. Try again."
            : `Sign-in failed (${err.status}). Please try again.`,
        );
      } else {
        setError("Sign-in failed. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }, [signInWithApple]);

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
          busy ? (
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
              onPress={onPress}
            />
          )
        ) : (
          // Surfaces only on simulator / unsupported devices. iOS TestFlight
          // builds with usesAppleSignIn: true always have Apple available.
          <Text style={[styles.fine, { color: colors.mutedForeground }]}>
            Apple Sign In isn't available on this device. Run Ledger on a
            real iOS device signed into an Apple ID.
          </Text>
        )}

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
  // outer dimensions (must match the tap target our designs assumed).
  appleButton: {
    height: 52,
  },
  appleButtonFallback: {
    backgroundColor: "#000000",
    height: 52,
    paddingVertical: 0,
  },
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
