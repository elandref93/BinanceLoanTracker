import { Feather } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Container, useWideScreen } from "@/components/Container";
import { LeverageChart } from "@/components/LeverageChart";
import { useCurrency } from "@/context/CurrencyContext";
import { useSession } from "@/context/SessionContext";
import { useColors } from "@/hooks/useColors";
import { haptic } from "@/lib/haptics";
import {
  compute,
  DEFAULT_INPUTS,
  snapshotFromLoans,
  type LeverageInputs,
  type TaxMode,
} from "@/lib/leverageSim";
import {
  deleteScenario,
  saveScenario,
  useScenarios,
  type Scenario,
} from "@/lib/leverageScenarios";
import { fmtMoney, fmtPct, USD_TO_ZAR } from "@/utils/format";
import { useListLoans } from "@workspace/api-client-react";

// ─────────────────────────────────────────────────────────────────────────────
// Display helper: engine is ZAR-native; convert to the user's chosen display
// currency. We divide by USD_TO_ZAR because fmtMoney expects USD input.
// ─────────────────────────────────────────────────────────────────────────────
function fmtZ(zar: number, currency: "USD" | "ZAR"): string {
  if (!isFinite(zar)) return "—";
  return fmtMoney(zar / USD_TO_ZAR, currency, { compact: true });
}

