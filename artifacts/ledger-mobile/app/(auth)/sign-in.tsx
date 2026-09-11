import * as AppleAuthentication from "expo-apple-authentication";
import { Image } from "expo-image";

import { haptic } from "@/lib/haptics";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { useSession } from "@/context/SessionContext";
import { AuthRequestError } from "@/lib/session";
import { ExpoGoBanner } from "@/components/ExpoGoBanner";
import { isExpoGo } from "@/lib/runtime";

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

function signInErrorMessage(err: unknown): string {
  if (err instanceof AuthRequestError) {
    return err.status === 401
      ? "Sign-in failed: backend rejected the Apple identity. Try again."
      : `Sign-in failed (${err.status}). Please try again.`;
  }
  if (err instanceof Error && err.message.trim()) return err.message;
  return "Sign-in failed. Please try again.";
}

export default function SignInScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { signInWithApple } = useSession();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Never gate the button on AppleAuthentication.isAvailableAsync() — that
  // returns false in Expo Go (SDK 57) even on a real iPhone, which hid the
  // only way to sign in. Always show on iOS. Web/Android stay without it.
  const showAppleButton = Platform.OS === "ios";

  const onPress = useCallback(async () => {
    setBusy(true);
    setError(null);
    haptic.impact();
    try {
      const session = await signInWithApple();
      if (session.linkWarning === "email_not_shared") {
        Alert.alert(
          "Email wasn't shared",
          "Apple did not share an email this time. You can still use Expo Go — share your email on the next prompt if you want TestFlight accounts to sync.",
        );
      } else if (session.linkWarning === "private_relay_unlinked") {
        Alert.alert(
          "Hide My Email",
          "Hide My Email can keep Expo Go and TestFlight from matching. You can still use Expo Go — share your real email next time if you want them linked.",
        );
      }
      // The (auth) layout watches isSignedIn and redirects to /(tabs) once
      // SessionContext updates — no manual navigation needed here.
    } catch (err) {
      if (isUserCancel(err)) {
        // User backed out; not an error.
      } else {
        // eslint-disable-next-line no-console
        console.log("[auth] sign-in screen error", err);
        setError(signInErrorMessage(err));
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
        <ExpoGoBanner />
        {error ? (
          <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>
        ) : null}

        {showAppleButton ? (
          busy ? (
            <View
              style={[
                styles.button,
                styles.appleButtonFallback,
                { borderRadius: colors.radius },
              ]}
            >
              <ActivityIndicator color="#000000" />
            </View>
          ) : isExpoGo() ? (
            // Custom Pressable so Expo Go always has a tappable control even
            // when the native AppleAuthenticationButton view does not mount.
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sign in with Apple"
              onPress={onPress}
              style={({ pressed }) => [
                styles.button,
                styles.appleButtonFallback,
                { borderRadius: colors.radius, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={styles.appleButtonLabel}>Sign in with Apple</Text>
            </Pressable>
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
          <Text style={[styles.fine, { color: colors.mutedForeground }]}>
            Apple Sign In needs a Ledger development build on a real iPhone.
          </Text>
        )}

        <Text style={[styles.fine, { color: colors.mutedForeground }]}>
          {isExpoGo()
            ? "Expo Go cannot complete Apple Sign In. Use the Ledger development client, then connect to Metro."
            : "Private development build. API keys are read-only and stay on device."}
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
    backgroundColor: "#FFFFFF",
    height: 52,
    paddingVertical: 0,
  },
  appleButtonLabel: {
    color: "#000000",
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
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
