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

import { useFocusEffect, useRouter } from "expo-router";
import { ActivityIndicator, Switch } from "react-native";
import { useCallback, useEffect, useState } from "react";

import { Container } from "@/components/Container";
import { useCurrency } from "@/context/CurrencyContext";
import {
  MAX_TARGET_LTV,
  MIN_TARGET_LTV,
  useRiskSettings,
} from "@/context/RiskSettingsContext";
import { useSession } from "@/context/SessionContext";
import { useColors } from "@/hooks/useColors";
import { getAlertsEnabled, setAlertsEnabled } from "@/lib/alerts";
import {
  listAlertRules,
  type AlertRule,
} from "@/lib/alertRules";
import {
  listAccountsWithSecrets,
} from "@/lib/binanceKeys";
import {
  listContainers,
  removeContainer,
  removeLink,
  type StoredContainer,
} from "@/lib/accountStore";
import {
  isAppLockEnabled,
  isAppLockSupported,
  setAppLockEnabled,
} from "@/lib/appLock";
import { probeAccount, type ProbeResult } from "@/lib/keyHealth";
import { fmtAge, fmtPct } from "@/utils/format";

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
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      {content}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currency, set } = useCurrency();
  const { targetLtv, setTargetLtv } = useRiskSettings();

  const onEditTargetLtv = () => {
    Alert.prompt(
      "Target LTV",
      `Used for headroom calculations. Allowed range: ${MIN_TARGET_LTV}–${MAX_TARGET_LTV}%.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Save",
          onPress: (text?: string) => {
            const n = Number((text ?? "").trim().replace("%", ""));
            if (!Number.isFinite(n)) {
              Alert.alert("Invalid value", "Enter a number between 30 and 77.");
              return;
            }
            if (n < MIN_TARGET_LTV || n > MAX_TARGET_LTV) {
              Alert.alert(
                "Out of range",
                `Target LTV must be between ${MIN_TARGET_LTV} and ${MAX_TARGET_LTV}.`,
              );
              return;
            }
            setTargetLtv(n);
          },
        },
      ],
      "plain-text",
      String(targetLtv),
      "number-pad",
    );
  };
  const { signOut, getToken, user } = useSession();
  const router = useRouter();
  const email = user?.email ?? null;
  const [containers, setContainers] = useState<StoredContainer[]>([]);
  const [alerts, setAlerts] = useState(false);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [appLockOn, setAppLockOn] = useState(false);
  const [appLockSupported, setAppLockSupported] = useState(false);
  const [probes, setProbes] = useState<
    Record<string, ProbeResult | "loading" | undefined>
  >({});

  useEffect(() => {
    getAlertsEnabled().then(setAlerts);
    isAppLockSupported().then(setAppLockSupported);
    isAppLockEnabled().then(setAppLockOn);
  }, []);

  const onToggleAppLock = async (next: boolean) => {
    await setAppLockEnabled(next);
    setAppLockOn(next);
  };

  const onTestConnection = async (id: string) => {
    setProbes((p) => ({ ...p, [id]: "loading" }));
    const all = await listAccountsWithSecrets();
    const acc = all.find((a) => a.id === id);
    if (!acc) {
      setProbes((p) => ({
        ...p,
        [id]: {
          status: "fail",
          checkedAt: Date.now(),
          reason: "Account not found on device",
        },
      }));
      return;
    }
    const baseUrl = process.env.EXPO_PUBLIC_DOMAIN
      ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
      : "";
    let token: string | null = null;
    try {
      token = await getToken();
    } catch {
      // ignore — server will 401 and probeAccount surfaces the reason
    }
    const result = await probeAccount(acc, baseUrl, token);
    setProbes((p) => ({ ...p, [id]: result }));
    if (result.status === "fail") {
      Alert.alert("Connection failed", result.reason);
    }
  };

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
      listContainers().then((c) => {
        if (active) setContainers(c);
      });
      listAlertRules().then((r) => {
        if (active) setRules(r);
      });
      return () => {
        active = false;
      };
    }, []),
  );

  const refreshContainers = async () => setContainers(await listContainers());

  const onRemoveLink = (
    containerId: string,
    linkId: string,
    label: string,
  ) => {
    Alert.alert(
      `Remove "${label}"?`,
      "This exchange key will be deleted from this device.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            await removeLink(containerId, linkId);
            await refreshContainers();
          },
        },
      ],
    );
  };

  const onRemoveContainer = (id: string, name: string) => {
    Alert.alert(
      `Remove "${name}"?`,
      "The account and all its exchange links will be removed from this device.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            await removeContainer(id);
            await refreshContainers();
          },
        },
      ],
    );
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
      <Container style={{ gap: 20 }}>
      <Text style={[styles.title, { color: colors.foreground }]}>Settings</Text>

      {containers.length === 0 ? (
        <Section title="Accounts">
          <Row label="No accounts connected" value="Tap below to add" />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <Row
            label="Add exchange"
            right={<Feather name="plus" size={18} color={colors.primary} />}
            onPress={() => router.push("/add-account")}
          />
        </Section>
      ) : (
        containers.map((c) => (
          <Section key={c.id} title={c.name}>
            {c.links.length === 0 ? (
              <Row label="No exchanges linked yet" />
            ) : (
              c.links.map((link, i) => {
                const probe = probes[link.id];
                const probeObj =
                  probe && probe !== "loading" ? probe : undefined;
                const linkTitle = link.label
                  ? `${link.exchange === "binance" ? "Binance" : "Luno"} · ${link.label}`
                  : link.exchange === "binance"
                    ? "Binance"
                    : "Luno";
                return (
                  <View key={link.id}>
                    {i > 0 ? (
                      <View
                        style={[
                          styles.divider,
                          { backgroundColor: colors.border },
                        ]}
                      />
                    ) : null}
                    <Row
                      label={linkTitle}
                      value={`${link.apiKeyMasked} · added ${fmtAge(link.createdAt)}`}
                      onPress={() => onRemoveLink(c.id, link.id, linkTitle)}
                    />
                    {/* Probe is binance-only — Luno health is implicit via the Crypto tab loads. */}
                    {link.exchange === "binance" ? (
                      <Pressable
                        onPress={() => onTestConnection(link.id)}
                        disabled={probe === "loading"}
                        style={({ pressed }) => [
                          styles.probeRow,
                          {
                            opacity:
                              pressed || probe === "loading" ? 0.6 : 1,
                          },
                        ]}
                      >
                        {probe === "loading" ? (
                          <ActivityIndicator
                            color={colors.primary}
                            size="small"
                          />
                        ) : probeObj?.status === "ok" ? (
                          <Feather
                            name="check-circle"
                            size={12}
                            color={colors.ok}
                          />
                        ) : probeObj?.status === "fail" ? (
                          <Feather
                            name="alert-circle"
                            size={12}
                            color={colors.danger}
                          />
                        ) : (
                          <Feather
                            name="zap"
                            size={12}
                            color={colors.mutedForeground}
                          />
                        )}
                        <Text
                          style={[
                            styles.probeText,
                            {
                              color:
                                probeObj?.status === "ok"
                                  ? colors.ok
                                  : probeObj?.status === "fail"
                                    ? colors.danger
                                    : colors.mutedForeground,
                            },
                          ]}
                        >
                          {probe === "loading"
                            ? "Testing…"
                            : probeObj?.status === "ok"
                              ? `Healthy · checked ${fmtAge(new Date(probeObj.checkedAt).toISOString())}`
                              : probeObj?.status === "fail"
                                ? `Failed · ${probeObj.reason}`
                                : "Test connection"}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              })
            )}
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <Row
              label="Add Binance link"
              right={<Feather name="plus" size={18} color={colors.primary} />}
              onPress={() =>
                router.push({
                  pathname: "/add-account",
                  params: { exchange: "binance", containerId: c.id },
                })
              }
            />
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <Row
              label="Add Luno link"
              right={<Feather name="plus" size={18} color={colors.primary} />}
              onPress={() =>
                router.push({
                  pathname: "/add-account",
                  params: { exchange: "luno", containerId: c.id },
                })
              }
            />
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <Row
              label="Remove account"
              destructive
              onPress={() => onRemoveContainer(c.id, c.name)}
            />
          </Section>
        ))
      )}
      {containers.length > 0 ? (
        <Section title="New account">
          <Row
            label="Add another account"
            right={<Feather name="plus" size={18} color={colors.primary} />}
            onPress={() => router.push("/add-account")}
          />
        </Section>
      ) : null}

      <Section title="Currency">
        <Row
          label="USD"
          right={
            <Feather
              name="check"
              size={18}
              color={currency === "USD" ? colors.primary : "transparent"}
            />
          }
          onPress={() => set("USD")}
        />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Row
          label="ZAR"
          right={
            <Feather
              name="check"
              size={18}
              color={currency === "ZAR" ? colors.primary : "transparent"}
            />
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
        <Row
          label="Target LTV (headroom calc)"
          value={`${targetLtv}%`}
          onPress={onEditTargetLtv}
        />
      </Section>

      {appLockSupported ? (
        <Section title="Security">
          <Row
            label="Require Face ID on open"
            right={
              <Switch
                value={appLockOn}
                onValueChange={onToggleAppLock}
                trackColor={{ true: colors.primary, false: colors.border }}
                thumbColor={colors.background}
              />
            }
          />
        </Section>
      ) : null}

      <Section title="Account">
        <Row label="Email" value={email ?? ""} />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Row label="Sign out" destructive onPress={onSignOut} />
      </Section>

      <Text style={[styles.version, { color: colors.mutedForeground }]}>
        Ledger · v1.0.0 · TestFlight
      </Text>
      </Container>
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
  probeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingBottom: 10,
    paddingLeft: 2,
    marginTop: -4,
  },
  probeText: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
  },
  version: {
    textAlign: "center",
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 20,
  },
});
