import * as Updates from "expo-updates";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Text, View } from "react-native";

import { Divider, Row, Section } from "@/components/SettingsList";
import { useColors } from "@/hooks/useColors";
import { reportError } from "@/lib/crashReporting";
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
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Snapshot of the update runtime, attached to any captured error so a
  // Diagnostics entry can be correlated to the exact bundle/channel/runtime.
  const updateContext = useCallback(
    (source: string) => ({
      source,
      channel: Updates.channel ?? null,
      runtimeVersion: Updates.runtimeVersion ?? null,
      updateId: Updates.updateId ?? null,
      isEmbeddedLaunch: Updates.isEmbeddedLaunch ?? null,
      isEnabled: Updates.isEnabled ?? null,
    }),
    [],
  );

  const onCheck = useCallback(async () => {
    haptic.tap();
    try {
      setErrorMsg(null);
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
    } catch (e) {
      // Don't swallow: surface the real reason so it's visible here AND lands
      // in Diagnostics (Settings → Diagnostics) for copy/paste.
      reportError(e, updateContext("UpdateSettings.checkForUpdate"));
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setState("error");
      haptic.error();
    }
  }, [updateContext]);

  // We deliberately do NOT call Updates.reloadAsync() here. On this build
  // (New Architecture + expo-updates 29 / RN 0.81) a forced reload crashes the
  // app natively, which a JS try/catch cannot prevent. The downloaded update is
  // already staged and applies automatically on the next cold launch
  // (checkAutomatically=ON_LOAD, fallbackToCacheTimeout=0), so we just tell the
  // user to fully close and reopen.
  const onRestart = useCallback(() => {
    haptic.impact();
    Alert.alert(
      "Update downloaded",
      "Fully close Ledger (swipe it away in the app switcher), then reopen it to finish updating.",
    );
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
        ? errorMsg
          ? `Failed: ${errorMsg}`
          : "Check failed — retry"
        : undefined;

  return (
    <Section title="App updates">
      {state === "ready" ? (
        <Row
          label="Update downloaded"
          value="Close & reopen to apply"
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
