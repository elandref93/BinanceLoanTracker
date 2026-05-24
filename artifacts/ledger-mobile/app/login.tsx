import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

export default function LoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();
  const [busy, setBusy] = useState(false);

  const onPress = async () => {
    setBusy(true);
    if (Platform.OS !== "web") {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    await new Promise((r) => setTimeout(r, 500));
    await signIn("user@ledger.local");
  };

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
          source={require("../assets/images/icon.png")}
          style={styles.icon}
          contentFit="contain"
        />
        <Text style={[styles.title, { color: colors.foreground }]}>Ledger</Text>
        <Text style={[styles.tagline, { color: colors.mutedForeground }]}>
          Read-only Binance loan tracker
        </Text>
      </View>

      <View style={styles.footer}>
        <Pressable
          onPress={onPress}
          disabled={busy}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: colors.primary,
              borderRadius: colors.radius,
              opacity: pressed || busy ? 0.7 : 1,
            },
          ]}
        >
          {busy ? (
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
  buttonText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  fine: {
    textAlign: "center",
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    lineHeight: 16,
  },
});
