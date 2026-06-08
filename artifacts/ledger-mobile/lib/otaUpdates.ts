import * as Updates from "expo-updates";

import { reportError, reportMessage } from "@/lib/crashReporting";

let inFlight = false;

/**
 * Check for a newer over-the-air (EAS Update) JS bundle. If one is available it
 * is downloaded, and when `reload` is requested the app restarts straight into
 * it — so updates land with zero user interaction (no banner, no prompt, no
 * "close & reopen"). Without `reload` the bundle is merely staged and applies
 * on the next cold launch via `checkAutomatically: ON_LOAD`.
 *
 * Why `reloadAsync()` is safe here (it used to crash on this stack):
 *   - The New-Architecture iOS reload crash was fixed upstream
 *     (expo/expo#31789) and that fix ships in our expo-updates ~29 / SDK 54
 *     binary.
 *   - The *other* documented crash (expo/expo#21347) only happens when the
 *     Updates API is exercised during the cold-start window, racing the native
 *     ON_LOAD check. We therefore NEVER reload at startup — callers only pass
 *     `reload: true` once the app is fully running (on a delay / on foreground
 *     return). See `components/AutoUpdater`.
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
  try {
    const result = await Updates.checkForUpdateAsync();
    if (!result.isAvailable) {
      reportMessage("[ota] no update", { op: "ota.check", isAvailable: false });
      return;
    }
    // Download the new bundle to disk.
    await Updates.fetchUpdateAsync();
    reportMessage("[ota] update fetched", {
      op: "ota.fetch",
      isAvailable: true,
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
