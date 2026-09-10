import * as Updates from "expo-updates";

import { reportError, reportMessage } from "@/lib/crashReporting";

let inFlight = false;

/**
 * Check for a newer over-the-air (EAS Update) JS bundle. If one is available it
 * is downloaded. Reload is opt-in and currently unused: activating an OTA
 * in-process via `reloadAsync()` (or `checkAutomatically: ON_LOAD`) aborts
 * natively on iOS 26 through expo-updates ErrorRecovery, which is the
 * TestFlight instant-crash we hit on build 70.
 *
 * Safe to call anywhere: it's a no-op in development / Expo Go (where
 * `Updates.isEnabled` is false), guards against overlapping runs, and swallows
 * network errors so a failed or offline check never blocks the user.
 */
export async function checkAndApplyUpdate(
  options: { reload?: boolean } = {},
): Promise<void> {
  if (__DEV__ || !Updates.isEnabled) return;
  // Avoid overlapping checks (e.g. a foreground event firing mid-download) and
  // any chance of a reload loop.
  if (inFlight) return;
  inFlight = true;
  const startedAt = Date.now();
  reportMessage("[ota] check start", {
    op: "ota.check.start",
    reload: options.reload === true,
    runtimeVersion: Updates.runtimeVersion ?? null,
    updateId: Updates.updateId ?? null,
    isEmbeddedLaunch: Updates.isEmbeddedLaunch,
    isEmergencyLaunch: Updates.isEmergencyLaunch,
    emergencyLaunchReason: Updates.emergencyLaunchReason ?? null,
  });
  try {
    const result = await Updates.checkForUpdateAsync();
    if (!result.isAvailable) {
      reportMessage("[ota] no update", {
        op: "ota.check",
        isAvailable: false,
        ms: Date.now() - startedAt,
      });
      return;
    }
    reportMessage("[ota] update available, fetching", {
      op: "ota.fetch.start",
      isAvailable: true,
    });
    // Download the new bundle to disk.
    await Updates.fetchUpdateAsync();
    reportMessage("[ota] update fetched", {
      op: "ota.fetch",
      isAvailable: true,
      ms: Date.now() - startedAt,
    });
    if (options.reload) {
      reportMessage("[ota] reloading into update", { op: "ota.reload" });
      // Restarts the JS runtime into the freshly-downloaded bundle. Execution
      // does not return past this point, so `inFlight` is reset by the relaunch.
      await Updates.reloadAsync();
    }
  } catch (e) {
    // No update, no network, fetch failed, or reload was rejected — keep the
    // current bundle and try again on the next trigger.
    reportError(e, { op: "ota.check" });
  } finally {
    inFlight = false;
  }
}
