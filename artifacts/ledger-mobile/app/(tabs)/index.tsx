import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LoanDetailView } from "@/app/loan/[id]";

import { checkAndNotifyLoans } from "@/lib/alerts";
import { haptic } from "@/lib/haptics";
import {
  cacheAgeLabel,
  readAccountsCache,
  readLoanCache,
  writeAccountsCache,
  writeLoanCache,
} from "@/lib/loanCache";
import { recordLtvSample } from "@/lib/ltvHistory";
import { recordLoanSnapshots } from "@/lib/loanSnapshots";
import {
  fetchLtvSnapshot,
  type ServerLtvSnapshot,
} from "@/lib/serverCredentials";
import {
  buildMarketQuotes,
  buildSnapshot,
  weightedApr,
  widgetMarketPairs,
  writeWidgetSnapshot,
} from "@/lib/widgetSnapshot";
import { AccountChip } from "@/components/AccountChip";
import { CollateralSimModal } from "@/components/CollateralSimModal";
import { Container, Grid, WIDE_CONTENT_WIDTH } from "@/components/Container";
import { ErrorView } from "@/components/ErrorView";
import { LoanRow } from "@/components/LoanRow";
import { LtvHistoryChart } from "@/components/LtvHistoryChart";
import { Pill } from "@/components/Pill";
import { ScreenSkeleton } from "@/components/Skeleton";
import { Tile } from "@/components/Tile";
import { useCurrency } from "@/context/CurrencyContext";
import { useRiskSettings } from "@/context/RiskSettingsContext";
import { useColors } from "@/hooks/useColors";
import { fmtDisplayMoney, fmtMoney, fmtPct } from "@/utils/format";
import {
  headroomToTarget,
  LIQ_LTV,
  priceAtLtv,
  priceDropPctTo,
  statusFromLtv,
  statusLabel,
} from "@/utils/risk";

import {
  useListAccounts,
  useListLoans,
  useListLunoWallets,
  useGetLunoTickers,
  type Loan,
  type Account,
} from "@workspace/api-client-react";

import { pairsForAssets, quoteWalletInFiat } from "@/lib/lunoPricing";

// Below this width the dashboard keeps the single-column, push-to-detail phone
// layout. At/above it (iPad and large windows) it switches to a two-pane
// master–detail: summary + loan list on the left, the selected loan on the
// right. Tuned so the list (≈360) + a usable detail pane both fit.
const MASTER_DETAIL_MIN_WIDTH = 900;
const MASTER_DETAIL_MAX_WIDTH = 1240;

