import { Feather } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";

import { useColors } from "@/hooks/useColors";

interface Props {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "primary" | "ok" | "warn" | "danger";
  style?: ViewStyle;
  /** When set, renders a tappable "i" info button in the tile's top-right. */
  onInfo?: () => void;
}

export function Tile({
  label,
  value,
  hint,
  tone = "default",
  style,
  onInfo,
}: Props) {
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
      <View style={styles.header}>
        <Text style={[styles.label, { color: colors.mutedForeground }]}>
          {label.toUpperCase()}
        </Text>
        {onInfo ? (
          <Pressable
            onPress={onInfo}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`${label} info`}
            style={({ pressed }) => [
              styles.info,
              { borderColor: colors.border, opacity: pressed ? 0.5 : 1 },
            ]}
          >
            <Feather name="info" size={12} color={colors.mutedForeground} />
          </Pressable>
        ) : null}
      </View>
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
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  label: {
    flex: 1,
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1,
  },
  info: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -2,
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
