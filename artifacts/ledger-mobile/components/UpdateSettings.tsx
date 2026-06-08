import * as Updates from "expo-updates";
import { useCallback, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { Divider, Row, Section } from "@/components/SettingsList";
import { useColors } from "@/hooks/useColors";
import { reportError } from "@/lib/crashReporting";
import { haptic } from "@/lib/haptics";

type CheckState = "idle" | "checking" | "downloading" | "current" | "error";

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
 * Settings block for over-the-air updates. Updates normally apply on their own
 * (see `components/AutoUpdater`), so this is just a manual override: tap "Check
 * for updates" to pull the latest JS bundle right now (with inline
 * "Checking…/Downloading…" feedback) and reload straight into it — no "close &
 * reopen" step. Plus a build-info readout so the user can confirm exactly which
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
        haptic.success();
        // Apply immediately: reload straight into the new bundle. This is a
        // user-initiated action well past startup, so reloadAsync is safe on
        // this stack (see lib/otaUpdates for the why). Execution does not
        // return past here — the app restarts into the update.
        await Updates.reloadAsync();
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
      <Row
        label={busy ? "Checking for updates" : "Check for updates"}
        value={statusValue}
        right={busyRight}
        onPress={busy ? undefined : onCheck}
      />
      <Divider />
      <Row label="Build" value={buildLabel} />
      <Divider />
      <Row label="Published" value={published} />
      <Divider />
      <Row label="Channel" value={channel} />
    </Section>
  );
}
