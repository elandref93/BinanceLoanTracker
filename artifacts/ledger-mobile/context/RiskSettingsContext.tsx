import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  listContainers,
  subscribe,
  type StoredContainer,
} from "@/lib/accountStore";
import { DEFAULT_TARGET_LTV, WARNING_LTV } from "@/utils/risk";

interface RiskSettingsCtx {
  /**
   * Global default target. Used as the fallback for any account that hasn't
   * set its own target, and as the seed when a per-account target is created.
   */
  targetLtv: number;
  setTargetLtv: (n: number) => void;
  /** Per-account (Personal/Trust container) target overrides. */
  targetForContainer: (containerId: string | null | undefined) => number;
  /** Resolve a loan's account target from its exchange-link accountId. */
  targetForAccountId: (accountId: string | null | undefined) => number;
  setTargetForContainer: (containerId: string, n: number) => void;
  /** Which Personal/Trust container owns a given exchange-link accountId. */
  containerForAccountId: (
    accountId: string | null | undefined,
  ) => StoredContainer | undefined;
  containers: StoredContainer[];
  refreshContainers: () => Promise<void>;
}

const Ctx = createContext<RiskSettingsCtx | null>(null);
const KEY = "ledger.targetLtv";
const OVERRIDES_KEY = "ledger.targetLtv.byContainer.v1";

export const MIN_TARGET_LTV = 30;
// Cap the user-configurable target below Binance's margin-call threshold so
// the "target" can never be set into the danger zone.
export const MAX_TARGET_LTV = WARNING_LTV - 1;

function clampTarget(n: number): number {
  return Math.min(MAX_TARGET_LTV, Math.max(MIN_TARGET_LTV, Math.round(n)));
}

export function RiskSettingsProvider({ children }: { children: React.ReactNode }) {
  const [targetLtv, setLocal] = useState<number>(DEFAULT_TARGET_LTV);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [containers, setContainers] = useState<StoredContainer[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(KEY).then((v) => {
      const n = v ? Number(v) : NaN;
      if (Number.isFinite(n) && n >= MIN_TARGET_LTV && n <= MAX_TARGET_LTV) {
        setLocal(n);
      }
    });
    AsyncStorage.getItem(OVERRIDES_KEY).then((raw) => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as Record<string, number>;
        if (parsed && typeof parsed === "object") setOverrides(parsed);
      } catch {
        // ignore corrupt blob — fall back to defaults
      }
    });
  }, []);

  const refreshContainers = useCallback(async () => {
    setContainers(await listContainers());
  }, []);

  // Reload on mount AND whenever the account store mutates (add/remove
  // account or exchange link) so per-account targets, chips, and scopes
  // never serve a stale container list within a session.
  useEffect(() => {
    void refreshContainers();
    return subscribe(() => {
      void refreshContainers();
    });
  }, [refreshContainers]);

  const setTargetLtv = useCallback((n: number) => {
    const clamped = clampTarget(n);
    setLocal(clamped);
    AsyncStorage.setItem(KEY, String(clamped));
  }, []);

  const setTargetForContainer = useCallback((containerId: string, n: number) => {
    const clamped = clampTarget(n);
    setOverrides((prev) => {
      const next = { ...prev, [containerId]: clamped };
      AsyncStorage.setItem(OVERRIDES_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const targetForContainer = useCallback(
    (containerId: string | null | undefined) => {
      if (containerId && overrides[containerId] != null) {
        return overrides[containerId];
      }
      return targetLtv;
    },
    [overrides, targetLtv],
  );

  const containerForAccountId = useCallback(
    (accountId: string | null | undefined) => {
      if (!accountId) return undefined;
      return containers.find((c) => c.links.some((l) => l.id === accountId));
    },
    [containers],
  );

  const targetForAccountId = useCallback(
    (accountId: string | null | undefined) => {
      const c = containerForAccountId(accountId);
      return targetForContainer(c?.id);
    },
    [containerForAccountId, targetForContainer],
  );

  const value = useMemo(
    () => ({
      targetLtv,
      setTargetLtv,
      targetForContainer,
      targetForAccountId,
      setTargetForContainer,
      containerForAccountId,
      containers,
      refreshContainers,
    }),
    [
      targetLtv,
      setTargetLtv,
      targetForContainer,
      targetForAccountId,
      setTargetForContainer,
      containerForAccountId,
      containers,
      refreshContainers,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTargetLtv(): number {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTargetLtv must be used inside RiskSettingsProvider");
  return v.targetLtv;
}

export function useRiskSettings(): RiskSettingsCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useRiskSettings must be used inside RiskSettingsProvider");
  return v;
}
