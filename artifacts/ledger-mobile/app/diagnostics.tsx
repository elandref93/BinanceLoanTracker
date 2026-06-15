import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { Stack, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Container } from "@/components/Container";
import { useSession } from "@/context/SessionContext";
import { useColors } from "@/hooks/useColors";
import { useStoredAccountsCount } from "@/lib/accountStore";
import { haptic } from "@/lib/haptics";
import {
  clearCrashes,
  getRecentCrashes,
  type CrashEntry,
} from "@/lib/crashReporting";
import { isExpoGo, syncBackendDomain } from "@/lib/runtime";
import {
  getSyncDiagnostics,
  subscribeSyncDiagnostics,
} from "@/lib/syncDiagnostics";
import { fmtAge } from "@/utils/format";

/** Severity label for an entry, tolerant of legacy entries without `level`. */
function levelOf(e: CrashEntry): "INFO" | "WARN" | "ERROR" | "FATAL" {
  const level = e.level ?? (e.fatal ? "fatal" : "error");
  if (level === "fatal") return "FATAL";
  if (level === "warn") return "WARN";
  if (level === "info") return "INFO";
  return "ERROR";
}

/** Single-entry plain-text rendering, shared by "Copy all" and per-entry copy. */
function formatEntry(e: CrashEntry): string {
  return (
    `[${e.time}] ${levelOf(e)} ${e.message}\n` +
    `${e.context ? `context: ${JSON.stringify(e.context)}\n` : ""}` +
    `${e.stack ?? ""}`
  );
}

