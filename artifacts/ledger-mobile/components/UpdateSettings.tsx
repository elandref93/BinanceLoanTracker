import * as Updates from "expo-updates";
import { useCallback, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { Divider, Row, Section } from "@/components/SettingsList";
import { useColors } from "@/hooks/useColors";
import { haptic } from "@/lib/haptics";

type CheckState =
  | "idle"
  | "checking"
  | "downloading"
  | "ready"
  | "current"
  | "error";

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  try {
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return d.toISOString();
  }
}

/**
 * Settings block for over-the-air updates. Gives the user an explicit,
 * visible control: tap "Check for updates" to actively pull the latest JS
 * bundle (with inline "Checking…/Downloading…" feedback and a one-tap
 * restart), plus a build-info readout so they can confirm exactly which
 * bundle is currently running — the diagnostic that proves an OTA landed.
 */
export function UpdateSettings() {
  const colors = useColors();
  const { currentlyRunning } = Updates.useUpdates();
  const [state, setState] = useState<CheckState>("idle");

  const onCheck = useCallback(async () => {
    haptic.tap();
    try {
      setState("checking");
      const res = await Updates.checkForUpdateAsync();
      if (res.isAvailable) {
        setState("downloading");
        await Updates.fetchUpdateAsync();
        setState("ready");
        haptic.success();
      } else {
        setState("current");
      }
    } catch {
      setState("error");
      haptic.error();
    }
  }, []);

  const onRestart = useCallback(() => {
    haptic.impact();
    void Updates.reloadAsync();
  }, []);

  if (!Updates.isEnabled) {
    return (
      <Section title="App updates">
        <Row label="Over-the-air updates" value="Production builds only" />
      </Section>
    );
  }

  const updateId = currentlyRunning.updateId;
  const buildLabel =
    currentlyRunning.isEmbeddedLaunch || !updateId
      ? "Bundled (no OTA yet)"
      : updateId.slice(0, 8);
  const published = fmtDate(currentlyRunning.createdAt ?? null);
  const channel = currentlyRunning.channel ?? Updates.channel ?? "—";
  const busy = state === "checking" || state === "downloading";

  const busyRight = busy ? (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <ActivityIndicator size="small" color={colors.primary} />
      <Text
        style={{
          fontSize: 13,
          fontFamily: "Inter_400Regular",
          color: colors.mutedForeground,
        }}
      >
        {state === "checking" ? "Checking…" : "Downloading…"}
      </Text>
    </View>
  ) : undefined;

  const statusValue =
    state === "current"
      ? "Up to date"
      : state === "error"
        ? "Check failed — retry"
        : undefined;

  return (
    <Section title="App updates">
      {state === "ready" ? (
        <Row
          label="Update downloaded"
          value="Tap to restart"
          onPress={onRestart}
        />
      ) : (
        <Row
          label={busy ? "Checking for updates" : "Check for updates"}
          value={statusValue}
          right={busyRight}
          onPress={busy ? undefined : onCheck}
        />
      )}
      <Divider />
      <Row label="Build" value={buildLabel} />
      <Divider />
      <Row label="Published" value={published} />
      <Divider />
      <Row label="Channel" value={channel} />
    </Section>
  );
}
