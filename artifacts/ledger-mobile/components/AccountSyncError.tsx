import { Feather } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { haptic } from "@/lib/haptics";

type Props = {
  message: string;
  onRetry: () => void;
  retrying?: boolean;
};

export function AccountSyncError({
  message,
  onRetry,
  retrying = false,
}: Props) {
  const colors = useColors();

  return (
    <View style={[styles.wrap, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius: colors.radius,
          },
        ]}
      >
        <Feather name="cloud-off" size={28} color={colors.danger} />
        <Text style={[styles.title, { color: colors.foreground }]}>
          Couldn&apos;t load accounts
        </Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          {message}
        </Text>
        <Pressable
          disabled={retrying}
          onPress={() => {
            haptic.impact();
            onRetry();
          }}
          style={({ pressed }) => [
            styles.btn,
            {
              backgroundColor: colors.primary,
              borderRadius: colors.radius,
              opacity: pressed || retrying ? 0.7 : 1,
            },
          ]}
        >
          {retrying ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={[styles.btnText, { color: colors.primaryForeground }]}>
              Retry sync
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 400,
    padding: 24,
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
  },
  title: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  btn: {
    marginTop: 8,
    width: "100%",
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  btnText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
});
