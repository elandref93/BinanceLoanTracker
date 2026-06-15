import { Feather } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { isExpoGo } from "@/lib/runtime";

const MESSAGE =
  "Expo Go uses a separate Apple identity. Profiles linked in TestFlight will not sync here. Use the TestFlight build to test cross-device sync.";

export function ExpoGoBanner() {
  const colors = useColors();
  if (!isExpoGo()) return null;

  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: colors.card,
          borderColor: colors.warn,
          borderRadius: colors.radius,
        },
      ]}
    >
      <Feather name="alert-triangle" size={16} color={colors.warn} />
      <Text style={[styles.text, { color: colors.foreground }]}>{MESSAGE}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    gap: 10,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "flex-start",
  },
  text: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: "Inter_500Medium",
  },
});
