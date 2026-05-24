import { StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import type { Status } from "@/utils/risk";

interface Props {
  status: Status;
  label: string;
}

export function Pill({ status, label }: Props) {
  const colors = useColors();
  const tone =
    status === "ok"
      ? colors.ok
      : status === "warn"
        ? colors.warn
        : colors.danger;
  return (
    <View
      style={[
        styles.wrap,
        { borderColor: tone + "55", backgroundColor: tone + "1F" },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: tone }]} />
      <Text style={[styles.label, { color: tone }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: "flex-start",
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.3 },
});
