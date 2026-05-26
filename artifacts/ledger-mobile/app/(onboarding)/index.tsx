import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Redirect, useRouter } from "expo-router";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { useStoredAccountsCount } from "@/lib/binanceKeys";

export default function OnboardingIntro() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isLoaded, isSignedIn, signOut } = useAuth();
  const count = useStoredAccountsCount();

  if (!isLoaded || count === null) return null;
  if (!isSignedIn) return <Redirect href="/(auth)/sign-in" />;
  if (count > 0) return <Redirect href="/(tabs)" />;

  const onSignOut = async () => {
    await signOut();
    router.replace("/(auth)/sign-in");
  };

  const onConnect = async () => {
    if (Platform.OS !== "web") {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    router.push("/add-account");
  };

  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: colors.background,
          paddingTop: insets.top + 28,
          paddingBottom: insets.bottom + 28,
        },
      ]}
    >
      <View style={styles.top}>
        <Text style={[styles.step, { color: colors.mutedForeground }]}>
          STEP 1 OF 1 · GET STARTED
        </Text>
        <Text style={[styles.title, { color: colors.foreground }]}>
          Connect your{"\n"}Binance account
        </Text>
        <Text style={[styles.lede, { color: colors.mutedForeground }]}>
          Ledger reads your open loans so it can show your LTV, interest, and
          headroom. Add as many accounts as you like — each one is tracked
          separately.
        </Text>
      </View>

      <View style={styles.points}>
        <Point
          icon="shield"
          title="Read-only"
          body="Use a read-info API key. Ledger has no authority to trade, borrow, withdraw, or repay."
          colors={colors}
        />
        <Point
          icon="lock"
          title="Keys stay on device"
          body="API keys are stored in the iOS Keychain on this device. They never reach our servers."
          colors={colors}
        />
        <Point
          icon="zap"
          title="Live data"
          body="Loans, prices, and interest pull straight from Binance every time you open the app."
          colors={colors}
        />
      </View>

      <View style={styles.footer}>
        <Pressable
          onPress={onConnect}
          style={({ pressed }) => [
            styles.cta,
            {
              backgroundColor: colors.primary,
              borderRadius: colors.radius,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Text style={[styles.ctaText, { color: colors.primaryForeground }]}>
            Connect Binance account
          </Text>
          <Feather
            name="arrow-right"
            size={16}
            color={colors.primaryForeground}
          />
        </Pressable>
        <Pressable
          onPress={onSignOut}
          hitSlop={12}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Text style={[styles.signOut, { color: colors.mutedForeground }]}>
            Sign out
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function Point({
  icon,
  title,
  body,
  colors,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  title: string;
  body: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View
      style={[
        styles.point,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
        },
      ]}
    >
      <View
        style={[
          styles.iconWrap,
          { borderColor: colors.border, borderRadius: 10 },
        ]}
      >
        <Feather name={icon} size={16} color={colors.primary} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.pointTitle, { color: colors.foreground }]}>
          {title}
        </Text>
        <Text style={[styles.pointBody, { color: colors.mutedForeground }]}>
          {body}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: "space-between",
  },
  top: { gap: 12 },
  step: {
    fontSize: 10,
    letterSpacing: 1.5,
    fontFamily: "Inter_600SemiBold",
  },
  title: {
    fontSize: 30,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.6,
    lineHeight: 36,
  },
  lede: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
    marginTop: 4,
  },
  points: { gap: 10 },
  point: {
    flexDirection: "row",
    gap: 12,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "flex-start",
  },
  iconWrap: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  pointTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  pointBody: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
  },
  footer: { gap: 16, alignItems: "center" },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    width: "100%",
    paddingVertical: 16,
  },
  ctaText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  signOut: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
});
