import * as Updates from "expo-updates";

import { reportError, reportMessage } from "@/lib/crashReporting";

/**
 * Check for a newer over-the-air (EAS Update) JS bundle and, if one is
 * available, download (stage) it so it applies on the NEXT cold launch.
 *
 * We deliberately do NOT call `Updates.reloadAsync()` here. On this build
 * (New Architecture + SDK 54) reloadAsync crashes natively; the crash makes
 * expo-updates mark the freshly-downloaded update as bad and roll back to the
 * embedded bundle, so the device gets permanently stuck on the old build and
 * re-crashes on every subsequent OTA. Staging + letting iOS apply the update
 * on the next natural cold launch (checkAutomatically: ON_LOAD) is the only
 * safe path. See UpdateBanner / UpdateSettings, which follow the same rule.
 *
 * Safe to call anywhere: it is a no-op in development / Expo Go (where
 * `Updates.isEnabled` is false) and swallows network errors so a failed or
 * offline check never blocks the user.
 */
export async function checkAndApplyUpdate(): Promise<void> {
  if (__DEV__ || !Updates.isEnabled) return;
  try {
    const result = await Updates.checkForUpdateAsync();
    if (!result.isAvailable) {
      reportMessage("[ota] no update", { op: "ota.check", isAvailable: false });
      return;
    }
    // Download only — staged for the next cold launch. Never reloadAsync().
    await Updates.fetchUpdateAsync();
    reportMessage("[ota] update staged", { op: "ota.fetch", isAvailable: true });
  } catch (e) {
    // No update, no network, or fetch failed — keep the current bundle.
    reportError(e, { op: "ota.check" });
  }
}
