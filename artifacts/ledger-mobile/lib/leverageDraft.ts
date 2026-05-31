/**
 * Per-user "working draft" for the BTC-Leverage calculator.
 *
 * Unlike named scenarios (lib/leverageScenarios.ts), this is the unsaved,
 * in-progress state of the calculator — the current inputs, the account it is
 * scoped to, and the borrow-cost mode. It is persisted locally per signed-in
 * user (key suffixed with the user id) and restored on the next sign-in so an
 * in-progress calculation is never lost when the user signs out.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import type { LeverageInputs } from "@/lib/leverageSim";

const KEY_PREFIX = "ledger.leverageDraft.v1:";

export type LeverageDraft = {
  inputs: LeverageInputs;
  accountFilter: string | null;
  borrowAuto?: boolean;
};

function keyFor(userId: string | null | undefined): string {
  return `${KEY_PREFIX}${userId ?? "anon"}`;
}

export async function loadDraft(
  userId: string | null | undefined,
): Promise<LeverageDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object" && obj.inputs) {
      return obj as LeverageDraft;
    }
    return null;
  } catch {
    return null;
  }
}

export async function saveDraft(
  userId: string | null | undefined,
  draft: LeverageDraft,
): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(userId), JSON.stringify(draft));
  } catch {
    // best-effort
  }
}
