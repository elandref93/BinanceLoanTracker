/**
 * Per-user storage for BTC-Leverage scenarios.
 *
 * Scoping: the storage key is suffixed with the signed-in user id so each
 * Apple-Sign-In account has its own scenario list. Free-form — taxMode is
 * just a field on the scenario, not derived from any profile.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

import type { LeverageInputs } from "@/lib/leverageSim";

const KEY_PREFIX = "ledger.leverageScenarios.v1:";

export type Scenario = {
  id: string;
  name: string;
  inputs: LeverageInputs;
  createdAt: string;
  updatedAt: string;
};

function keyFor(userId: string | null | undefined): string {
  return `${KEY_PREFIX}${userId ?? "anon"}`;
}

function genId(): string {
  return `scn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const listeners = new Map<string, Set<() => void>>();
function notify(userId: string | null | undefined): void {
  const key = keyFor(userId);
  const ls = listeners.get(key);
  if (ls) for (const fn of ls) fn();
}
function subscribe(
  userId: string | null | undefined,
  fn: () => void,
): () => void {
  const key = keyFor(userId);
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(fn);
  return () => {
    set?.delete(fn);
  };
}

export async function listScenarios(
  userId: string | null | undefined,
): Promise<Scenario[]> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as Scenario[]) : [];
  } catch {
    return [];
  }
}

async function writeAll(
  userId: string | null | undefined,
  scenarios: Scenario[],
): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(userId), JSON.stringify(scenarios));
    notify(userId);
  } catch {
    // best-effort
  }
}

export async function saveScenario(
  userId: string | null | undefined,
  input: { id?: string; name: string; inputs: LeverageInputs },
): Promise<Scenario> {
  const all = await listScenarios(userId);
  const now = new Date().toISOString();
  if (input.id) {
    const idx = all.findIndex((s) => s.id === input.id);
    if (idx >= 0) {
      const updated: Scenario = {
        ...all[idx],
        name: input.name,
        inputs: input.inputs,
        updatedAt: now,
      };
      all[idx] = updated;
      await writeAll(userId, all);
      return updated;
    }
  }
  const created: Scenario = {
    id: input.id ?? genId(),
    name: input.name,
    inputs: input.inputs,
    createdAt: now,
    updatedAt: now,
  };
  all.unshift(created);
  await writeAll(userId, all);
  return created;
}

export async function deleteScenario(
  userId: string | null | undefined,
  id: string,
): Promise<void> {
  const all = await listScenarios(userId);
  await writeAll(
    userId,
    all.filter((s) => s.id !== id),
  );
}

/** React hook returning the current user's scenarios with live updates. */
export function useScenarios(userId: string | null | undefined): {
  scenarios: Scenario[];
  loading: boolean;
  reload: () => Promise<void>;
} {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    const list = await listScenarios(userId);
    setScenarios(list);
    setLoading(false);
  };

  useEffect(() => {
    setLoading(true);
    void reload();
    return subscribe(userId, () => {
      void reload();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return { scenarios, loading, reload };
}