export default function StrategyScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currency } = useCurrency();
  const { user } = useSession();
  const userId = user?.sub ?? null;
  const wide = useWideScreen();

  const [inputs, setInputs] = useState<LeverageInputs>(DEFAULT_INPUTS);
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);
  const [scenarioName, setScenarioName] = useState("");
  const [savingOpen, setSavingOpen] = useState(false);

  const loansQ = useListLoans();
  const livePosition = useMemo(
    () => snapshotFromLoans(loansQ.data?.loans),
    [loansQ.data],
  );

  const { scenarios, loading: scenariosLoading } = useScenarios(userId);

  const set = <K extends keyof LeverageInputs>(k: K, v: LeverageInputs[K]) =>
    setInputs((prev) => ({ ...prev, [k]: v }));

  const result = useMemo(() => compute(inputs), [inputs]);
  const {
    rowsA,
    rowsB,
    snapsA,
    snapsB,
    grossEffA,
    grossEffB,
    effectiveCGT,
    annualExcl,
    breakEvenBorrowPct,
    liquidationDropPct,
  } = result;

  const fA = rowsA[rowsA.length - 1];
  const fB = rowsB[rowsB.length - 1];
  const aNet = fA?.net ?? 0;
  const bNet = fB?.net ?? 0;
  const maxN = Math.max(aNet, bNet, 1);
  const winner = aNet >= bNet ? "A" : "B";
  const winColor = winner === "A" ? colors.primary : "#7c6aef";

  // Rate crossover year (where B's growth rate first overtakes A's)
  const rateCross = useMemo(() => {
    for (let i = 1; i < rowsA.length; i++) {
      if (
        rowsA[i].growthRate < rowsB[i].growthRate &&
        rowsA[i - 1].growthRate >= rowsB[i - 1].growthRate
      ) {
        return rowsA[i].year;
      }
    }
    return null;
  }, [rowsA, rowsB]);

  const applyLivePosition = () => {
    if (livePosition.collateralZar == null) {
      Alert.alert(
        "No BTC collateral",
        "Couldn't find any Binance loans backed by BTC. Connect a Binance account with an active BTC-collateralized loan to use this.",
      );
      return;
    }
    haptic.success();
    setInputs((prev) => ({
      ...prev,
      startingCapital: Math.round(livePosition.collateralZar ?? 0),
      borrowCost:
        livePosition.weightedAprPct != null
          ? Math.round(livePosition.weightedAprPct * 10) / 10
          : prev.borrowCost,
      ltv:
        livePosition.currentLtvPct != null
          ? Math.min(80, Math.max(10, Math.round(livePosition.currentLtvPct)))
          : prev.ltv,
    }));
  };

  const onSave = async () => {
    const name = scenarioName.trim() || `Scenario ${scenarios.length + 1}`;
    haptic.impact();
    const saved = await saveScenario(userId, {
      id: activeScenarioId ?? undefined,
      name,
      inputs,
    });
    setActiveScenarioId(saved.id);
    setScenarioName(saved.name);
    setSavingOpen(false);
  };

  const onLoad = (s: Scenario) => {
    haptic.tap();
    setInputs(s.inputs);
    setActiveScenarioId(s.id);
    setScenarioName(s.name);
  };

  const onDelete = (s: Scenario) => {
    Alert.alert("Delete scenario", `Remove "${s.name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          haptic.heavy();
          await deleteScenario(userId, s.id);
          if (activeScenarioId === s.id) {
            setActiveScenarioId(null);
            setScenarioName("");
          }
        },
      },
    ]);
  };

  const onNew = () => {
    haptic.tap();
    setInputs(DEFAULT_INPUTS);
    setActiveScenarioId(null);
    setScenarioName("");
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{
        paddingTop: insets.top + 12,
        paddingBottom: insets.bottom + 32,
        paddingHorizontal: 16,
      }}
    >
      <Container>
        {/* Header */}
        <View style={{ marginBottom: 16 }}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>
            STRATEGY SIMULATOR
          </Text>
          <Text style={[styles.h1, { color: colors.foreground }]}>
            BTC Lever + AMC vs Pure AMC
          </Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>
            Inputs in ZAR · results follow your display currency ({currency})
          </Text>
        </View>

        {/* Scenario bar */}
        <Card colors={colors}>
          <View
            style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
          >
            <Feather
              name="bookmark"
              size={14}
              color={colors.mutedForeground}
            />
            <Text
              style={{ flex: 1, color: colors.foreground, fontWeight: "600" }}
              numberOfLines={1}
            >
              {activeScenarioId ? scenarioName : "Unsaved scenario"}
            </Text>
            <SmallBtn label="New" onPress={onNew} colors={colors} />
            <SmallBtn
              label={activeScenarioId ? "Save" : "Save as…"}
              onPress={() => {
                if (activeScenarioId) void onSave();
                else {
                  setScenarioName(scenarioName || `Scenario ${scenarios.length + 1}`);
                  setSavingOpen(true);
                }
              }}
              colors={colors}
              primary
            />
          </View>
          {savingOpen ? (
            <View style={{ marginTop: 10, gap: 8 }}>
              <TextInput
                value={scenarioName}
                onChangeText={setScenarioName}
                placeholder="Scenario name"
                placeholderTextColor={colors.mutedForeground}
                style={[
                  styles.input,
                  {
                    color: colors.foreground,
                    borderColor: colors.border,
                    backgroundColor: colors.background,
                  },
                ]}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={onSave}
              />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <SmallBtn
                  label="Cancel"
                  onPress={() => setSavingOpen(false)}
                  colors={colors}
                />
                <SmallBtn
                  label="Save"
                  onPress={() => void onSave()}
                  colors={colors}
                  primary
                />
              </View>
            </View>
          ) : null}
          {!scenariosLoading && scenarios.length > 0 ? (
            <View style={{ marginTop: 12, gap: 6 }}>
              <SectionHead text="Saved" colors={colors} />
              {scenarios.map((s) => (
                <Pressable
                  key={s.id}
                  onPress={() => onLoad(s)}
                  onLongPress={() => onDelete(s)}
                  style={({ pressed }) => [
                    styles.scenarioRow,
                    {
                      borderColor: colors.border,
                      backgroundColor:
                        activeScenarioId === s.id
                          ? colors.primary + "14"
                          : "transparent",
                      opacity: pressed ? 0.6 : 1,
                    },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{ color: colors.foreground, fontWeight: "600" }}
                      numberOfLines={1}
                    >
                      {s.name}
                    </Text>
                    <Text
                      style={{ color: colors.mutedForeground, fontSize: 11 }}
                    >
                      {s.inputs.taxMode === "trust"
                        ? "Trust"
                        : s.inputs.taxMode === "taxfree"
                          ? "Tax-Free"
                          : "Personal"}{" "}
                      · {s.inputs.years}y · {fmtZ(s.inputs.monthlyContrib, currency)}/mo
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => onDelete(s)}
                    hitSlop={10}
                    style={{ padding: 4 }}
                  >
                    <Feather
                      name="trash-2"
                      size={14}
                      color={colors.mutedForeground}
                    />
                  </Pressable>
                </Pressable>
              ))}
            </View>
          ) : null}
        </Card>

        {/* THE FLOW */}
        <Card colors={colors}>
          <SectionHead text="The flow" colors={colors} tone="primary" />
          {[
            inputs.startingCapital > 0
              ? {
                  t: "Day 1",
                  d: `A: ${fmtZ(inputs.startingCapital, currency)} in BTC → borrow ${inputs.ltv}% (${fmtZ(inputs.startingCapital * (inputs.ltv / 100), currency)}) into AMC. B: ${fmtZ(inputs.startingCapital, currency)} straight into AMC.`,
                }
              : null,
            {
              t: "Monthly",
              d: `${fmtZ(inputs.monthlyContrib, currency)}/mo → BTC → borrow ${inputs.ltv}% → AMC${inputs.contribEscalation > 0 ? ` · +${inputs.contribEscalation}%/yr escalation` : ""}.`,
            },
            {
              t: "Annual sell",
              d:
                effectiveCGT > 0
                  ? `Sell all AMC → pay ${(effectiveCGT * 100).toFixed(0)}% CGT on gains → repay loans.`
                  : "Sell all AMC → no tax → repay loans → full profit reinvested.",
            },
            {
              t: "Re-gear",
              d: `Fresh loan = ${inputs.ltv}% of total BTC → redeploy profit + loan.`,
            },
            {
              t: "B (pure AMC)",
              d: `${fmtZ(inputs.monthlyContrib, currency)}/mo → AMC${effectiveCGT > 0 ? " · tax deferred to exit" : " · no tax"}.`,
            },
          ]
            .filter((x): x is { t: string; d: string } => Boolean(x))
            .map((step) => (
              <View key={step.t} style={styles.flowRow}>
                <Text
                  style={{
                    fontSize: 10,
                    fontWeight: "700",
                    color: colors.primary,
                    letterSpacing: 1,
                  }}
                >
                  {step.t.toUpperCase()}
                </Text>
                <Text
                  style={{
                    fontSize: 12,
                    color: colors.foreground,
                    lineHeight: 17,
                  }}
                >
                  {step.d}
                </Text>
              </View>
            ))}
        </Card>

        {/* TAX ENTITY */}
        <Card colors={colors}>
          <SectionHead text="Tax entity" colors={colors} />
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
            {(
              [
                { id: "personal", label: "Personal (18%)" },
                { id: "trust", label: "Trust (36%)" },
                { id: "taxfree", label: "Tax-Free (0%)" },
              ] as const
            ).map((t) => (
              <Pressable
                key={t.id}
                onPress={() => {
                  haptic.tap();
                  set("taxMode", t.id as TaxMode);
                }}
                style={[
                  styles.tog,
                  {
                    backgroundColor:
                      inputs.taxMode === t.id ? colors.primary : colors.card,
                    borderColor:
                      inputs.taxMode === t.id ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: "700",
                    color:
                      inputs.taxMode === t.id
                        ? colors.background
                        : colors.mutedForeground,
                  }}
                >
                  {t.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <MiniStat
              label="Inclusion"
              value={
                inputs.taxMode === "trust"
                  ? "80%"
                  : inputs.taxMode === "taxfree"
                    ? "0%"
                    : "40%"
              }
              colors={colors}
            />
            <MiniStat
              label="Effective CGT"
              value={`${(effectiveCGT * 100).toFixed(0)}%`}
              colors={colors}
              tone="danger"
            />
            <MiniStat
              label="Annual excl"
              value={annualExcl > 0 ? "R40k" : "—"}
              colors={colors}
            />
          </View>
        </Card>

        {/* INPUTS */}
        <Card colors={colors}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <SectionHead text="Inputs" colors={colors} noMargin />
            <View style={{ flex: 1 }} />
            <SmallBtn
              label={
                livePosition.collateralZar != null
                  ? `Use current (${fmtZ(livePosition.collateralZar, currency)})`
                  : "Use current"
              }
              onPress={applyLivePosition}
              colors={colors}
              icon="link"
            />
          </View>
          <NumRow
            label="BTC annual growth"
            value={inputs.btcGrowth}
            onChange={(v) => set("btcGrowth", clamp(v, 0, 200))}
            suffix="%"
            step={1}
            colors={colors}
          />
          <NumRow
            label="Options / AMC return"
            value={inputs.optionsReturn}
            onChange={(v) => set("optionsReturn", clamp(v, 0, 200))}
            suffix="%"
            step={1}
            colors={colors}
          />
          <NumRow
            label="Loan-to-value"
            value={inputs.ltv}
            onChange={(v) => set("ltv", clamp(v, 10, 80))}
            suffix="%"
            step={5}
            colors={colors}
          />
          <NumRow
            label="Borrow cost"
            value={inputs.borrowCost}
            onChange={(v) => set("borrowCost", clamp(v, 0, 100))}
            suffix="%"
            step={0.5}
            colors={colors}
          />
          <NumRow
            label="Starting capital (BTC)"
            value={inputs.startingCapital}
            onChange={(v) => set("startingCapital", Math.max(0, v))}
            prefix="R"
            step={100_000}
            money
            colors={colors}
          />
          <NumRow
            label="Monthly contribution"
            value={inputs.monthlyContrib}
            onChange={(v) => set("monthlyContrib", Math.max(0, v))}
            prefix="R"
            step={50_000}
            money
            colors={colors}
          />
          <NumRow
            label="Annual escalation"
            value={inputs.contribEscalation}
            onChange={(v) => set("contribEscalation", clamp(v, 0, 100))}
            suffix="%"
            step={1}
            colors={colors}
          />
          <NumRow
            label="Horizon"
            value={inputs.years}
            onChange={(v) => set("years", clamp(Math.round(v), 1, 20))}
            suffix=" yrs"
            step={1}
            colors={colors}
          />
        </Card>

        {/* EXIT VALUE */}
        <Card colors={colors}>
          <SectionHead text="Exit value (net of all tax)" colors={colors} />
          {[
            { label: "A: BTC + Lever", value: aNet, color: colors.primary },
            { label: "B: Pure AMC", value: bNet, color: "#7c6aef" },
          ].map((s) => (
            <View key={s.label} style={{ marginBottom: 12 }}>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  marginBottom: 4,
                }}
              >
                <Text style={{ color: s.color, fontWeight: "700" }}>
                  {s.label}
                </Text>
                <Text
                  style={{
                    color: s.color,
                    fontSize: 16,
                    fontWeight: "700",
                  }}
                >
                  {fmtZ(s.value, currency)}
                </Text>
              </View>
              <View
                style={[
                  styles.bar,
                  { backgroundColor: s.color + "22" },
                ]}
              >
                <View
                  style={{
                    height: "100%",
                    width: `${Math.min((s.value / maxN) * 100, 100)}%`,
                    backgroundColor: s.color,
                    borderRadius: 5,
                  }}
                />
              </View>
            </View>
          ))}
          <View
            style={[
              styles.winnerBox,
              { backgroundColor: winColor + "14", borderColor: winColor + "44" },
            ]}
          >
            <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
              {winner} wins by
            </Text>
            <Text style={{ color: winColor, fontWeight: "700", fontSize: 14 }}>
              {fmtZ(Math.abs(aNet - bNet), currency)}
            </Text>
          </View>
          <View style={{ flexDirection: "row", gap: 6, marginTop: 10 }}>
            <MiniStat
              label="Contributed"
              value={fmtZ(fA?.contributed ?? 0, currency)}
              colors={colors}
            />
            <MiniStat
              label="A multiple"
              value={`${(aNet / Math.max(1, fA?.contributed ?? 1)).toFixed(1)}×`}
              colors={colors}
              tone="primary"
            />
            <MiniStat
              label="B multiple"
              value={`${(bNet / Math.max(1, fB?.contributed ?? 1)).toFixed(1)}×`}
              colors={colors}
              tone="purple"
            />
          </View>
        </Card>

        {/* KEY RATES — break-even + liquidation */}
        <Card colors={colors}>
          <SectionHead text="Key rates" colors={colors} />
          <View style={{ flexDirection: wide ? "row" : "column", gap: 8 }}>
            <RateBox
              label="A gross"
              value={`${grossEffA.toFixed(1)}%`}
              hint={
                effectiveCGT > 0
                  ? `Pays ${(effectiveCGT * 100).toFixed(0)}% CGT yearly`
                  : "No tax drag"
              }
              color={colors.primary}
              colors={colors}
            />
            <RateBox
              label="B gross"
              value={`${grossEffB.toFixed(1)}%`}
              hint={effectiveCGT > 0 ? "Tax deferred to exit" : "No tax"}
              color="#7c6aef"
              colors={colors}
            />
          </View>
          <View
            style={{
              flexDirection: wide ? "row" : "column",
              gap: 8,
              marginTop: 8,
            }}
          >
            <RateBox
              label="Break-even borrow"
              value={
                isFinite(breakEvenBorrowPct)
                  ? `${breakEvenBorrowPct.toFixed(1)}%`
                  : "—"
              }
              hint={
                inputs.borrowCost < breakEvenBorrowPct
                  ? `Headroom: ${(breakEvenBorrowPct - inputs.borrowCost).toFixed(1)}pp`
                  : "Above break-even — leverage hurts"
              }
              color={
                inputs.borrowCost < breakEvenBorrowPct
                  ? colors.ok ?? colors.primary
                  : colors.danger
              }
              colors={colors}
            />
            <RateBox
              label="BTC drop to liq."
              value={
                liquidationDropPct > 0
                  ? `−${liquidationDropPct.toFixed(0)}%`
                  : "—"
              }
              hint={`Liquidation at 80% LTV (current ${inputs.ltv}%)`}
              color={
                liquidationDropPct > 30
                  ? colors.ok ?? colors.primary
                  : liquidationDropPct > 15
                    ? colors.warn ?? "#f59e0b"
                    : colors.danger
              }
              colors={colors}
            />
          </View>
        </Card>

        {/* CHART */}
        <Card colors={colors}>
          <SectionHead text="Net value over time" colors={colors} />
          <ChartArea
            snapsA={snapsA}
            snapsB={snapsB}
            years={inputs.years}
            currency={currency}
            colors={colors}
          />
          {rateCross != null ? (
            <Text
              style={{
                marginTop: 10,
                color: "#f59e0b",
                fontSize: 11,
                lineHeight: 16,
              }}
            >
              ⚠ B&apos;s growth rate overtakes A from year {rateCross}. The{" "}
              {(effectiveCGT * 100).toFixed(0)}% annual tax drags A&apos;s
              compounding down — B defers all tax and compounds on gross.
            </Text>
          ) : (
            <Text
              style={{
                marginTop: 10,
                color: colors.ok ?? colors.primary,
                fontSize: 11,
                lineHeight: 16,
              }}
            >
              ✓ A&apos;s growth rate stays ahead of B across the full horizon.
            </Text>
          )}
        </Card>

        {/* YEAR TABLE */}
        <Card colors={colors}>
          <SectionHead text="Year by year" colors={colors} />
          <View style={styles.tableHead}>
            <ColH text="YR" colors={colors} flex={0.5} align="left" />
            <ColH text="A NET" colors={colors} color={colors.primary} />
            <ColH text="B NET" colors={colors} color="#7c6aef" />
            <ColH text="A TAX" colors={colors} color={colors.danger} />
            <ColH text="Δ" colors={colors} />
          </View>
          {rowsA.map((rA, i) => {
            const rB = rowsB[i];
            const d = rA.net - rB.net;
            return (
              <View
                key={rA.year}
                style={[
                  styles.tableRow,
                  { borderBottomColor: colors.border },
                ]}
              >
                <ColC
                  text={String(rA.year)}
                  colors={colors}
                  flex={0.5}
                  align="left"
                />
                <ColC
                  text={fmtZ(rA.net, currency)}
                  colors={colors}
                  color={colors.primary}
                />
                <ColC
                  text={fmtZ(rB.net, currency)}
                  colors={colors}
                  color="#7c6aef"
                />
                <ColC
                  text={fmtZ(rA.amcTax, currency)}
                  colors={colors}
                  color={colors.danger}
                />
                <ColC
                  text={`${d >= 0 ? "+" : ""}${fmtZ(d, currency)}`}
                  colors={colors}
                  color={d >= 0 ? colors.primary : colors.danger}
                />
              </View>
            );
          })}
        </Card>

        {/* DISCLAIMER */}
        <View
          style={[
            styles.disclaimer,
            { backgroundColor: "#f59e0b14", borderColor: "#f59e0b33" },
          ]}
        >
          <Text style={{ fontSize: 10, color: colors.mutedForeground, lineHeight: 15 }}>
            ⚠️ Planning tool, not advice. Does not model BTC volatility,
            liquidation cascades, AMC fees, forex, or Section 7C. Tax math
            assumes SA CGT rules (40% personal / 80% trust inclusion at 45%
            marginal). Display currency converts at R{USD_TO_ZAR}/USD.
          </Text>
        </View>
      </Container>
    </ScrollView>
  );
}

// ─── helpers / sub-components ───────────────────────────────────────────────

function clamp(n: number, min: number, max: number): number {
  if (!isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function Card({
  children,
  colors,
}: {
  children: React.ReactNode;
  colors: ReturnType<typeof useColors>;
}) {
  return (
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
  );
}

function SectionHead({
  text,
  colors,
  tone,
  noMargin,
}: {
  text: string;
  colors: ReturnType<typeof useColors>;
  tone?: "primary";
  noMargin?: boolean;
}) {
  return (
    <Text
      style={{
        fontSize: 10,
        fontWeight: "700",
        letterSpacing: 1,
        color: tone === "primary" ? colors.primary : colors.mutedForeground,
        marginBottom: noMargin ? 0 : 12,
      }}
    >
      {text.toUpperCase()}
    </Text>
  );
}

function MiniStat({
  label,
  value,
  colors,
  tone,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useColors>;
  tone?: "primary" | "danger" | "purple";
}) {
  const c =
    tone === "primary"
      ? colors.primary
      : tone === "danger"
        ? colors.danger
        : tone === "purple"
          ? "#7c6aef"
          : colors.foreground;
  return (
    <View
      style={[
        styles.miniStat,
        { backgroundColor: colors.background, borderColor: colors.border },
      ]}
    >
      <Text style={{ fontSize: 9, color: colors.mutedForeground }}>
        {label.toUpperCase()}
      </Text>
      <Text style={{ fontSize: 15, fontWeight: "700", color: c, marginTop: 2 }}>
        {value}
      </Text>
    </View>
  );
}

function RateBox({
  label,
  value,
  hint,
  color,
  colors,
}: {
  label: string;
  value: string;
  hint: string;
  color: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View
      style={{
        flex: 1,
        padding: 12,
        borderRadius: 10,
        backgroundColor: color + "10",
        borderWidth: 1,
        borderColor: color + "26",
      }}
    >
      <Text style={{ fontSize: 10, fontWeight: "700", color, letterSpacing: 1 }}>
        {label.toUpperCase()}
      </Text>
      <Text style={{ fontSize: 22, fontWeight: "700", color, marginTop: 2 }}>
        {value}
      </Text>
      <Text
        style={{
          fontSize: 10,
          color: colors.mutedForeground,
          marginTop: 4,
        }}
      >
        {hint}
      </Text>
    </View>
  );
}

function SmallBtn({
  label,
  onPress,
  colors,
  primary,
  icon,
}: {
  label: string;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
  primary?: boolean;
  icon?: React.ComponentProps<typeof Feather>["name"];
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.smallBtn,
        {
          backgroundColor: primary ? colors.primary : colors.background,
          borderColor: primary ? colors.primary : colors.border,
          opacity: pressed ? 0.6 : 1,
        },
      ]}
    >
      {icon ? (
        <Feather
          name={icon}
          size={12}
          color={primary ? colors.background : colors.mutedForeground}
          style={{ marginRight: 4 }}
        />
      ) : null}
      <Text
        style={{
          fontSize: 11,
          fontWeight: "700",
          color: primary ? colors.background : colors.foreground,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function NumRow({
  label,
  value,
  onChange,
  suffix,
  prefix,
  step,
  money,
  colors,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  prefix?: string;
  step: number;
  money?: boolean;
  colors: ReturnType<typeof useColors>;
}) {
  const [draft, setDraft] = useState<string>(String(value));
  // Keep draft in sync when parent value changes (e.g. via "Use current").
  useEffect(() => {
    setDraft(money ? String(Math.round(value)) : String(value));
  }, [value, money]);

  const commit = (raw: string) => {
    const cleaned = raw.replace(/[^0-9.\-]/g, "");
    const n = parseFloat(cleaned);
    if (!isNaN(n)) onChange(n);
    else setDraft(String(value));
  };

  return (
    <View style={{ marginBottom: 14 }}>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 6,
        }}
      >
        <Text style={{ fontSize: 11, fontWeight: "700", color: colors.mutedForeground, letterSpacing: 0.6 }}>
          {label.toUpperCase()}
        </Text>
        <Text style={{ fontSize: 13, color: colors.foreground }}>
          {prefix ?? ""}
          {money
            ? Math.round(value).toLocaleString("en-ZA")
            : value}
          {suffix ?? ""}
        </Text>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable
          onPress={() => {
            haptic.tap();
            onChange(value - step);
          }}
          style={[styles.stepBtn, { borderColor: colors.border, backgroundColor: colors.background }]}
        >
          <Feather name="minus" size={14} color={colors.foreground} />
        </Pressable>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onBlur={() => commit(draft)}
          onSubmitEditing={() => commit(draft)}
          keyboardType="numeric"
          returnKeyType="done"
          style={[
            styles.input,
            { flex: 1, textAlign: "center", color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background },
          ]}
        />
        <Pressable
          onPress={() => {
            haptic.tap();
            onChange(value + step);
          }}
          style={[styles.stepBtn, { borderColor: colors.border, backgroundColor: colors.background }]}
        >
          <Feather name="plus" size={14} color={colors.foreground} />
        </Pressable>
      </View>
    </View>
  );
}

function ChartArea({
  snapsA,
  snapsB,
  years,
  currency,
  colors,
}: {
  snapsA: ReturnType<typeof compute>["snapsA"];
  snapsB: ReturnType<typeof compute>["snapsB"];
  years: number;
  currency: "USD" | "ZAR";
  colors: ReturnType<typeof useColors>;
}) {
  const [w, setW] = useState(0);
  const cMax = Math.max(
    ...snapsA.map((s) => s.net),
    ...snapsB.map((s) => s.net),
    1,
  );
  return (
    <View>
      <View
        style={{ flexDirection: "row", gap: 8, marginBottom: 6 }}
      >
        <LegendDot color={colors.primary} label="A: BTC + Lever" colors={colors} />
        <LegendDot color="#7c6aef" label="B: Pure AMC" colors={colors} />
      </View>
      <View
        onLayout={(e) => setW(e.nativeEvent.layout.width)}
        style={{ width: "100%" }}
      >
        {w > 0 ? (
          <LeverageChart
            snapsA={snapsA}
            snapsB={snapsB}
            width={w}
            height={180}
            years={years}
          />
        ) : null}
      </View>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          marginTop: 6,
        }}
      >
        <Text style={{ fontSize: 9, color: colors.mutedForeground }}>Y0</Text>
        <Text style={{ fontSize: 9, color: colors.mutedForeground }}>
          {fmtZ(cMax / 2, currency)}
        </Text>
        <Text style={{ fontSize: 9, color: colors.mutedForeground }}>
          Y{years} · {fmtZ(cMax, currency)}
        </Text>
      </View>
    </View>
  );
}

function LegendDot({
  color,
  label,
  colors,
}: {
  color: string;
  label: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: color,
        }}
      />
      <Text style={{ fontSize: 10, color: colors.mutedForeground }}>
        {label}
      </Text>
    </View>
  );
}

function ColH({
  text,
  colors,
  color,
  flex,
  align,
}: {
  text: string;
  colors: ReturnType<typeof useColors>;
  color?: string;
  flex?: number;
  align?: "left" | "right";
}) {
  return (
    <Text
      style={{
        flex: flex ?? 1,
        fontSize: 9,
        fontWeight: "700",
        letterSpacing: 0.6,
        color: color ?? colors.mutedForeground,
        textAlign: align ?? "right",
      }}
    >
      {text}
    </Text>
  );
}

function ColC({
  text,
  colors,
  color,
  flex,
  align,
}: {
  text: string;
  colors: ReturnType<typeof useColors>;
  color?: string;
  flex?: number;
  align?: "left" | "right";
}) {
  return (
    <Text
      style={{
        flex: flex ?? 1,
        fontSize: 11,
        color: color ?? colors.foreground,
        textAlign: align ?? "right",
      }}
      numberOfLines={1}
    >
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  eyebrow: { fontSize: 10, fontWeight: "700", letterSpacing: 2, marginBottom: 4 },
  h1: { fontSize: 22, fontWeight: "700", lineHeight: 26 },
  sub: { fontSize: 12, marginTop: 4 },
  card: { padding: 16, marginBottom: 12, borderWidth: 1 },
  tog: { flex: 1, paddingVertical: 8, paddingHorizontal: 6, borderRadius: 8, borderWidth: 1, alignItems: "center" },
  flowRow: { paddingVertical: 7, gap: 2 },
  miniStat: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
  },
  bar: { height: 10, borderRadius: 5, overflow: "hidden" },
  winnerBox: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 6,
  },
  scenarioRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: 8,
    gap: 6,
  },
  smallBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
  },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  tableHead: {
    flexDirection: "row",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.1)",
    gap: 6,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  disclaimer: { padding: 12, borderRadius: 10, borderWidth: 1, marginTop: 4 },
});
