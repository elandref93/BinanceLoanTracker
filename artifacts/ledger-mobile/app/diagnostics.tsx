import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { Stack, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Container } from "@/components/Container";
import { useColors } from "@/hooks/useColors";
import { haptic } from "@/lib/haptics";
import {
  clearCrashes,
  getRecentCrashes,
  type CrashEntry,
} from "@/lib/crashReporting";
import { fmtAge } from "@/utils/format";

export default function DiagnosticsScreen() {
  const colors = useColors();
  const [entries, setEntries] = useState<CrashEntry[]>([]);

  const load = useCallback(() => {
    void getRecentCrashes().then(setEntries);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onCopyAll = async () => {
    const text =
      entries
        .map(
          (e) =>
            `[${e.time}] ${e.fatal ? "FATAL " : ""}${e.message}\n` +
            `${e.context ? `context: ${JSON.stringify(e.context)}\n` : ""}` +
            `${e.stack ?? ""}`,
        )
        .join("\n\n──────────\n\n") || "No errors recorded.";
    await Clipboard.setStringAsync(text);
    haptic.tap();
    Alert.alert("Copied", "Crash logs copied to clipboard.");
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
          entries.map((e) => (
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
                    {
                      color: e.fatal ? colors.danger : colors.warn,
                      borderColor: e.fatal ? colors.danger : colors.warn,
                    },
                  ]}
                >
                  {e.fatal ? "FATAL" : "ERROR"}
                </Text>
                <Text style={[styles.time, { color: colors.mutedForeground }]}>
                  {fmtAge(e.time)}
                </Text>
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
          ))
        )}
      </Container>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 16, gap: 14, paddingBottom: 40 },
  intro: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular" },
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
