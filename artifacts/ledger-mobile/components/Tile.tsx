import { StyleSheet, Text, View, type ViewStyle } from "react-native";

import { useColors } from "@/hooks/useColors";

interface Props {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "primary" | "ok" | "warn" | "danger";
  style?: ViewStyle;
}

export function Tile({ label, value, hint, tone = "default", style }: Props) {
  const colors = useColors();
  const toneColor =
    tone === "primary"
      ? colors.primary
      : tone === "ok"
        ? colors.ok
        : tone === "warn"
          ? colors.warn
          : tone === "danger"
            ? colors.danger
            : colors.foreground;
  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
        },
        style,
      ]}
    >
      <Text style={[styles.label, { color: colors.mutedForeground }]}>
        {label.toUpperCase()}
      </Text>
      <Text style={[styles.value, { color: toneColor }]}>{value}</Text>
      {hint ? (
        <Text style={[styles.hint, { color: colors.mutedForeground }]}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  label: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1,
  },
  value: {
    fontSize: 22,
    fontFamily: "Inter_600SemiBold",
    fontVariant: ["tabular-nums"],
  },
  hint: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    fontVariant: ["tabular-nums"],
  },
});
