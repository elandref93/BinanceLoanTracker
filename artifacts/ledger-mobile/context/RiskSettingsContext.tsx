import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { DEFAULT_TARGET_LTV, WARNING_LTV } from "@/utils/risk";

interface RiskSettingsCtx {
  targetLtv: number;
  setTargetLtv: (n: number) => void;
}

const Ctx = createContext<RiskSettingsCtx | null>(null);
const KEY = "ledger.targetLtv";

export const MIN_TARGET_LTV = 30;
// Cap the user-configurable target below Binance's margin-call threshold so
// the "target" can never be set into the danger zone.
export const MAX_TARGET_LTV = WARNING_LTV - 1;

export function RiskSettingsProvider({ children }: { children: React.ReactNode }) {
  const [targetLtv, setLocal] = useState<number>(DEFAULT_TARGET_LTV);

  useEffect(() => {
    AsyncStorage.getItem(KEY).then((v) => {
      const n = v ? Number(v) : NaN;
      if (Number.isFinite(n) && n >= MIN_TARGET_LTV && n <= MAX_TARGET_LTV) {
        setLocal(n);
      }
    });
  }, []);

  const setTargetLtv = useCallback((n: number) => {
    const clamped = Math.min(MAX_TARGET_LTV, Math.max(MIN_TARGET_LTV, Math.round(n)));
    setLocal(clamped);
    AsyncStorage.setItem(KEY, String(clamped));
  }, []);

  const value = useMemo(() => ({ targetLtv, setTargetLtv }), [targetLtv, setTargetLtv]);
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
