import { getSettingsSync, putSettingsSync } from "@workspace/api-client-react";

import { errorStatus } from "@/accounts/accountModel";
import {
  deleteStoredRule,
  upsertStoredRule,
  type AlertRule,
} from "@/domain/alertRules";

/** Same cache key the loan page uses for the settings blob. */
export const settingsSyncQueryKey = ["settings-sync"] as const;

export async function loadSettings(): Promise<unknown> {
  try {
    const record = await getSettingsSync();
    return record.settings;
  } catch (error) {
    if (errorStatus(error) === 404) return {};
    throw error;
  }
}

export type AlertSaveResult =
  | { ok: true }
  | { ok: false; conflict: true }
  | { ok: false; conflict: false; message: string };

/**
 * Web writes omit `updatedAt` so the server assigns the clock. The payload is
 * the full settings object with alert rules replaced, so currency and LTV
 * targets already stored by the phone stay in the blob.
 */
async function putSettings(settings: Record<string, unknown>): Promise<AlertSaveResult> {
  try {
    await putSettingsSync({ settings });
    return { ok: true };
  } catch (error) {
    if (errorStatus(error) === 409) return { ok: false, conflict: true };
    return { ok: false, conflict: false, message: "Could not save alert rules." };
  }
}

export async function saveAlertRule(rule: AlertRule): Promise<AlertSaveResult> {
  try {
    const current = await loadSettings();
    return putSettings(upsertStoredRule(current, rule));
  } catch {
    return { ok: false, conflict: false, message: "Could not save alert rules." };
  }
}

export async function removeAlertRule(id: string): Promise<AlertSaveResult> {
  try {
    const current = await loadSettings();
    return putSettings(deleteStoredRule(current, id));
  } catch {
    return { ok: false, conflict: false, message: "Could not save alert rules." };
  }
}
