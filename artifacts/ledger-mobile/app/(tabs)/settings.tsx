import { Feather } from "@expo/vector-icons";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth, useUser } from "@clerk/expo";
import { useRouter } from "expo-router";

import { useCurrency } from "@/context/CurrencyContext";
import { useColors } from "@/hooks/useColors";
import { fmtAge } from "@/utils/format";
import { LIQ_LTV, TARGET_LTV, WARNING_LTV } from "@/utils/risk";
import { useListAccounts } from "@workspace/api-client-react";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
        {title.toUpperCase()}
      </Text>
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

function Row({
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
      {right ?? (
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
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      {content}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currency, set } = useCurrency();
  const { signOut } = useAuth();
  const { user } = useUser();
  const router = useRouter();
  const email = user?.primaryEmailAddress?.emailAddress ?? null;
  const accountsQ = useListAccounts();
  const accounts = accountsQ.data?.accounts ?? [];

  const onSignOut = () => {
    Alert.alert("Sign out?", "You'll need to log in again.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          await signOut();
          router.replace("/(auth)/sign-in");
        },
      },
    ]);
  };

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{
        paddingTop: insets.top + 16,
        paddingBottom: insets.bottom + 100,
        paddingHorizontal: 16,
        gap: 20,
      }}
    >
      <Text style={[styles.title, { color: colors.foreground }]}>Settings</Text>

      <Section title="Accounts">
        {accounts.map((a, i) => (
          <Row
            key={a.id}
            label={a.name}
            value={`${a.kind} · added ${fmtAge(a.connectedAt)}`}
            onPress={() => {}}
          />
        ))}
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Row
          label="Add account"
          right={
            <Feather name="plus" size={18} color={colors.primary} />
          }
          onPress={() =>
            Alert.alert(
              "Add account",
              "API key import will be available in a later build.",
            )
          }
        />
      </Section>

      <Section title="Currency">
        <Row
          label="USD"
          right={
            currency === "USD" ? (
              <Feather name="check" size={18} color={colors.primary} />
            ) : null
          }
          onPress={() => set("USD")}
        />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Row
          label="ZAR"
          right={
            currency === "ZAR" ? (
              <Feather name="check" size={18} color={colors.primary} />
            ) : null
          }
          onPress={() => set("ZAR")}
        />
      </Section>

      <Section title="Thresholds">
        <Row label="Target LTV" value={`${TARGET_LTV}%`} />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Row label="Warning LTV" value={`${WARNING_LTV}%`} />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Row label="Liquidation LTV" value={`${LIQ_LTV}%`} />
      </Section>

      <Section title="Account">
        <Row label="Email" value={email ?? ""} />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Row label="Sign out" destructive onPress={onSignOut} />
      </Section>

      <Text style={[styles.version, { color: colors.mutedForeground }]}>
        Ledger · v1.0.0 · TestFlight
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  section: { gap: 8 },
  sectionTitle: { fontSize: 10, letterSpacing: 1, fontFamily: "Inter_600SemiBold" },
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
  rowLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  rowRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowValue: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    fontVariant: ["tabular-nums"],
  },
  divider: { height: StyleSheet.hairlineWidth },
  version: {
    textAlign: "center",
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 20,
  },
});
