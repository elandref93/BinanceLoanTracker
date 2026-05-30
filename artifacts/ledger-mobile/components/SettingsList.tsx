import { Feather } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

export function Section({
  title,
  children,
  right,
}: {
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
          {title.toUpperCase()}
        </Text>
        {right}
      </View>
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
        {children}
      </View>
    </View>
  );
}

// Small pill that tags an account card as Personal or Trust so the
// "Accounts" group reads as a clear two-level hierarchy.
export function TypeBadge({ type }: { type: "personal" | "trust" }) {
  const colors = useColors();
  const tone = type === "trust" ? colors.primary : colors.mutedForeground;
  return (
    <View style={[styles.badge, { borderColor: tone }]}>
      <Text style={[styles.badgeText, { color: tone }]}>
        {type === "trust" ? "TRUST" : "PERSONAL"}
      </Text>
    </View>
  );
}

export function Divider() {
  const colors = useColors();
  return <View style={[styles.divider, { backgroundColor: colors.border }]} />;
}

export function Row({
  label,
  value,
  onPress,
  destructive,
  right,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  destructive?: boolean;
  right?: React.ReactNode;
}) {
  const colors = useColors();
  const content = (
    <View style={styles.row}>
      <Text
        style={[
          styles.rowLabel,
          { color: destructive ? colors.danger : colors.foreground },
        ]}
      >
        {label}
      </Text>
      {right !== undefined ? (
        right
      ) : (
        <View style={styles.rowRight}>
          {value ? (
            <Text style={[styles.rowValue, { color: colors.mutedForeground }]}>
              {value}
            </Text>
          ) : null}
          {onPress ? (
            <Feather
              name="chevron-right"
              size={16}
              color={colors.mutedForeground}
            />
          ) : null}
        </View>
      )}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  sectionHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: {
    fontSize: 10,
    letterSpacing: 1,
    fontFamily: "Inter_600SemiBold",
  },
  badge: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: { fontSize: 9, letterSpacing: 1, fontFamily: "Inter_600SemiBold" },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
  },
  rowLabel: { fontSize: 14, fontFamily: "Inter_500Medium", flexShrink: 1, paddingRight: 12 },
  rowRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowValue: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    fontVariant: ["tabular-nums"],
  },
  divider: { height: StyleSheet.hairlineWidth },
});
