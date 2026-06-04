import { Feather } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { haptic } from "@/lib/haptics";
import { fmtMoney, fmtPct, fmtQty } from "@/utils/format";
import {
  aggLtvWithExtraCollateral,
  collateralQtyForUsd,
  LIQ_LTV,
  liqPriceWithExtraCollateral,
  priceAtLtv,
  priceDropPctTo,
  priceDropPctWithExtraCollateral,
  statusFromLtv,
  type Status,
} from "@/utils/risk";

import type { Loan } from "@workspace/api-client-react";

interface Props {
  visible: boolean;
  onClose: () => void;
  currency: "USD" | "ZAR";
  usdToZar: number;
  totalDebtUsd: number;
  totalColUsd: number;
  currentAggLtv: number;
  activeTarget: number | null;
  /** USD needed to bring the book down to target — used for a quick-fill chip. */
  shortfallUsd: number;
  /** The loan closest to liquidation; the new liq price is shown for this one. */
  closest: Loan | null;
  closestAccountName: string | null;
}

export function CollateralSimModal({
  visible,
  onClose,
  currency,
  usdToZar,
  totalDebtUsd,
  totalColUsd,
  currentAggLtv,
  activeTarget,
  shortfallUsd,
  closest,
  closestAccountName,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState("");

  const symbol = currency === "ZAR" ? "R" : "$";

  // The amount is entered in the displayed currency; convert to USD for the
  // risk math, which is all USD-denominated.
  const addedUsd = useMemo(() => {
    const n = parseFloat(draft.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(n) || n <= 0) return 0;
    return currency === "ZAR" ? n / usdToZar : n;
  }, [draft, currency, usdToZar]);

  const hasAmount = addedUsd > 0;

  const toneColor = (s: Status) =>
    s === "ok" ? colors.ok : s === "warn" ? colors.warn : colors.danger;

  const newAggLtv = aggLtvWithExtraCollateral(
    totalDebtUsd,
    totalColUsd,
    addedUsd,
  );
  const target = activeTarget ?? undefined;
  const newStatusColor = toneColor(statusFromLtv(newAggLtv, target));

  const boughtQty = closest ? collateralQtyForUsd(closest, addedUsd) : 0;
  const curLiq = closest ? priceAtLtv(closest, LIQ_LTV) : 0;
  const newLiq = closest ? liqPriceWithExtraCollateral(closest, addedUsd) : 0;
  const curDrop = closest ? priceDropPctTo(closest, LIQ_LTV) : 0;
  const newDrop = closest
    ? priceDropPctWithExtraCollateral(closest, addedUsd)
    : 0;

  const fillShortfall = () => {
    if (shortfallUsd <= 0) return;
    haptic.tap();
    const display = currency === "ZAR" ? shortfallUsd * usdToZar : shortfallUsd;
    setDraft(String(Math.ceil(display)));
  };

  const close = () => {
    setDraft("");
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={close}
      transparent={false}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, backgroundColor: colors.background }}
      >
        <View
          style={{
            flex: 1,
            paddingTop: insets.top + 8,
            paddingHorizontal: 16,
            paddingBottom: insets.bottom + 8,
          }}
        >
          <View style={styles.head}>
            <Text style={[styles.title, { color: colors.foreground }]}>
              Simulate adding collateral
            </Text>
            <Pressable
              onPress={close}
              hitSlop={12}
              style={({ pressed }) => [
                styles.closeBtn,
                { borderColor: colors.border, opacity: pressed ? 0.55 : 1 },
              ]}
            >
              <Feather name="x" size={18} color={colors.foreground} />
            </Pressable>
          </View>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Enter how much extra you'd add. We'll buy that much more collateral
            at the current price and show your new LTV and liquidation price.
          </Text>

          <ScrollView
            style={{ flex: 1 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View
              style={[
                styles.inputWrap,
                {
                  borderColor: colors.border,
                  backgroundColor: colors.card,
                  borderRadius: colors.radius,
                },
              ]}
            >
              <Text style={[styles.symbol, { color: colors.mutedForeground }]}>
                {symbol}
              </Text>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                keyboardType="decimal-pad"
                returnKeyType="done"
                placeholder="0"
                placeholderTextColor={colors.mutedForeground}
                style={[styles.input, { color: colors.foreground }]}
                autoFocus
              />
            </View>

            {shortfallUsd > 0 ? (
              <Pressable
                onPress={fillShortfall}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.card,
                    borderRadius: colors.radius,
                    opacity: pressed ? 0.6 : 1,
                  },
                ]}
              >
                <Feather name="zap" size={13} color={colors.warn} />
                <Text style={[styles.chipText, { color: colors.foreground }]}>
                  Cover shortfall (
                  {fmtMoney(shortfallUsd, currency, { whole: true })})
                </Text>
              </Pressable>
            ) : null}

            {hasAmount ? (
              <>
                <View
                  style={[
                    styles.card,
                    {
                      borderColor: colors.border,
                      backgroundColor: colors.card,
                      borderRadius: colors.radius,
                    },
                  ]}
                >
                  <Text
                    style={[styles.cardLabel, { color: colors.mutedForeground }]}
                  >
                    NEW AGGREGATE LTV
                  </Text>
                  <View style={styles.bigRow}>
                    <Text
                      style={[styles.big, { color: colors.mutedForeground }]}
                    >
                      {fmtPct(currentAggLtv)}
                    </Text>
                    <Feather
                      name="arrow-right"
                      size={18}
                      color={colors.mutedForeground}
                    />
                    <Text style={[styles.big, { color: newStatusColor }]}>
                      {fmtPct(newAggLtv)}
                    </Text>
                  </View>
                  {activeTarget != null ? (
                    <Text
                      style={[styles.cardHint, { color: colors.mutedForeground }]}
                    >
                      target {activeTarget}%
                    </Text>
                  ) : null}
                </View>

                {closest ? (
                  <View
                    style={[
                      styles.card,
                      {
                        borderColor: colors.border,
                        backgroundColor: colors.card,
                        borderRadius: colors.radius,
                      },
                    ]}
                  >
                    <View style={styles.cardHead}>
                      <Text
                        style={[
                          styles.cardLabel,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        IF ADDED TO {closest.collateral.asset}
                      </Text>
                      {closestAccountName ? (
                        <Text
                          style={[
                            styles.cardAccount,
                            { color: colors.mutedForeground },
                          ]}
                        >
                          {closestAccountName}
                        </Text>
                      ) : null}
                    </View>

                    <Row
                      label="Buys about"
                      before=""
                      after={fmtQty(boughtQty, closest.collateral.asset)}
                      colors={colors}
                      single
                    />
                    <Row
                      label="Liquidation price"
                      before={fmtMoney(curLiq, currency)}
                      after={fmtMoney(newLiq, currency)}
                      afterColor={colors.foreground}
                      colors={colors}
                    />
                    <Row
                      label="Price drop until liquidation"
                      before={fmtPct(curDrop)}
                      after={fmtPct(newDrop)}
                      afterColor={colors.ok}
                      colors={colors}
                    />
                  </View>
                ) : null}

                <Text style={[styles.disclaimer, { color: colors.mutedForeground }]}>
                  Estimate only — assumes the funds buy more {closest?.collateral.asset ?? "collateral"} at
                  the current price and adds it to the loan above. It doesn't
                  place any orders.
                </Text>
              </>
            ) : (
              <Text style={[styles.placeholder, { color: colors.mutedForeground }]}>
                Enter an amount to see the impact.
              </Text>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Row({
  label,
  before,
  after,
  afterColor,
  colors,
  single,
}: {
  label: string;
  before: string;
  after: string;
  afterColor?: string;
  colors: ReturnType<typeof useColors>;
  single?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
      <View style={styles.rowVals}>
        {single ? null : (
          <>
            <Text style={[styles.rowBefore, { color: colors.mutedForeground }]}>
              {before}
            </Text>
            <Feather
              name="arrow-right"
              size={12}
              color={colors.mutedForeground}
            />
          </>
        )}
        <Text
          style={[styles.rowAfter, { color: afterColor ?? colors.foreground }]}
        >
          {after}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  title: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  subtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
    marginBottom: 16,
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    height: 64,
    gap: 8,
  },
  symbol: { fontSize: 28, fontFamily: "Inter_600SemiBold" },
  input: {
    flex: 1,
    fontSize: 30,
    fontFamily: "Inter_600SemiBold",
    fontVariant: ["tabular-nums"],
    padding: 0,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 12,
  },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    marginTop: 14,
    gap: 6,
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 1 },
  cardAccount: { fontSize: 11, fontFamily: "Inter_400Regular" },
  bigRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  big: {
    fontSize: 30,
    fontFamily: "Inter_600SemiBold",
    fontVariant: ["tabular-nums"],
  },
  cardHint: { fontSize: 11, fontFamily: "Inter_400Regular" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 10,
  },
  rowLabel: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular" },
  rowVals: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowBefore: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    fontVariant: ["tabular-nums"],
  },
  rowAfter: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    fontVariant: ["tabular-nums"],
  },
  disclaimer: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    lineHeight: 16,
    marginTop: 16,
  },
  placeholder: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginTop: 24,
    textAlign: "center",
  },
});