export default function DashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { currency, usdToZar, toggle } = useCurrency();
  const { targetLtv, containers, targetForContainer, refreshContainers } =
    useRiskSettings();
  // `filter` is the selected Personal/Trust container id, or null for the
  // combined "All" view across every account.
  const [filter, setFilter] = useState<string | null>(null);
  const [simOpen, setSimOpen] = useState(false);
  // Selected loan for the iPad master–detail pane (null = fall back to the
  // closest-to-liquidation loan).
  const [selectedLoanId, setSelectedLoanId] = useState<string | null>(null);
  const { width: windowWidth } = useWindowDimensions();
  const masterDetail = windowWidth >= MASTER_DETAIL_MIN_WIDTH;

  const accountsQ = useListAccounts();
  const loansQ = useListLoans();

  // Offline cache: hydrate from AsyncStorage on first mount so the screen
  // can render last-known-good data while the network call is in flight or
  // failing. Keeps the dashboard usable on flaky connections / when Azure
  // is down.
  const [cachedLoans, setCachedLoans] = useState<Loan[] | null>(null);
  const [cachedAccounts, setCachedAccounts] = useState<Account[] | null>(
    null,
  );
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      const [loanCache, acctCache] = await Promise.all([
        readLoanCache(),
        readAccountsCache(),
      ]);
      if (loanCache) {
        setCachedLoans(loanCache.loans);
        setCachedAt(loanCache.cachedAt);
      }
      if (acctCache) setCachedAccounts(acctCache.accounts);
    })();
  }, []);

  // Server snapshot: the scheduler precomputes aggregate LTV/debt/collateral
  // even while the app is closed. Pull it once on launch so a freshly signed-in
  // device (no local cache yet) shows real numbers instantly instead of a
  // skeleton; the live loans query then takes over and supersedes it.
  const [snapshot, setSnapshot] = useState<ServerLtvSnapshot | null>(null);
  useEffect(() => {
    void fetchLtvSnapshot().then((s) => {
      if (s) setSnapshot(s);
    });
  }, []);

  // Persist on every successful fetch.
  useEffect(() => {
    if (loansQ.data?.loans) void writeLoanCache(loansQ.data.loans);
  }, [loansQ.data]);
  useEffect(() => {
    if (accountsQ.data?.accounts) {
      void writeAccountsCache(accountsQ.data.accounts);
    }
  }, [accountsQ.data]);

  const accounts =
    accountsQ.data?.accounts ?? cachedAccounts ?? [];
  const all = loansQ.data?.loans ?? cachedLoans ?? [];

  // Map each loan to its Personal/Trust container via the exchange-link id.
  const linkToContainer = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of containers) {
      for (const l of c.links) m.set(l.id, c.id);
    }
    return m;
  }, [containers]);

  // When a container is selected, show only its loans (across whichever of
  // its Binance/Luno links carry debt).
  const loans = filter
    ? all.filter((l) => linkToContainer.get(l.accountId) === filter)
    : all;
  const showingCached =
    !loansQ.data &&
    cachedLoans != null &&
    (loansQ.isError || loansQ.isLoading);

  // Live Luno price for every borrowed asset, so each loan tile can show the
  // current market value of the debt (e.g. USDC at today's Luno rate) with a
  // Luno badge. Fetched once for all loans, then handed to each LoanRow.
  const borrowPairs = useMemo(
    () => pairsForAssets(all.map((l) => l.asset), currency),
    [all, currency],
  );
  const widgetPairs = useMemo(() => {
    const set = new Set([...borrowPairs, ...widgetMarketPairs(all)]);
    return Array.from(set);
  }, [borrowPairs, all]);
  const loanTickersQ = useGetLunoTickers(
    { pairs: widgetPairs.join(",") },
    { query: { enabled: widgetPairs.length > 0 } as never },
  );
  const loanTickerMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of loanTickersQ.data?.tickers ?? []) {
      m.set(t.pair, t.lastTrade);
    }
    return m;
  }, [loanTickersQ.data]);

  // Per-account (container) LTV for the selector chips.
  const containerLtv = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of containers) {
      const ids = new Set(c.links.map((l) => l.id));
      const ls = all.filter((l) => ids.has(l.accountId));
      const debt = ls.reduce((s, l) => s + l.debtUsd, 0);
      const col = ls.reduce((s, l) => s + l.collateral.valueUsd, 0);
      m.set(c.id, col > 0 ? (debt / col) * 100 : 0);
    }
    return m;
  }, [containers, all]);

  const totalDebtUsd = loans.reduce((s, l) => s + l.debtUsd, 0);
  const totalColUsd = loans.reduce((s, l) => s + l.collateral.valueUsd, 0);
  const aggLtv = totalColUsd > 0 ? (totalDebtUsd / totalColUsd) * 100 : 0;
  // Targets only apply to a single selected account; the combined "All" view
  // has no single target, so we suppress the target line / status there.
  const activeTarget = filter ? targetForContainer(filter) : null;

  // Use the server snapshot as an instant fallback for the combined ("All")
  // hero ONLY while we have no loans loaded yet (no live response, no cache).
  // The snapshot is an all-account aggregate, so it never applies to a single
  // selected container. Once loans arrive, the computed values win.
  const useSnapshotFallback =
    filter === null && all.length === 0 && snapshot != null;
  const displayAggLtv = useSnapshotFallback ? snapshot.aggregateLtv : aggLtv;
  const displayDebtUsd = useSnapshotFallback
    ? snapshot.totalDebtUsd
    : totalDebtUsd;
  const displayColUsd = useSnapshotFallback
    ? snapshot.totalCollateralUsd
    : totalColUsd;

  const status =
    activeTarget != null ? statusFromLtv(aggLtv, activeTarget) : null;

  const closest = useMemo(() => {
    if (loans.length === 0) return null;
    return [...loans].sort((a, b) => b.ltv - a.ltv)[0];
  }, [loans]);

  // Which account the closest-to-liquidation loan belongs to. Mirrors the
  // loan-list resolution so the card names the same account shown below.
  const closestAccountName = closest
    ? accounts.find((a) => a.id === closest.accountId)?.name ?? null
    : null;

  // Which loan the master–detail pane shows. Honour an explicit selection only
  // while it still exists in the current (possibly filtered) list; otherwise
  // fall back to the closest-to-liquidation loan, then the first one.
  const selectedExists =
    selectedLoanId != null && loans.some((l) => l.id === selectedLoanId);
  const effectiveSelectedId = masterDetail
    ? selectedExists
      ? selectedLoanId
      : closest?.id ?? loans[0]?.id ?? null
    : null;

  // Aggregate signed distance to target across all loans. With the
  // corrected `headroomToTarget` semantics, POSITIVE values are real
  // headroom and NEGATIVE values are shortfall. Surface the worse of
  // the two so the dashboard tells the truth: if any loan is over
  // target the user needs to know, even if other loans have buffer.
  const { totalShortfall, totalHeadroom } = useMemo(() => {
    let shortfall = 0;
    let headroom = 0;
    if (activeTarget == null) return { totalShortfall: 0, totalHeadroom: 0 };
    for (const l of loans) {
      const h = headroomToTarget(l, activeTarget);
      if (h < 0) shortfall += -h;
      else headroom += h;
    }
    return { totalShortfall: shortfall, totalHeadroom: headroom };
  }, [loans, activeTarget]);
  const overTarget = totalShortfall > 0;

  // Side effects (alerts, widget snapshot, LTV history) MUST run only on a
  // fresh network success. If we fire them on cached data we:
  //   • re-publish a widget snapshot stamped `new Date()` over stale numbers,
  //     so the widget's own staleness label lies;
  //   • notify on a price that may be hours old;
  //   • record a stale LTV sample as if it were a current observation.
  // Gate everything off `loansQ.data` (the live response), not `all` (which
  // falls back to cache).
  const freshLoans = loansQ.data?.loans;

  // Alerts + history: only meaningful when there are open loans. Keyed to the
  // fresh loan payload so changing risk/container metadata doesn't re-fire
  // notifications or record duplicate history samples.
  useEffect(() => {
    if (!freshLoans || freshLoans.length === 0) return;
    void checkAndNotifyLoans(freshLoans);
    void recordLtvSample(aggLtv);
    void recordLoanSnapshots(
      freshLoans.map((l) => ({
        id: l.id,
        apr: l.apr,
        ltv: l.ltv,
        debtUsd: l.debtUsd,
      })),
    );
  }, [freshLoans, aggLtv]);

  // Widget snapshot: write on EVERY fresh network response, including an empty
  // one (all loans closed) so the widget zeroes out instead of showing stale
  // debt/LTV. Writing also pokes WidgetCenter to reload immediately.
  useEffect(() => {
    if (!freshLoans) return;
    // Per-account (Personal / Trust container) breakdown for the large widget.
    const accountBreakdown = containers.map((c) => {
      const ids = new Set(c.links.map((l) => l.id));
      const ls = freshLoans.filter((l) => ids.has(l.accountId));
      const debt = ls.reduce((s, l) => s + l.debtUsd, 0);
      const col = ls.reduce((s, l) => s + l.collateral.valueUsd, 0);
      return {
        label: c.name,
        type: c.type,
        ltv: col > 0 ? (debt / col) * 100 : 0,
        debtUsd: debt,
        collateralUsd: col,
        targetLtv: targetForContainer(c.id) ?? targetLtv,
        loanCount: ls.length,
        weightedAprPct: weightedApr(ls),
      };
    });
    const markets = buildMarketQuotes(freshLoans, loanTickerMap);
    void writeWidgetSnapshot(
      buildSnapshot(freshLoans, targetLtv, accountBreakdown, markets),
    );
  }, [freshLoans, targetLtv, containers, targetForContainer, loanTickerMap]);

  const refreshing = accountsQ.isFetching || loansQ.isFetching;
  const wasRefreshing = useRef(false);
  useEffect(() => {
    if (wasRefreshing.current && !refreshing) {
      if (accountsQ.isError || loansQ.isError) haptic.error();
      else haptic.success();
    }
    wasRefreshing.current = refreshing;
  }, [refreshing, accountsQ.isError, loansQ.isError]);

  const onRefresh = () => {
    haptic.impact();
    accountsQ.refetch();
    loansQ.refetch();
  };

  // Only show the blocking loader / error screen when we have NO cache to
  // fall back on. With cache, we render the dashboard normally and surface
  // the stale state via a banner at the top.
  // With a server snapshot in hand we can render the hero immediately, so only
  // fall back to the skeleton when we have neither cache nor snapshot.
  if (
    (accountsQ.isLoading || loansQ.isLoading) &&
    all.length === 0 &&
    snapshot == null
  ) {
    return <ScreenSkeleton kind="dashboard" />;
  }

  if (
    (accountsQ.isError || loansQ.isError) &&
    all.length === 0 &&
    snapshot == null
  ) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ErrorView
          message={(loansQ.error ?? accountsQ.error)?.message}
          onRetry={onRefresh}
        />
      </View>
    );
  }

  // ── iPad / large-window master–detail ──────────────────────────────────
  // Summary + selectable loan list on the left, the selected loan's full
  // breakdown on the right. The whole thing lives in one ScrollView so it
  // scrolls as a single page (no fragile nested scroll views). Phones and
  // narrow split-view widths fall through to the single-column layout below.
  if (masterDetail) {
    return (
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={{
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 100,
          paddingHorizontal: 16,
          gap: 16,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        <Container maxWidth={MASTER_DETAIL_MAX_WIDTH} style={{ gap: 16 }}>
          {showingCached && cachedAt ? (
            <View
              style={{
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderRadius: colors.radius,
                backgroundColor: colors.card,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontFamily: "Inter_500Medium",
                  fontSize: 12,
                }}
              >
                Showing offline data ({cacheAgeLabel(cachedAt)}). Pull to refresh.
              </Text>
            </View>
          ) : null}

          <View style={styles.header}>
            <View>
              <Text style={[styles.title, { color: colors.foreground }]}>
                Dashboard
              </Text>
              <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
                Across {containers.length} account
                {containers.length === 1 ? "" : "s"}
              </Text>
            </View>
            <Pressable
              onPress={() => {
                haptic.tap();
                toggle();
              }}
              style={({ pressed }) => [
                styles.fxBtn,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  borderRadius: colors.radius,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text style={[styles.fxText, { color: colors.foreground }]}>
                {currency}
              </Text>
              <Feather name="repeat" size={12} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <View style={styles.masterDetail}>
            <View style={styles.masterPane}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipRow}
              >
                <AccountChip
                  label="All"
                  hint={fmtPct(aggLtv)}
                  selected={filter === null}
                  onPress={() => {
                    haptic.tap();
                    setFilter(null);
                  }}
                />
                {containers.map((c) => (
                  <AccountChip
                    key={c.id}
                    label={c.name}
                    hint={`LTV ${fmtPct(containerLtv.get(c.id) ?? 0)}`}
                    selected={filter === c.id}
                    onPress={() => {
                      haptic.tap();
                      setFilter(c.id);
                    }}
                  />
                ))}
              </ScrollView>

              <View
                style={[
                  styles.hero,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    borderRadius: colors.radius,
                  },
                ]}
              >
                <Text
                  style={[styles.heroLabel, { color: colors.mutedForeground }]}
                >
                  AGGREGATE LTV
                </Text>
                <Text
                  style={[
                    styles.heroValue,
                    {
                      color:
                        status === null
                          ? colors.foreground
                          : status === "ok"
                            ? colors.ok
                            : status === "warn"
                              ? colors.warn
                              : colors.danger,
                    },
                  ]}
                >
                  {fmtPct(displayAggLtv)}
                </Text>
                {status !== null ? (
                  <Pill status={status} label={statusLabel(status)} />
                ) : null}
                <View style={styles.heroFooter}>
                  <Text
                    style={[styles.heroSub, { color: colors.mutedForeground }]}
                  >
                    Debt {fmtMoney(displayDebtUsd, currency, { whole: true })}
                  </Text>
                  <Text
                    style={[styles.heroSub, { color: colors.mutedForeground }]}
                  >
                    Collateral{" "}
                    {fmtMoney(displayColUsd, currency, { whole: true })}
                  </Text>
                </View>
              </View>

              <LtvHistoryChart
                currentLtv={displayAggLtv}
                targetLtv={activeTarget ?? undefined}
              />

              {closest ? (
                <Pressable
                  onPress={() => {
                    haptic.tap();
                    setSelectedLoanId(closest.id);
                  }}
                  style={({ pressed }) => [
                    styles.distance,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      borderRadius: colors.radius,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  <View style={styles.distanceHead}>
                    <Text
                      style={[
                        styles.tileLabel,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      CLOSEST TO LIQUIDATION
                    </Text>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text
                        style={[styles.distAsset, { color: colors.foreground }]}
                      >
                        {closest.collateral.asset}
                      </Text>
                      {closestAccountName ? (
                        <Text
                          style={[
                            styles.distAccount,
                            { color: colors.mutedForeground },
                          ]}
                        >
                          {closestAccountName}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                  <Text style={[styles.distValue, { color: colors.danger }]}>
                    {fmtPct(priceDropPctTo(closest, LIQ_LTV))}
                  </Text>
                  <View style={styles.distFooter}>
                    <Text
                      style={[styles.distHint, { color: colors.mutedForeground }]}
                    >
                      price drop until liquidation
                    </Text>
                    <Text
                      style={[styles.distHint, { color: colors.mutedForeground }]}
                    >
                      at {fmtMoney(priceAtLtv(closest, LIQ_LTV), currency)}
                    </Text>
                  </View>
                </Pressable>
              ) : null}

              <View style={styles.tileRow}>
                <Tile
                  label="Loans"
                  value={String(loans.length)}
                  style={{ flex: 1 }}
                />
                {activeTarget != null ? (
                  <Tile
                    label={
                      overTarget
                        ? `Over ${activeTarget}%`
                        : `Headroom to ${activeTarget}%`
                    }
                    value={fmtMoney(
                      overTarget ? totalShortfall : totalHeadroom,
                      currency,
                      { whole: true },
                    )}
                    hint={overTarget ? "add collateral" : "buffer"}
                    tone={overTarget ? "warn" : "ok"}
                    style={{ flex: 1 }}
                    onInfo={() => {
                      haptic.tap();
                      setSimOpen(true);
                    }}
                  />
                ) : (
                  <Tile
                    label="Collateral"
                    value={fmtMoney(totalColUsd, currency, { whole: true })}
                    hint="total value"
                    style={{ flex: 1 }}
                  />
                )}
              </View>

              <LunoReadyToDeployTile currency={currency} />

              <View style={styles.section}>
                <Text
                  style={[styles.sectionTitle, { color: colors.foreground }]}
                >
                  Loans
                </Text>
                {loans.length === 0 ? (
                  <View
                    style={[
                      styles.emptyCard,
                      {
                        borderColor: colors.border,
                        borderRadius: colors.radius,
                      },
                    ]}
                  >
                    <Text
                      style={[styles.emptyTitle, { color: colors.foreground }]}
                    >
                      No open loans
                    </Text>
                    <Text
                      style={[styles.empty, { color: colors.mutedForeground }]}
                    >
                      When you open a loan on Binance it will show up here on
                      next refresh.
                    </Text>
                  </View>
                ) : (
                  <View style={{ gap: 10 }}>
                    {loans.map((l) => {
                      const acc = accounts.find((a) => a.id === l.accountId);
                      return (
                        <LoanRow
                          key={l.id}
                          loan={l}
                          accountName={acc?.name ?? "—"}
                          priceTickers={loanTickerMap}
                          selected={l.id === effectiveSelectedId}
                          onPress={() => {
                            haptic.tap();
                            setSelectedLoanId(l.id);
                          }}
                        />
                      );
                    })}
                  </View>
                )}
              </View>
            </View>

            <View style={styles.detailPane}>
              {effectiveSelectedId ? (
                <LoanDetailView loanId={effectiveSelectedId} embedded />
              ) : (
                <View
                  style={[
                    styles.detailPlaceholder,
                    {
                      borderColor: colors.border,
                      borderRadius: colors.radius,
                    },
                  ]}
                >
                  <Feather
                    name="bar-chart-2"
                    size={22}
                    color={colors.mutedForeground}
                  />
                  <Text style={[styles.empty, { color: colors.mutedForeground }]}>
                    Select a loan to see its full breakdown here.
                  </Text>
                </View>
              )}
            </View>
          </View>

          <CollateralSimModal
            visible={simOpen}
            onClose={() => setSimOpen(false)}
            currency={currency}
            usdToZar={usdToZar}
            totalDebtUsd={totalDebtUsd}
            totalColUsd={totalColUsd}
            currentAggLtv={aggLtv}
            activeTarget={activeTarget}
            shortfallUsd={totalShortfall}
            closest={closest}
            closestAccountName={closestAccountName}
          />
        </Container>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{
        paddingTop: insets.top + 16,
        paddingBottom: insets.bottom + 100,
        paddingHorizontal: 16,
        gap: 16,
      }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
        />
      }
    >
      <Container maxWidth={WIDE_CONTENT_WIDTH} style={{ gap: 16 }}>
      {showingCached && cachedAt ? (
        <View
          style={{
            paddingVertical: 8,
            paddingHorizontal: 12,
            borderRadius: colors.radius,
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: "Inter_500Medium",
              fontSize: 12,
            }}
          >
            Showing offline data ({cacheAgeLabel(cachedAt)}). Pull to refresh.
          </Text>
        </View>
      ) : null}
      <View style={styles.header}>
        <View>
          <Text style={[styles.title, { color: colors.foreground }]}>
            Dashboard
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Across {containers.length} account{containers.length === 1 ? "" : "s"}
          </Text>
        </View>
        <Pressable
          onPress={() => {
            haptic.tap();
            toggle();
          }}
          style={({ pressed }) => [
            styles.fxBtn,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: colors.radius,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Text style={[styles.fxText, { color: colors.foreground }]}>
            {currency}
          </Text>
          <Feather name="repeat" size={12} color={colors.mutedForeground} />
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        <AccountChip
          label="All"
          hint={fmtPct(aggLtv)}
          selected={filter === null}
          onPress={() => {
            haptic.tap();
            setFilter(null);
          }}
        />
        {containers.map((c) => (
          <AccountChip
            key={c.id}
            label={c.name}
            hint={`LTV ${fmtPct(containerLtv.get(c.id) ?? 0)}`}
            selected={filter === c.id}
            onPress={() => {
              haptic.tap();
              setFilter(c.id);
            }}
          />
        ))}
      </ScrollView>

      <Grid minColumnWidth={380} gap={16}>
        <View
          style={[
            styles.hero,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: colors.radius,
            },
          ]}
        >
          <Text style={[styles.heroLabel, { color: colors.mutedForeground }]}>
            AGGREGATE LTV
          </Text>
          <Text
            style={[
              styles.heroValue,
              {
                color:
                  status === null
                    ? colors.foreground
                    : status === "ok"
                      ? colors.ok
                      : status === "warn"
                        ? colors.warn
                        : colors.danger,
              },
            ]}
          >
            {fmtPct(displayAggLtv)}
          </Text>
          {status !== null ? (
            <Pill status={status} label={statusLabel(status)} />
          ) : null}
          <View style={styles.heroFooter}>
            <Text style={[styles.heroSub, { color: colors.mutedForeground }]}>
              Debt {fmtMoney(displayDebtUsd, currency, { whole: true })}
            </Text>
            <Text style={[styles.heroSub, { color: colors.mutedForeground }]}>
              Collateral {fmtMoney(displayColUsd, currency, { whole: true })}
            </Text>
          </View>
        </View>

        <LtvHistoryChart
          currentLtv={displayAggLtv}
          targetLtv={activeTarget ?? undefined}
        />
      </Grid>

      {closest ? (
        <Pressable
          onPress={() => {
            haptic.tap();
            router.push(`/loan/${closest.id}`);
          }}
          style={({ pressed }) => [
            styles.distance,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: colors.radius,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <View style={styles.distanceHead}>
            <Text style={[styles.tileLabel, { color: colors.mutedForeground }]}>
              CLOSEST TO LIQUIDATION
            </Text>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={[styles.distAsset, { color: colors.foreground }]}>
                {closest.collateral.asset}
              </Text>
              {closestAccountName ? (
                <Text
                  style={[styles.distAccount, { color: colors.mutedForeground }]}
                >
                  {closestAccountName}
                </Text>
              ) : null}
            </View>
          </View>
          <Text style={[styles.distValue, { color: colors.danger }]}>
            {fmtPct(priceDropPctTo(closest, LIQ_LTV))}
          </Text>
          <View style={styles.distFooter}>
            <Text style={[styles.distHint, { color: colors.mutedForeground }]}>
              price drop until liquidation
            </Text>
            <Text style={[styles.distHint, { color: colors.mutedForeground }]}>
              at {fmtMoney(priceAtLtv(closest, LIQ_LTV), currency)}
            </Text>
          </View>
        </Pressable>
      ) : null}

      <View style={styles.tileRow}>
        <Tile
          label="Loans"
          value={String(loans.length)}
          style={{ flex: 1 }}
        />
        {activeTarget != null ? (
          <Tile
            label={
              overTarget ? `Over ${activeTarget}%` : `Headroom to ${activeTarget}%`
            }
            value={fmtMoney(
              overTarget ? totalShortfall : totalHeadroom,
              currency,
              { whole: true },
            )}
            hint={overTarget ? "add collateral" : "buffer"}
            tone={overTarget ? "warn" : "ok"}
            style={{ flex: 1 }}
            onInfo={() => {
              haptic.tap();
              setSimOpen(true);
            }}
          />
        ) : (
          <Tile
            label="Collateral"
            value={fmtMoney(totalColUsd, currency, { whole: true })}
            hint="total value"
            style={{ flex: 1 }}
          />
        )}
      </View>

      <CollateralSimModal
        visible={simOpen}
        onClose={() => setSimOpen(false)}
        currency={currency}
        usdToZar={usdToZar}
        totalDebtUsd={totalDebtUsd}
        totalColUsd={totalColUsd}
        currentAggLtv={aggLtv}
        activeTarget={activeTarget}
        shortfallUsd={totalShortfall}
        closest={closest}
        closestAccountName={closestAccountName}
      />

      <LunoReadyToDeployTile currency={currency} />


      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          Loans
        </Text>
        {loans.length === 0 ? (
          <View style={[styles.emptyCard, { borderColor: colors.border, borderRadius: colors.radius }]}>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              No open loans
            </Text>
            <Text style={[styles.empty, { color: colors.mutedForeground }]}>
              When you open a loan on Binance it will show up here on next refresh.
            </Text>
          </View>
        ) : (
          <Grid minColumnWidth={340} gap={10}>
            {loans.map((l) => {
              const acc = accounts.find((a) => a.id === l.accountId);
              return (
                <LoanRow
                  key={l.id}
                  loan={l}
                  accountName={acc?.name ?? "—"}
                  priceTickers={loanTickerMap}
                  onPress={() => router.push(`/loan/${l.id}`)}
                />
              );
            })}
          </Grid>
        )}
      </View>
      </Container>
    </ScrollView>
  );
}

// Inline tile that aggregates BTC sitting on any linked Luno account and
// quotes it against the live XBTZAR price. Hidden entirely when there's no
// Luno data or no meaningful BTC balance — keeps the dashboard quiet for
// Binance-only users.
function LunoReadyToDeployTile({
  currency,
}: {
  currency: "USD" | "ZAR";
}) {
  const colors = useColors();
  const router = useRouter();
  const walletsQ = useListLunoWallets();
  // Use the same currency-aware pair the Crypto tab uses, so a USD-display
  // user doesn't see a ZAR quote here. `pairsForAssets(["XBT"], currency)`
  // gives XBTZAR for ZAR, XBTUSDC for USD, etc.
  const btcPair = pairsForAssets(["XBT"], currency)[0] ?? "XBTZAR";
  const tickersQ = useGetLunoTickers(
    { pairs: btcPair },
    // See crypto.tsx — narrow the option without satisfying orval's full
    // UseQueryOptions shape.
    { query: { enabled: !!btcPair } as never },
  );
  const wallets = walletsQ.data?.wallets ?? [];
  if (wallets.length === 0) return null;
  const btc = wallets
    .filter((w) => w.asset.toUpperCase() === "XBT")
    .reduce((s, w) => s + w.balance, 0);
  if (btc < 0.0001) return null;
  const tickerMap = new Map<string, number>();
  for (const t of tickersQ.data?.tickers ?? []) tickerMap.set(t.pair, t.lastTrade);
  const fiat = quoteWalletInFiat("XBT", btc, tickerMap, currency);
  return (
    <Pressable
      onPress={() => {
        haptic.tap();
        router.push("/(tabs)/crypto");
      }}
      style={({ pressed }) => [
        {
          padding: 14,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.primary,
          backgroundColor: colors.card,
          borderRadius: colors.radius,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <Feather name="arrow-right-circle" size={18} color={colors.primary} />
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontSize: 10,
            letterSpacing: 1,
            fontFamily: "Inter_600SemiBold",
            color: colors.mutedForeground,
          }}
        >
          LUNO · READY TO DEPLOY
        </Text>
        <Text
          style={{
            fontSize: 16,
            fontFamily: "Inter_700Bold",
            fontVariant: ["tabular-nums"],
            color: colors.foreground,
            marginTop: 2,
          }}
        >
          {btc.toFixed(8)} BTC
          {fiat > 0
            ? `  ·  ≈ ${fmtDisplayMoney(fiat, currency, { whole: true })}`
            : ""}
        </Text>
      </View>
      <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 24, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  fxBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  fxText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  chipRow: { gap: 8, paddingRight: 8 },
  hero: {
    padding: 18,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  heroLabel: { fontSize: 10, letterSpacing: 1.5, fontFamily: "Inter_600SemiBold" },
  heroValue: {
    fontSize: 56,
    fontFamily: "Inter_700Bold",
    fontVariant: ["tabular-nums"],
    letterSpacing: -2,
  },
  heroFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  heroSub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    fontVariant: ["tabular-nums"],
  },
  distance: {
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  distanceHead: { flexDirection: "row", justifyContent: "space-between" },
  distFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },
  tileLabel: { fontSize: 10, letterSpacing: 1, fontFamily: "Inter_600SemiBold" },
  distAsset: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  distAccount: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  distValue: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    fontVariant: ["tabular-nums"],
  },
  distHint: { fontSize: 11, fontFamily: "Inter_400Regular" },
  tileRow: { flexDirection: "row", gap: 10 },
  section: { gap: 10 },
  sectionTitle: {
    fontSize: 13,
    letterSpacing: 0.5,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
  },
  empty: { textAlign: "center", fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 6 },
  emptyCard: { padding: 24, borderWidth: StyleSheet.hairlineWidth, alignItems: "center" },
  emptyTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  masterDetail: { flexDirection: "row", gap: 20, alignItems: "flex-start" },
  masterPane: { width: 360, gap: 16 },
  detailPane: { flex: 1 },
  detailPlaceholder: {
    padding: 32,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    gap: 10,
  },
});
