import { Feather } from "@expo/vector-icons";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Container } from "@/components/Container";
import { Divider, Row, Section, TypeBadge } from "@/components/SettingsList";
import {
  MAX_TARGET_LTV,
  MIN_TARGET_LTV,
  useRiskSettings,
} from "@/context/RiskSettingsContext";
import { useColors } from "@/hooks/useColors";
import {
  listContainersWithSecrets,
  removeContainer,
  removeLink,
  updateProfile,
  type AccountContainer,
} from "@/lib/accountStore";
import {
  isContainerScope,
  listAlertRules,
  type AlertRule,
} from "@/lib/alertRules";
import { haptic } from "@/lib/haptics";
import { fmtAge, fmtPct } from "@/utils/format";

function exchangeName(exchange: "binance" | "luno"): string {
  return exchange === "binance" ? "Binance" : "Luno";
}

export default function AccountDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { targetForContainer, setTargetForContainer } = useRiskSettings();

  const [container, setContainer] = useState<AccountContainer | null>(null);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  const refresh = useCallback(async () => {
    const all = await listContainersWithSecrets();
    setContainer(all.find((c) => c.id === id) ?? null);
    setRules(await listAlertRules());
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void refresh().then(() => {
        if (!active) return;
      });
      return () => {
        active = false;
      };
    }, [refresh]),
  );

  const onEditAlias = () => {
    if (!container) return;
    Alert.prompt(
      "Account name",
      "An optional label to tell accounts of the same type apart (e.g. \"Family Trust\"). Leave blank to use just the type name.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Save",
          onPress: async (text?: string) => {
            const trimmed = (text ?? "").trim();
            await updateProfile(container.id, { label: trimmed || null });
            await refresh();
          },
        },
      ],
      "plain-text",
      container.label ?? "",
    );
  };

  const onEditTarget = () => {
    if (!container) return;
    const current = targetForContainer(container.id);
    Alert.prompt(
      `${container.name} Target LTV`,
      `Used for headroom calculations. Allowed range: ${MIN_TARGET_LTV}–${MAX_TARGET_LTV}%.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Save",
          onPress: (text?: string) => {
            const n = Number((text ?? "").trim().replace("%", ""));
            if (!Number.isFinite(n)) {
              Alert.alert("Invalid value", `Enter a number between ${MIN_TARGET_LTV} and ${MAX_TARGET_LTV}.`);
              return;
            }
            if (n < MIN_TARGET_LTV || n > MAX_TARGET_LTV) {
              Alert.alert(
                "Out of range",
                `Target LTV must be between ${MIN_TARGET_LTV} and ${MAX_TARGET_LTV}.`,
              );
              return;
            }
            setTargetForContainer(container.id, n);
          },
        },
      ],
      "plain-text",
      String(current),
      "number-pad",
    );
  };

  const onRemoveLink = (linkId: string, label: string) => {
    if (!container) return;
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
            await removeLink(container.id, linkId);
            await refresh();
          },
        },
      ],
    );
  };

  const onRemoveAccount = () => {
    if (!container) return;
    Alert.alert(
      `Remove "${container.name}"?`,
      "The account and all its exchange links will be removed from this device.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            haptic.heavy();
            await removeContainer(container.id);
            router.back();
          },
        },
      ],
    );
  };

  if (!container) {
    return (
      <>
        <Stack.Screen options={{ title: "Account" }} />
        <View
          style={{
            flex: 1,
            backgroundColor: colors.background,
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <Text style={{ color: colors.mutedForeground }}>
            Account not found on this device.
          </Text>
        </View>
      </>
    );
  }

  const hasBinance = container.links.some((l) => l.exchange === "binance");
  const hasLuno = container.links.some((l) => l.exchange === "luno");
  const accountRules = rules.filter(
    (r) => isContainerScope(r.scope) && r.scope.containerId === container.id,
  );

  return (
    <>
      <Stack.Screen options={{ title: container.name }} />
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={{
          paddingTop: 16,
          paddingBottom: insets.bottom + 40,
          paddingHorizontal: 16,
          gap: 20,
        }}
      >
        <Container style={{ gap: 20 }}>
          <Section title="Profile" right={<TypeBadge type={container.type} />}>
            <Row
              label="Name"
              value={container.label ?? "None"}
              onPress={onEditAlias}
            />
            <Divider />
            <Row
              label="Type"
              value={container.type === "trust" ? "Trust" : "Personal"}
            />
          </Section>

          <Section title="Exchanges">
            {container.links.length === 0 ? (
              <Row label="No exchanges linked yet" />
            ) : (
              container.links.map((link, i) => {
                const title = exchangeName(link.exchange);
                const open = revealed[link.id] ?? false;
                return (
                  <View key={link.id}>
                    {i > 0 ? <Divider /> : null}
                    <View style={styles.linkBlock}>
                      <View style={styles.linkHead}>
                        <Text style={[styles.linkTitle, { color: colors.foreground }]}>
                          {title}
                        </Text>
                        <Text style={[styles.linkAge, { color: colors.mutedForeground }]}>
                          added {fmtAge(link.createdAt)}
                        </Text>
                      </View>

                      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
                        API KEY
                      </Text>
                      <Text
                        selectable
                        style={[styles.cred, { color: colors.foreground }]}
                      >
                        {link.credentials.apiKey}
                      </Text>

                      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
                        API SECRET
                      </Text>
                      {open ? (
                        <Text
                          selectable
                          style={[styles.cred, { color: colors.foreground }]}
                        >
                          {link.credentials.apiSecret}
                        </Text>
                      ) : (
                        <Text style={[styles.cred, { color: colors.mutedForeground }]}>
                          ••••••••••••••••••••
                        </Text>
                      )}

                      <View style={styles.linkActions}>
                        <Pressable
                          onPress={() =>
                            setRevealed((p) => ({ ...p, [link.id]: !open }))
                          }
                          style={({ pressed }) => [styles.action, { opacity: pressed ? 0.6 : 1 }]}
                        >
                          <Feather
                            name={open ? "eye-off" : "eye"}
                            size={13}
                            color={colors.primary}
                          />
                          <Text style={[styles.actionText, { color: colors.primary }]}>
                            {open ? "Hide secret" : "Reveal secret"}
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() => onRemoveLink(link.id, title)}
                          style={({ pressed }) => [styles.action, { opacity: pressed ? 0.6 : 1 }]}
                        >
                          <Feather name="trash-2" size={13} color={colors.danger} />
                          <Text style={[styles.actionText, { color: colors.danger }]}>
                            Remove
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  </View>
                );
              })
            )}
            {!hasBinance ? (
              <>
                <Divider />
                <Row
                  label="Add Binance link"
                  right={<Feather name="plus" size={18} color={colors.primary} />}
                  onPress={() =>
                    router.push({
                      pathname: "/add-account",
                      params: { exchange: "binance", containerId: container.id },
                    })
                  }
                />
              </>
            ) : null}
            {!hasLuno ? (
              <>
                <Divider />
                <Row
                  label="Add Luno link"
                  right={<Feather name="plus" size={18} color={colors.primary} />}
                  onPress={() =>
                    router.push({
                      pathname: "/add-account",
                      params: { exchange: "luno", containerId: container.id },
                    })
                  }
                />
              </>
            ) : null}
          </Section>

          <Section title="Target LTV (headroom calc)">
            <Row
              label="Target for this account"
              value={`${targetForContainer(container.id)}%`}
              onPress={onEditTarget}
            />
          </Section>

          <Section title="LTV alerts for this account">
            {accountRules.length === 0 ? (
              <Row label="No account-specific alerts" value="Add one below" />
            ) : (
              accountRules.map((r, i) => (
                <View key={r.id}>
                  {i > 0 ? <Divider /> : null}
                  <Row
                    label={r.label ? `${r.label} · ${fmtPct(r.ltv, 1)}` : fmtPct(r.ltv, 1)}
                    onPress={() =>
                      router.push({ pathname: "/alert-rule", params: { id: r.id } })
                    }
                  />
                </View>
              ))
            )}
            <Divider />
            <Row
              label="Add alert for this account"
              right={<Feather name="plus" size={18} color={colors.primary} />}
              onPress={() =>
                router.push({
                  pathname: "/alert-rule",
                  params: { containerId: container.id },
                })
              }
            />
          </Section>

          <Section title="Danger zone">
            <Row label="Remove account" destructive onPress={onRemoveAccount} />
          </Section>
        </Container>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  linkBlock: { paddingVertical: 14, gap: 6 },
  linkHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 2,
  },
  linkTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  linkAge: { fontSize: 11, fontFamily: "Inter_400Regular" },
  fieldLabel: {
    fontSize: 9,
    letterSpacing: 1,
    fontFamily: "Inter_600SemiBold",
    marginTop: 4,
  },
  cred: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    fontVariant: ["tabular-nums"],
    lineHeight: 17,
  },
  linkActions: { flexDirection: "row", gap: 20, marginTop: 8 },
  action: { flexDirection: "row", alignItems: "center", gap: 5 },
  actionText: { fontSize: 12, fontFamily: "Inter_500Medium" },
});
