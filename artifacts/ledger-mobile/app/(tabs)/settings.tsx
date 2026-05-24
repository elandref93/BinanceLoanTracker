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
import { useFocusEffect, useRouter } from "expo-router";
import { Switch } from "react-native";
import { useCallback, useEffect, useState } from "react";

import { useCurrency } from "@/context/CurrencyContext";
import { useColors } from "@/hooks/useColors";
import { getAlertsEnabled, setAlertsEnabled } from "@/lib/alerts";
import {
  listAlertRules,
  type AlertRule,
} from "@/lib/alertRules";
import {
  listAccounts,
  removeAccount,
  type StoredBinanceAccount,
} from "@/lib/binanceKeys";
import { fmtAge, fmtPct } from "@/utils/format";
import { TARGET_LTV } from "@/utils/risk";

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
  const [accounts, setAccounts] = useState<StoredBinanceAccount[]>([]);
  const [alerts, setAlerts] = useState(false);
  const [rules, setRules] = useState<AlertRule[]>([]);

  useEffect(() => {
    getAlertsEnabled().then(setAlerts);
  }, []);

  const onToggleAlerts = async (next: boolean) => {
    const ok = await setAlertsEnabled(next);
    if (!ok && next) {
      Alert.alert(
        "Notifications blocked",
        "Enable notifications for Ledger in iOS Settings to receive LTV alerts.",
      );
      return;
    }
    setAlerts(next);
  };

  useFocusEffect(
    useCallback(() => {
      let active = true;
      listAccounts().then((a) => {
        if (active) setAccounts(a);
      });
      listAlertRules().then((r) => {
        if (active) setRules(r);
      });
      return () => {
        active = false;
      };
    }, []),
  );

  const onRemove = (id: string, name: string) => {
    Alert.alert(`Remove "${name}"?`, "The key will be deleted from this device.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          await removeAccount(id);
          setAccounts(await listAccounts());
        },
      },
    ]);
  };

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
        {accounts.length === 0 ? (
          <Row
            label="No accounts connected"
            value="Tap below to add"
          />
        ) : (
          accounts.map((a, i) => (
            <View key={a.id}>
              {i > 0 ? (
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
              ) : null}
              <Row
                label={a.name}
                value={`${a.apiKeyMasked} · added ${fmtAge(a.createdAt)}`}
                onPress={() => onRemove(a.id, a.name)}
              />
            </View>
          ))
        )}
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Row
          label="Add Binance account"
          right={<Feather name="plus" size={18} color={colors.primary} />}
          onPress={() => router.push("/add-account")}
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

      <Section title="Notifications">
        <Row
          label="Push when LTV alerts trigger"
          right={
            <Switch
              value={alerts}
              onValueChange={onToggleAlerts}
              trackColor={{ true: colors.primary, false: colors.border }}
              thumbColor={colors.background}
            />
          }
        />
      </Section>

      <Section title="LTV Alert Rules">
        {rules.length === 0 ? (
          <Row label="No alerts" value="Add one below" />
        ) : (
          rules.map((r, i) => (
            <View key={r.id}>
              {i > 0 ? (
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
              ) : null}
              <Row
                label={r.label ? `${r.label} · ${fmtPct(r.ltv, 1)}` : fmtPct(r.ltv, 1)}
                value={r.scope === "any" ? "Any loan" : "1 loan"}
                onPress={() =>
                  router.push({ pathname: "/alert-rule", params: { id: r.id } })
                }
              />
            </View>
          ))
        )}
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Row
          label="Add alert rule"
          right={<Feather name="plus" size={18} color={colors.primary} />}
          onPress={() => router.push("/alert-rule")}
        />
      </Section>

      <Section title="Reference">
        <Row label="Target LTV (headroom calc)" value={`${TARGET_LTV}%`} />
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
