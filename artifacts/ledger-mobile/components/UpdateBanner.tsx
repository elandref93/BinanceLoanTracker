import { Feather } from "@expo/vector-icons";
import * as Updates from "expo-updates";
import { useCallback } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { haptic } from "@/lib/haptics";

/**
 * Floating top banner that makes over-the-air updates visible. It surfaces the
 * otherwise-silent update lifecycle: a brief "Checking…" on launch, a
 * "Downloading…" spinner while a new JS bundle pulls down, and — once a bundle
 * is staged — a one-tap "Update ready" pill that restarts straight into the new
 * version (instead of the default silent apply-on-next-launch).
 *
 * Renders nothing when updates are disabled (Expo Go / development) or when
 * nothing is happening, so it stays out of the way until it has something to say.
 */
export function UpdateBanner() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isChecking, isDownloading, isUpdatePending } = Updates.useUpdates();

  const onRestart = useCallback(async () => {
    haptic.impact();
    try {
      await Updates.reloadAsync();
    } catch {
      Alert.alert(
        "Couldn't restart",
        "The update is downloaded and will apply next time you fully close and reopen Ledger.",
      );
    }
  }, []);

  if (!Updates.isEnabled) return null;

  let body: React.ReactNode = null;
  if (isUpdatePending) {
    body = (
      <Pressable
        onPress={onRestart}
        style={({ pressed }) => [
          styles.pill,
          { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
        ]}
      >
        <Feather name="download" size={14} color="#06090C" />
        <Text style={[styles.text, { color: "#06090C" }]}>
          Update ready — tap to restart
        </Text>
      </Pressable>
    );
  } else if (isDownloading || isChecking) {
    body = (
      <View
        style={[
          styles.pill,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderWidth: StyleSheet.hairlineWidth,
          },
        ]}
      >
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={[styles.text, { color: colors.foreground }]}>
          {isDownloading ? "Downloading update…" : "Checking for update…"}
        </Text>
      </View>
    );
  }

  if (!body) return null;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { paddingBottom: insets.bottom + 70 }]}
    >
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    paddingHorizontal: 16,
    zIndex: 1000,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  text: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
