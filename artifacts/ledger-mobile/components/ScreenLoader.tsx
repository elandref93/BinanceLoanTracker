import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

export function ScreenLoader({ hint }: { hint?: string }) {
  const colors = useColors();
  return (
    <View style={[styles.wrap, { backgroundColor: colors.background }]}>
      <ActivityIndicator color={colors.primary} />
      {hint ? (
        <Text style={[styles.hint, { color: colors.mutedForeground }]}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  hint: { fontSize: 12, fontFamily: "Inter_400Regular" },
});
