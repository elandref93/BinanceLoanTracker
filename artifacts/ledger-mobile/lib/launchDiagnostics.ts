/**
 * Cold-start diagnostics that run as soon as JS boots.
 *
 * Complements native AppDelegate logging (plugins/withNativeLaunchLogging.js):
 * if this module runs, JS got past expo-updates StartupProcedure. We then
 * (1) ingest any NSException saved from a *previous* abort, (2) snapshot
 * expo-updates state, (3) dump recent expo-updates native logs into the
 * on-device crash buffer + Sentry breadcrumbs so the next abort has context.
 */
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { Platform } from "react-native";

import { reportFatal, reportMessage } from "@/lib/crashReporting";
import { Sentry } from "@/lib/sentry";

const APP_GROUP = "group.com.ledger.shared";
const NATIVE_ABORT_KEY = "ledger.lastNativeAbort";

type NativeAbortPayload = {
  time?: string;
  name?: string;
  reason?: string;
  stack?: string;
};

function updatesSnapshot(): Record<string, unknown> {
  return {
    platform: Platform.OS,
    appVersion: Constants.expoConfig?.version ?? null,
    nativeBuild: Constants.nativeBuildVersion ?? null,
    runtimeVersion: Updates.runtimeVersion ?? null,
    channel: Updates.channel ?? null,
    updateId: Updates.updateId ?? null,
    isEnabled: Updates.isEnabled,
    isEmbeddedLaunch: Updates.isEmbeddedLaunch,
    isEmergencyLaunch: Updates.isEmergencyLaunch,
    emergencyLaunchReason: Updates.emergencyLaunchReason ?? null,
    checkAutomatically: Constants.expoConfig?.updates?.checkAutomatically ?? null,
  };
}

async function ingestNativeAbort(): Promise<void> {
  if (Platform.OS !== "ios") return;
  try {
    const mod = require("react-native-shared-group-preferences") as {
      default?: {
        getItem: (key: string, group: string) => Promise<unknown>;
        setItem: (key: string, value: unknown, group: string) => Promise<void>;
      };
      getItem?: (key: string, group: string) => Promise<unknown>;
      setItem?: (key: string, value: unknown, group: string) => Promise<void>;
    };
    const SharedGroupPreferences = mod.default ?? mod;
    if (!SharedGroupPreferences.getItem || !SharedGroupPreferences.setItem) {
      return;
    }
    const raw = await SharedGroupPreferences.getItem(
      NATIVE_ABORT_KEY,
      APP_GROUP,
    );
    if (raw == null || raw === "") return;
    const payload: NativeAbortPayload =
      typeof raw === "string" ? (JSON.parse(raw) as NativeAbortPayload) : (raw as NativeAbortPayload);
    const err = new Error(
      `[native-abort] ${payload.name ?? "NSException"}: ${payload.reason ?? "(no reason)"}`,
    );
    if (payload.stack) err.stack = payload.stack;
    reportFatal(err, {
      op: "nativeAbort.ingest",
      time: payload.time ?? null,
      ...updatesSnapshot(),
    });
    try {
      await SharedGroupPreferences.setItem(NATIVE_ABORT_KEY, "", APP_GROUP);
    } catch {
      // Clearing is best-effort; a leftover copy is better than losing the report.
    }
  } catch {
    // Missing key / module unavailable — not an error.
  }
}

async function dumpUpdatesLogs(): Promise<void> {
  try {
    const entries = await Updates.readLogEntriesAsync(60 * 60 * 1000);
    const recent = entries.slice(-40).map((e) => ({
      t: e.timestamp,
      level: e.level,
      msg: e.message,
      code: e.code,
      ...(e.level === "error" || e.level === "fatal"
        ? { stack: e.stacktrace }
        : {}),
    }));
    reportMessage("[launch] expo-updates logs", {
      op: "launch.updatesLogs",
      count: entries.length,
      recent,
    });
  } catch (e) {
    reportMessage("[launch] expo-updates logs unavailable", {
      op: "launch.updatesLogs",
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Fire-and-forget. Must never throw; must never block UI.
 */
export function logLaunchDiagnostics(): void {
  const snapshot = updatesSnapshot();
  try {
    Sentry.setContext("updates", snapshot);
    Sentry.setTag(
      "release_build",
      `${String(snapshot.appVersion)}+${String(snapshot.nativeBuild)}`,
    );
  } catch {
    // ignore
  }
  reportMessage("[launch] js alive", snapshot);
  try {
    Sentry.captureMessage("[launch] js alive", "info");
  } catch {
    // never block launch on telemetry
  }
  void (async () => {
    await ingestNativeAbort();
    await dumpUpdatesLogs();
  })();
}
