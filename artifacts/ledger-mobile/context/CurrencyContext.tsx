import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type Currency = "USD" | "ZAR";

interface CurrencyCtx {
  currency: Currency;
  toggle: () => void;
  set: (c: Currency) => void;
}

const Ctx = createContext<CurrencyCtx | null>(null);
const KEY = "ledger.currency";

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [currency, setCurrency] = useState<Currency>("USD");

  useEffect(() => {
    AsyncStorage.getItem(KEY).then((v) => {
      if (v === "USD" || v === "ZAR") setCurrency(v);
    });
  }, []);

  const set = useCallback((c: Currency) => {
    setCurrency(c);
    AsyncStorage.setItem(KEY, c);
  }, []);

  const toggle = useCallback(() => {
    set(currency === "USD" ? "ZAR" : "USD");
  }, [currency, set]);

  const value = useMemo(
    () => ({ currency, toggle, set }),
    [currency, toggle, set],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCurrency(): CurrencyCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCurrency must be used inside CurrencyProvider");
  return v;
}
