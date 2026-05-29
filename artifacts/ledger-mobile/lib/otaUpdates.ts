import * as Updates from "expo-updates";

/**
 * Check for a newer over-the-air (EAS Update) JS bundle and, if one is
 * available, download it and reload the app into it.
 *
 * Safe to call anywhere: it is a no-op in development / Expo Go (where
 * `Updates.isEnabled` is false) and swallows network errors so a failed or
 * offline check never blocks the user. The persisted session survives the
 * reload, so the user stays signed in after an update is applied.
 */
export async function checkAndApplyUpdate(): Promise<void> {
  if (__DEV__ || !Updates.isEnabled) return;
  try {
    const result = await Updates.checkForUpdateAsync();
    if (!result.isAvailable) return;
    await Updates.fetchUpdateAsync();
    await Updates.reloadAsync();
  } catch {
    // No update, no network, or fetch failed — keep the current bundle.
  }
}
