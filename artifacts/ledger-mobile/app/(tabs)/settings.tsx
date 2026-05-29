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
import { haptic } from "@/lib/haptics";
import {
  MAX_TARGET_LTV,
  MIN_TARGET_LTV,
  useRiskSettings,
} from "@/context/RiskSettingsContext";
import { useSession } from "@/context/SessionContext";
import { useColors } from "@/hooks/useColors";
import { getAlertsEnabled, setAlertsEnabled } from "@/lib/alerts";
import {
  isContainerScope,
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
import {
  clearLocalCache,
  estimateCacheBytes,
  fmtBytes,
} from "@/lib/storage";
import { fmtAge, fmtPct } from "@/utils/format";

function Section({
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
function TypeBadge({ type }: { type: "personal" | "trust" }) {
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
  const {
    targetLtv,
    setTargetLtv,
    targetForContainer,
    setTargetForContainer,
  } = useRiskSettings();

  // When `containerId` is provided we edit that account's override; otherwise
  // we edit the global default used by any account without its own target.
  const onEditTargetLtv = (containerId?: string, label?: string) => {
    const current = containerId ? targetForContainer(containerId) : targetLtv;
    Alert.prompt(
      containerId ? `${label ?? "Account"} Target LTV` : "Default Target LTV",
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
            if (containerId) setTargetForContainer(containerId, n);
            else setTargetLtv(n);
          },
        },
      ],
      "plain-text",
      String(current),
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
  const [cacheBytes, setCacheBytes] = useState<number | null>(null);
  const [clearingCache, setClearingCache] = useState(false);

  const refreshCacheSize = useCallback(() => {
    estimateCacheBytes().then(setCacheBytes);
  }, []);

  useEffect(() => {
    getAlertsEnabled().then(setAlerts);
    isAppLockSupported().then(setAppLockSupported);
    isAppLockEnabled().then(setAppLockOn);
    refreshCacheSize();
  }, [refreshCacheSize]);

  const onClearCache = () => {
    Alert.alert(
      "Clear local cache?",
      "Wipes cached loan/account snapshots and the LTV + portfolio history charts on this device. Your exchange keys, alert rules, and sign-in stay put. Fresh data will reload on the next refresh.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: async () => {
            haptic.heavy();
            setClearingCache(true);
            try {
              await clearLocalCache();
              refreshCacheSize();
              Alert.alert(
                "Cleared",
                "Local cache and history have been wiped. Pull-to-refresh on any tab to repopulate.",
              );
            } finally {
              setClearingCache(false);
            }
          },
        },
      ],
    );
  };

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
            haptic.heavy();
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
            haptic.heavy();
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
          haptic.heavy();
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

      <View style={{ gap: 4 }}>
        <Text style={[styles.groupTitle, { color: colors.foreground }]}>
          Accounts
        </Text>
        <Text style={[styles.groupSub, { color: colors.mutedForeground }]}>
          Group your Binance and Luno links under Personal or Trust accounts.
          Each account keeps its own targets, alerts and strategy.
        </Text>
      </View>

      {containers.length === 0 ? (
        <Section title="No accounts yet">
          <Row label="No accounts connected" value="Tap below to add" />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <Row
            label="Add account"
            right={<Feather name="plus" size={18} color={colors.primary} />}
            onPress={() => router.push("/add-account")}
          />
        </Section>
      ) : (
        containers.map((c) => {
          const hasBinance = c.links.some((l) => l.exchange === "binance");
          const hasLuno = c.links.some((l) => l.exchange === "luno");
          return (
          <Section key={c.id} title={c.name} right={<TypeBadge type={c.type} />}>
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
            {!hasBinance ? (
              <>
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
              </>
            ) : null}
            {!hasLuno ? (
              <>
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
              </>
            ) : null}
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <Row
              label="Remove account"
              destructive
              onPress={() => onRemoveContainer(c.id, c.name)}
            />
          </Section>
          );
        })
      )}
      {containers.length > 0 ? (
        <Section title="Add account">
          <Row
            label="Add another account (e.g. a Trust)"
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
          rules.map((r, i) => {
            const sc = r.scope;
            const scopeValue =
              sc === "any"
                ? "Any loan"
                : isContainerScope(sc)
                  ? containers.find((c) => c.id === sc.containerId)?.name ??
                    "1 account"
                  : "1 loan";
            return (
              <View key={r.id}>
                {i > 0 ? (
                  <View
                    style={[styles.divider, { backgroundColor: colors.border }]}
                  />
                ) : null}
                <Row
                  label={
                    r.label
                      ? `${r.label} · ${fmtPct(r.ltv, 1)}`
                      : fmtPct(r.ltv, 1)
                  }
                  value={scopeValue}
                  onPress={() =>
                    router.push({ pathname: "/alert-rule", params: { id: r.id } })
                  }
                />
              </View>
            );
          })
        )}
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Row
          label="Add alert rule"
          right={<Feather name="plus" size={18} color={colors.primary} />}
          onPress={() => router.push("/alert-rule")}
        />
      </Section>

      <Section title="Target LTV (headroom calc)">
        <Row
          label="Default (all accounts)"
          value={`${targetLtv}%`}
          onPress={() => onEditTargetLtv()}
        />
        {containers.map((c) => (
          <View key={c.id}>
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <Row
              label={c.name}
              value={`${targetForContainer(c.id)}%`}
              onPress={() => onEditTargetLtv(c.id, c.name)}
            />
          </View>
        ))}
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

      <Section title="Storage">
        <Row
          label={clearingCache ? "Clearing…" : "Clear local cache"}
          value={cacheBytes != null ? fmtBytes(cacheBytes) : undefined}
          destructive
          onPress={clearingCache ? undefined : onClearCache}
        />
      </Section>

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
  sectionHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: { fontSize: 10, letterSpacing: 1, fontFamily: "Inter_600SemiBold" },
  groupTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.3,
  },
  groupSub: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
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
