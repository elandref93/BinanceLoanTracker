import { Feather } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";
import { haptic } from "@/lib/haptics";
import {
  deleteAlertRule,
  isContainerScope,
  isLoanScope,
  listAlertRules,
  makeRuleId,
  upsertAlertRule,
  type AlertRule,
  type AlertScope,
} from "@/lib/alertRules";
import { useRiskSettings } from "@/context/RiskSettingsContext";
import { useListAccounts, useListLoans } from "@workspace/api-client-react";

export default function AlertRuleScreen() {
  const colors = useColors();
  const router = useRouter();
  const { id, loanId: presetLoanId } = useLocalSearchParams<{
    id?: string;
    loanId?: string;
  }>();
  const isEdit = Boolean(id);

  const [ltvStr, setLtvStr] = useState("70");
  const [label, setLabel] = useState("");
  const [scope, setScope] = useState<AlertScope>(
    presetLoanId ? { loanId: presetLoanId } : "any",
  );
  const [busy, setBusy] = useState(false);

  const loansQ = useListLoans();
  const accountsQ = useListAccounts();
  const { containers } = useRiskSettings();
  const loans = loansQ.data?.loans ?? [];
  const accounts = accountsQ.data?.accounts ?? [];

  useEffect(() => {
    if (!isEdit) return;
    listAlertRules().then((rules) => {
      const r = rules.find((x) => x.id === id);
      if (!r) return;
      setLtvStr(String(r.ltv));
      setLabel(r.label ?? "");
      setScope(r.scope);
    });
  }, [id, isEdit]);

  const ltv = Number(ltvStr);
  const valid = Number.isFinite(ltv) && ltv > 0 && ltv < 100;

  const accountFor = useMemo(
    () => (loanId: string) => {
      const l = loans.find((x) => x.id === loanId);
      const a = accounts.find((x) => x.id === l?.accountId);
      return a?.name ?? "—";
    },
    [loans, accounts],
  );

  const onSave = async () => {
    if (!valid) return;
    setBusy(true);
    const rule: AlertRule = {
      id: isEdit && id ? id : makeRuleId(),
      ltv: Math.round(ltv * 10) / 10,
      scope,
      label: label.trim() || undefined,
    };
    await upsertAlertRule(rule);
    setBusy(false);
    router.back();
  };

  const onDelete = () => {
    if (!isEdit || !id) return;
    Alert.alert("Delete alert?", "This rule will be removed from this device.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          haptic.heavy();
          setBusy(true);
          await deleteAlertRule(id);
          setBusy(false);
          router.back();
        },
      },
    ]);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <Stack.Screen options={{ title: isEdit ? "Edit alert" : "New alert" }} />
      <ScrollView contentContainerStyle={styles.wrap}>
        <View>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>
            TRIGGER WHEN LTV REACHES
          </Text>
          <View style={styles.ltvRow}>
            <TextInput
              keyboardType="decimal-pad"
              value={ltvStr}
              onChangeText={setLtvStr}
              style={[
                styles.ltvInput,
                {
                  color: colors.foreground,
                  borderColor: colors.border,
                  backgroundColor: colors.card,
                  borderRadius: colors.radius,
                },
              ]}
            />
            <Text style={[styles.ltvPct, { color: colors.mutedForeground }]}>
              %
            </Text>
          </View>
        </View>

        <View>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>
            LABEL (OPTIONAL)
          </Text>
          <TextInput
            value={label}
            onChangeText={setLabel}
            placeholder="e.g. Margin call"
            placeholderTextColor={colors.mutedForeground}
            style={[
              styles.textInput,
              {
                color: colors.foreground,
                borderColor: colors.border,
                backgroundColor: colors.card,
                borderRadius: colors.radius,
              },
            ]}
          />
        </View>

        <View>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>
            APPLIES TO
          </Text>
          <View
            style={[
              styles.scopeCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: colors.radius,
              },
            ]}
          >
            <ScopeRow
              label="Any loan"
              hint="Fires on every loan that reaches the threshold"
              selected={scope === "any"}
              onPress={() => setScope("any")}
            />
            {containers.map((c) => {
              const isSel = isContainerScope(scope) && scope.containerId === c.id;
              return (
                <ScopeRow
                  key={c.id}
                  label={`${c.name} account`}
                  hint="Fires on any loan in this account"
                  selected={isSel}
                  onPress={() => setScope({ containerId: c.id })}
                />
              );
            })}
            {loans.map((l) => {
              const isSel = isLoanScope(scope) && scope.loanId === l.id;
              return (
                <ScopeRow
                  key={l.id}
                  label={`${l.collateral.asset}/${l.asset}`}
                  hint={`${accountFor(l.id)} · current ${l.ltv.toFixed(1)}%`}
                  selected={isSel}
                  onPress={() => setScope({ loanId: l.id })}
                />
              );
            })}
          </View>
        </View>

        <Pressable
          disabled={!valid || busy}
          onPress={onSave}
          style={({ pressed }) => [
            styles.saveBtn,
            {
              backgroundColor: valid ? colors.primary : colors.border,
              opacity: pressed ? 0.7 : 1,
              borderRadius: colors.radius,
            },
          ]}
        >
          <Text style={[styles.saveLabel, { color: colors.background }]}>
            {isEdit ? "Save changes" : "Create alert"}
          </Text>
        </Pressable>

        {isEdit ? (
          <Pressable
            disabled={busy}
            onPress={onDelete}
            style={({ pressed }) => ({
              alignItems: "center",
              paddingVertical: 12,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text style={{ color: colors.danger, fontFamily: "Inter_600SemiBold" }}>
              Delete this alert
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ScopeRow({
  label,
  hint,
  selected,
  onPress,
}: {
  label: string;
  hint: string;
  selected: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.scopeRow, { opacity: pressed ? 0.6 : 1 }]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.scopeLabel, { color: colors.foreground }]}>
          {label}
        </Text>
        <Text style={[styles.scopeHint, { color: colors.mutedForeground }]}>
          {hint}
        </Text>
      </View>
      {selected ? (
        <Feather name="check" size={18} color={colors.primary} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 16, gap: 18, paddingBottom: 40 },
  label: { fontSize: 10, letterSpacing: 1, fontFamily: "Inter_600SemiBold", marginBottom: 8 },
  ltvRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  ltvInput: {
    flex: 1,
    fontSize: 36,
    fontFamily: "Inter_700Bold",
    fontVariant: ["tabular-nums"],
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  ltvPct: { fontSize: 28, fontFamily: "Inter_700Bold" },
  textInput: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  scopeCard: { borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14 },
  scopeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
  },
  scopeLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  scopeHint: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  saveBtn: {
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  saveLabel: { fontSize: 15, fontFamily: "Inter_700Bold" },
});
