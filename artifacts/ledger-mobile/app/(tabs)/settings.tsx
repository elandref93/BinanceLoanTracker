import { Feather } from "@expo/vector-icons";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useFocusEffect, useRouter } from "expo-router";
import { Switch } from "react-native";
import { useCallback, useEffect, useState } from "react";

import { Container } from "@/components/Container";
import { Divider, Row, Section } from "@/components/SettingsList";
import { UpdateSettings } from "@/components/UpdateSettings";
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
  listContainers,
  type StoredContainer,
} from "@/lib/accountStore";
import {
  isAppLockEnabled,
  isAppLockSupported,
  setAppLockEnabled,
} from "@/lib/appLock";
import {
  clearLocalCache,
  estimateCacheBytes,
  fmtBytes,
} from "@/lib/storage";
import { fmtPct } from "@/utils/format";

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currency, set } = useCurrency();
  const { targetLtv, setTargetLtv } = useRiskSettings();

  // Edits the global default target. Per-account overrides live on each
  // account's detail page (Accounts → account → Target LTV).
  const onEditTargetLtv = () => {
    Alert.prompt(
      "Default Target LTV",
      `Used for headroom calculations. Allowed range: ${MIN_TARGET_LTV}–${MAX_TARGET_LTV}%.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Save",
          onPress: (text?: string) => {
            const n = Number((text ?? "").trim().replace("%", ""));
            if (!Number.isFinite(n)) {
              Alert.alert(
                "Invalid value",
                `Enter a number between ${MIN_TARGET_LTV} and ${MAX_TARGET_LTV}.`,
              );
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
  const { signOut, user } = useSession();
  const router = useRouter();
  const email = user?.email ?? null;
  const [containers, setContainers] = useState<StoredContainer[]>([]);
  const [alerts, setAlerts] = useState(false);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [appLockOn, setAppLockOn] = useState(false);
  const [appLockSupported, setAppLockSupported] = useState(false);
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

      <Section title="Accounts">
        <Row
          label="Manage accounts"
          value={
            containers.length === 0
              ? "None yet"
              : `${containers.length} account${containers.length === 1 ? "" : "s"}`
          }
          onPress={() => router.push("/accounts")}
        />
      </Section>

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
          onPress={onEditTargetLtv}
        />
        <Divider />
        <Row
          label="Per-account targets"
          value="In Accounts"
          onPress={() => router.push("/accounts")}
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

      <Section title="Storage">
        <Row
          label={clearingCache ? "Clearing…" : "Clear local cache"}
          value={cacheBytes != null ? fmtBytes(cacheBytes) : undefined}
          destructive
          onPress={clearingCache ? undefined : onClearCache}
        />
      </Section>

      <Section title="Diagnostics">
        <Row
          label="Crash logs"
          value="View recent errors"
          onPress={() => router.push("/diagnostics")}
        />
      </Section>

      <Section title="Account">
        <Row label="Email" value={email ?? ""} />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Row label="Sign out" destructive onPress={onSignOut} />
      </Section>

      <UpdateSettings />

      <Pressable
        hitSlop={10}
        onPress={async () => {
          await Clipboard.setStringAsync("Ledger · v1.0.0 · TestFlight");
          haptic.tap();
          Alert.alert("Copied", "Build info copied to clipboard.");
        }}
      >
        <Text style={[styles.version, { color: colors.mutedForeground }]}>
          Ledger · v1.0.0 · TestFlight
        </Text>
      </Pressable>
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
  divider: { height: StyleSheet.hairlineWidth },
  version: {
    textAlign: "center",
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 20,
  },
});
