/**
 * Strategy scenarios sync at `GET/PUT /api/scenarios/sync`.
 *
 * The phone keeps the same list in AsyncStorage at
 * `ledger.leverageScenarios.v1:<userId>`. Settings sync cannot hold it: the
 * phone rebuilds that blob from currency, LTV targets, and alert rules, then
 * replaces the whole document. Account sync is the profile list. Annotation
 * sync is a loan-id map. Web reads and writes the scenario blob only, and
 * does not keep these drafts in localStorage.
 */
import type { LeverageInputs, TaxMode } from "@/domain/leverageSim";
import { DEFAULT_INPUTS } from "@/domain/leverageSim";

export const DRAFT_NOT_SAVED =
  "This calculation stays on this page until you save it. It is not stored in this browser.";

const TAX_MODES = new Set<TaxMode>(["personal", "trust", "taxfree"]);

const NUMERIC_KEYS = [
  "btcGrowth",
  "optionsReturn",
  "ltv",
  "borrowCost",
  "startingCapital",
  "monthlyContrib",
  "contribEscalation",
  "years",
  "startMonth",
  "rebalanceMonth",
] as const satisfies readonly (keyof LeverageInputs)[];

export type SavedScenarioRef = {
  id: string;
  name: string;
};

export function isScenarioRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function namedScenarios(payload: unknown): Array<{ id: string; name: string; inputs: unknown }> {
  if (!Array.isArray(payload)) return [];
  const out: Array<{ id: string; name: string; inputs: unknown }> = [];
  for (const item of payload) {
    if (!isScenarioRecord(item)) continue;
    if (typeof item.id !== "string" || typeof item.name !== "string") continue;
    out.push({ id: item.id, name: item.name, inputs: item.inputs });
  }
  return out;
}

/** Copy known simulator fields. Extra keys stay on the stored object for the next save. */
export function formInputsFromStored(stored: unknown): LeverageInputs {
  const next: LeverageInputs = { ...DEFAULT_INPUTS };
  if (!isScenarioRecord(stored)) return next;
  for (const key of NUMERIC_KEYS) {
    const value = stored[key];
    if (typeof value === "number" && Number.isFinite(value)) next[key] = value;
  }
  if (typeof stored.taxMode === "string" && TAX_MODES.has(stored.taxMode as TaxMode)) {
    next.taxMode = stored.taxMode as TaxMode;
  }
  return next;
}

export function newScenarioId(nowMs: number = Date.now()): string {
  return `scn_${nowMs}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Insert or replace one scenario inside the stored list. Sibling items and
 * unknown fields on the edited scenario are copied through.
 */
export function saveScenarioInList(
  payload: unknown,
  input: { id?: string; name: string; inputs: LeverageInputs; now: string },
): { scenarios: unknown[]; saved: SavedScenarioRef } {
  const list = Array.isArray(payload) ? payload.slice() : [];
  if (input.id) {
    const idx = list.findIndex((item) => isScenarioRecord(item) && item.id === input.id);
    if (idx >= 0) {
      const prev = list[idx] as Record<string, unknown>;
      const prevInputs = isScenarioRecord(prev.inputs) ? prev.inputs : {};
      list[idx] = {
        ...prev,
        name: input.name,
        inputs: { ...prevInputs, ...input.inputs },
        updatedAt: input.now,
      };
      return { scenarios: list, saved: { id: input.id, name: input.name } };
    }
  }
  const id = input.id && input.id.length > 0 ? input.id : newScenarioId();
  list.unshift({
    id,
    name: input.name,
    inputs: { ...input.inputs },
    createdAt: input.now,
    updatedAt: input.now,
  });
  return { scenarios: list, saved: { id, name: input.name } };
}

export function deleteScenarioFromList(payload: unknown, id: string): unknown[] {
  if (!Array.isArray(payload)) return [];
  return payload.filter((item) => !(isScenarioRecord(item) && item.id === id));
}
