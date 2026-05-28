import { Feather } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { useCurrency } from "@/context/CurrencyContext";
import { useTargetLtv } from "@/context/RiskSettingsContext";
import { fmtMoney, fmtPct } from "@/utils/format";
import { headroomToTarget, statusFromLtv } from "@/utils/risk";
import type { Loan } from "@workspace/api-client-react";

interface Props {
  loan: Loan;
  accountName: string;
  onPress: () => void;
}

export function LoanRow({ loan, accountName, onPress }: Props) {
  const colors = useColors();
  const { currency } = useCurrency();
  const targetLtv = useTargetLtv();
  const status = statusFromLtv(loan.ltv, targetLtv);
  const tone =
    status === "ok"
      ? colors.ok
      : status === "warn"
        ? colors.warn
        : colors.danger;
  const headroom = headroomToTarget(loan, targetLtv);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.wrap,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View style={styles.row}>
        <View style={styles.left}>
          <Text style={[styles.asset, { color: colors.foreground }]}>
            {loan.collateral.asset}
            <Text style={[styles.account, { color: colors.mutedForeground }]}>
              {"  ·  "}
              {accountName}
            </Text>
          </Text>
          <Text style={[styles.debt, { color: colors.mutedForeground }]}>
            {fmtMoney(loan.debtUsd, currency, { compact: true })} debt ·{" "}
            {fmtMoney(loan.collateral.valueUsd, currency, { compact: true })}{" "}
            collateral
          </Text>
        </View>
        <View style={styles.right}>
          <Text style={[styles.ltv, { color: tone }]}>
            {fmtPct(loan.ltv, 1)}
          </Text>
          <Text style={[styles.apr, { color: colors.mutedForeground }]}>
            APR {fmtPct(loan.apr, 2)}
          </Text>
          <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
        </View>
      </View>
      <View
        style={[styles.barTrack, { backgroundColor: colors.border }]}
      >
        <View
          style={[
            styles.barFill,
            { backgroundColor: tone, width: `${Math.min(100, loan.ltv)}%` },
          ]}
        />
      </View>
      <Text style={[styles.hint, { color: colors.mutedForeground }]}>
        {headroom >= 0
          ? `+${fmtMoney(headroom, currency, { compact: true })} headroom to ${targetLtv}%`
          : `Over ${targetLtv}% by ${fmtMoney(-headroom, currency, { compact: true })}`}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  row: { flexDirection: "row", alignItems: "flex-start" },
  left: { flex: 1, gap: 4 },
  right: { flexDirection: "column", alignItems: "flex-end", gap: 0 },
  apr: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    fontVariant: ["tabular-nums"],
    marginTop: 2,
  },
  asset: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  account: { fontSize: 13, fontFamily: "Inter_400Regular" },
  debt: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    fontVariant: ["tabular-nums"],
  },
  ltv: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    fontVariant: ["tabular-nums"],
  },
  barTrack: { height: 4, borderRadius: 2, overflow: "hidden" },
  barFill: { height: "100%" },
  hint: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    fontVariant: ["tabular-nums"],
  },
});
