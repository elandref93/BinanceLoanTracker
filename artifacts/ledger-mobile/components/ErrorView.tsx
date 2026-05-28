import { Feather } from "@expo/vector-icons";
import Constants from "expo-constants";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

interface Props {
  message?: string;
  onRetry?: () => void;
}

const SUPPORT_EMAIL = "ledger-bugs@ubuntu.life";

function buildMailto(message: string | undefined): string {
  const subject = "Ledger — bug report";
  const version = Constants.expoConfig?.version ?? "unknown";
  const build = Constants.expoConfig?.ios?.buildNumber ?? "unknown";
  const body = [
    "Describe what you were doing:",
    "",
    "",
    "---",
    `App version: ${version} (${build})`,
    `Platform: ${Platform.OS} ${Platform.Version}`,
    message ? `Error: ${message}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`;
}

export function ErrorView({ message, onRetry }: Props) {
  const colors = useColors();
  const onReport = () => {
    void Linking.openURL(buildMailto(message));
  };
  return (
    <View style={styles.wrap}>
      <Feather name="alert-triangle" size={28} color={colors.danger} />
      <Text style={[styles.text, { color: colors.foreground }]}>
        Couldn’t load data
      </Text>
      {message ? (
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>
          {message}
        </Text>
      ) : null}
      <View style={styles.btnRow}>
        {onRetry ? (
          <Pressable
            onPress={onRetry}
            style={({ pressed }) => [
              styles.btn,
              {
                borderColor: colors.primary,
                borderRadius: colors.radius,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text style={[styles.btnText, { color: colors.primary }]}>
              Retry
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={onReport}
          style={({ pressed }) => [
            styles.btn,
            {
              borderColor: colors.border,
              borderRadius: colors.radius,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Text style={[styles.btnText, { color: colors.mutedForeground }]}>
            Report a bug
          </Text>
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
    gap: 8,
  },
  text: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  sub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  btnRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  btn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  btnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
