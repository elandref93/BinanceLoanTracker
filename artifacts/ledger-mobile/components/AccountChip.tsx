import { Pressable, StyleSheet, Text } from "react-native";

import { useColors } from "@/hooks/useColors";

interface Props {
  label: string;
  selected: boolean;
  hint?: string;
  onPress: () => void;
}

export function AccountChip({ label, selected, hint, onPress }: Props) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.wrap,
        {
          backgroundColor: selected ? colors.primary + "1F" : colors.card,
          borderColor: selected ? colors.primary : colors.border,
          borderRadius: colors.radius,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text
        style={[
          styles.label,
          { color: selected ? colors.primary : colors.foreground },
        ]}
      >
        {label}
      </Text>
      {hint ? (
        <Text style={[styles.hint, { color: colors.mutedForeground }]}>
          {hint}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  label: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  hint: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    fontVariant: ["tabular-nums"],
  },
});