export default function DiagnosticsScreen() {
  const colors = useColors();
  const { user, accountsHydrateStatus, accountsHydrateError } = useSession();
  const accountsCount = useStoredAccountsCount();
  const [entries, setEntries] = useState<CrashEntry[]>([]);
  const [syncDiag, setSyncDiag] = useState(getSyncDiagnostics());

  useEffect(() => {
    return subscribeSyncDiagnostics(() => {
      setSyncDiag(getSyncDiagnostics());
    });
  }, []);

  const load = useCallback(() => {
    void getRecentCrashes().then(setEntries);
    setSyncDiag(getSyncDiagnostics());
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onCopyAll = async () => {
    const text =
      entries.map(formatEntry).join("\n\n──────────\n\n") ||
      "No errors recorded.";
    await Clipboard.setStringAsync(text);
    haptic.tap();
    Alert.alert("Copied", "Crash logs copied to clipboard.");
  };

  const onCopyEntry = async (entry: CrashEntry) => {
    await Clipboard.setStringAsync(formatEntry(entry));
    haptic.tap();
    Alert.alert("Copied", "Entry copied to clipboard.");
  };

  const onClear = () => {
    Alert.alert(
      "Clear crash logs?",
      "This removes all locally recorded errors on this device.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: async () => {
            haptic.heavy();
            await clearCrashes();
            load();
          },
        },
      ],
    );
  };

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.wrap}
    >
      <Stack.Screen options={{ title: "Diagnostics" }} />
      <Container style={{ gap: 14 }}>
        <Text style={[styles.intro, { color: colors.mutedForeground }]}>
          Recent errors captured on this device. If the app crashes, open this
          screen, tap “Copy all”, and send the text to the developer to pinpoint
          the cause.
        </Text>

        <View
          style={[
            styles.syncPanel,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: colors.radius,
            },
          ]}
        >
          <Text style={[styles.syncTitle, { color: colors.foreground }]}>
            Account sync
          </Text>
          <SyncRow label="Backend" value={syncBackendDomain()} colors={colors} />
          <SyncRow
            label="Client"
            value={isExpoGo() ? "Expo Go (separate Apple sub)" : "Standalone / TestFlight"}
            colors={colors}
          />
          <SyncRow
            label="Apple sub"
            value={user?.sub ? `${user.sub.slice(0, 8)}…` : "—"}
            colors={colors}
          />
          <SyncRow
            label="Hydrate status"
            value={accountsHydrateStatus}
            colors={colors}
          />
          {accountsHydrateError ? (
            <SyncRow label="Hydrate error" value={accountsHydrateError} colors={colors} />
          ) : null}
          <SyncRow
            label="Local profiles"
            value={accountsCount == null ? "…" : String(accountsCount)}
            colors={colors}
          />
          <SyncRow
            label="Last hydrate"
            value={
              syncDiag.lastHydrateAt
                ? `${fmtAge(syncDiag.lastHydrateAt)} · ${syncDiag.lastHydrate?.status ?? "?"}`
                : "—"
            }
            colors={colors}
          />
          <SyncRow
            label="Last push"
            value={
              syncDiag.lastPushAt
                ? `${fmtAge(syncDiag.lastPushAt)} · ${syncDiag.lastPush?.status ?? "?"}`
                : "—"
            }
            colors={colors}
          />
        </View>

        <View style={styles.actions}>
          <Pressable
            onPress={onCopyAll}
            style={({ pressed }) => [
              styles.btn,
              { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Feather name="copy" size={14} color={colors.primary} />
            <Text style={[styles.btnText, { color: colors.foreground }]}>
              Copy all
            </Text>
          </Pressable>
          <Pressable
            onPress={onClear}
            style={({ pressed }) => [
              styles.btn,
              { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Feather name="trash-2" size={14} color={colors.danger} />
            <Text style={[styles.btnText, { color: colors.danger }]}>Clear</Text>
          </Pressable>
        </View>

        {entries.length === 0 ? (
          <Text style={[styles.empty, { color: colors.mutedForeground }]}>
            No errors recorded yet.
          </Text>
        ) : (
          entries.map((e) => {
            const label = levelOf(e);
            const badgeColor =
              label === "FATAL" || label === "ERROR"
                ? colors.danger
                : label === "WARN"
                  ? colors.warn
                  : colors.mutedForeground;
            return (
            <View
              key={e.id}
              style={[
                styles.card,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  borderRadius: colors.radius,
                },
              ]}
            >
              <View style={styles.cardHead}>
                <Text
                  style={[
                    styles.badge,
                    { color: badgeColor, borderColor: badgeColor },
                  ]}
                >
                  {label}
                </Text>
                <View style={styles.cardHeadRight}>
                  <Text style={[styles.time, { color: colors.mutedForeground }]}>
                    {fmtAge(e.time)}
                  </Text>
                  <Pressable
                    onPress={() => onCopyEntry(e)}
                    hitSlop={8}
                    style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                  >
                    <Feather name="copy" size={14} color={colors.primary} />
                  </Pressable>
                </View>
              </View>
              <Text style={[styles.msg, { color: colors.foreground }]}>
                {e.message}
              </Text>
              {e.context ? (
                <Text style={[styles.mono, { color: colors.mutedForeground }]}>
                  {JSON.stringify(e.context)}
                </Text>
              ) : null}
              {e.stack ? (
                <Text style={[styles.mono, { color: colors.mutedForeground }]}>
                  {e.stack}
                </Text>
              ) : null}
            </View>
            );
          })
        )}
      </Container>
    </ScrollView>
  );
}

function SyncRow({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.syncRow}>
      <Text style={[styles.syncLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
      <Text
        style={[styles.syncValue, { color: colors.foreground }]}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 16, gap: 14, paddingBottom: 40 },
  intro: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular" },
  syncPanel: {
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  syncTitle: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    marginBottom: 4,
  },
  syncRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "flex-start",
  },
  syncLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    flexShrink: 0,
  },
  syncValue: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    textAlign: "right",
  },
  actions: { flexDirection: "row", gap: 10 },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
  },
  btnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  empty: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 24,
  },
  card: {
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  cardHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardHeadRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  badge: {
    fontSize: 10,
    letterSpacing: 1,
    fontFamily: "Inter_700Bold",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    overflow: "hidden",
  },
  time: { fontSize: 11, fontFamily: "Inter_400Regular" },
  msg: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  mono: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    fontVariant: ["tabular-nums"],
  },
});
