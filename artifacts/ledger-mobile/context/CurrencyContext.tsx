import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { initFxRate } from "@/lib/fxRate";
import { pushSettings, subscribeSettings } from "@/lib/settingsStore";

export type Currency = "USD" | "ZAR";

interface CurrencyCtx {
  currency: Currency;
  usdToZar: number;
  toggle: () => void;
  set: (c: Currency) => void;
}

const Ctx = createContext<CurrencyCtx | null>(null);
const KEY = "ledger.currency";

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [currency, setCurrency] = useState<Currency>("USD");
  const [usdToZar, setRate] = useState(18.5);

  const reload = useCallback(() => {
    AsyncStorage.getItem(KEY).then((v) => {
      if (v === "USD" || v === "ZAR") setCurrency(v);
    });
  }, []);

  // Load on mount AND whenever a remote settings hydrate replaces local
  // storage, so a second device reflects the synced currency.
  useEffect(() => {
    reload();
    return subscribeSettings(reload);
  }, [reload]);

  // Hydrate the live USD→ZAR rate (cached first, then fresh). Each applied
  // value bumps state so money displays re-render with the latest rate.
  useEffect(() => {
    void initFxRate(setRate);
  }, []);

  const set = useCallback((c: Currency) => {
    setCurrency(c);
    AsyncStorage.setItem(KEY, c).then(() => {
      void pushSettings();
    });
  }, []);

  const toggle = useCallback(() => {
    set(currency === "USD" ? "ZAR" : "USD");
  }, [currency, set]);

  const value = useMemo(
    () => ({ currency, usdToZar, toggle, set }),
    [currency, usdToZar, toggle, set],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCurrency(): CurrencyCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCurrency must be used inside CurrencyProvider");
  return v;
}
