import { Feather } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

interface Props {
  message?: string;
  onRetry?: () => void;
}

export function ErrorView({ message, onRetry }: Props) {
  const colors = useColors();
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
  btn: {
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  btnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
