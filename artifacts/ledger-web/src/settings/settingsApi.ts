import { putAccountSync, putSettingsSync } from "@workspace/api-client-react";

import { errorStatus, toAccountSyncBody, type SyncContainer } from "@/accounts/accountModel";
import {
  classifyAccountSync,
  classifySettingsWrite,
  hasExchangeLink,
  settingsSyncBody,
  type SettingsSaveOutcome,
  type SyncNowOutcome,
} from "@/domain/settingsView";

export async function saveSettings(settings: Record<string, unknown>): Promise<SettingsSaveOutcome> {
  try {
    await putSettingsSync(settingsSyncBody(settings));
    return classifySettingsWrite(200);
  } catch (error) {
    return classifySettingsWrite(errorStatus(error));
  }
}

/** Re-upload account metadata with no client timestamp. A 409 is returned to the caller. */
export async function syncAccountsNow(containers: SyncContainer[]): Promise<SyncNowOutcome> {
  if (!hasExchangeLink(containers)) return classifyAccountSync(false, null);
  try {
    await putAccountSync(toAccountSyncBody(containers));
    return classifyAccountSync(true, 200);
  } catch (error) {
    return classifyAccountSync(true, errorStatus(error));
  }
}
