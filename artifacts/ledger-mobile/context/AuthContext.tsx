import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

type AuthState = "loading" | "out" | "in";

interface AuthCtx {
  state: AuthState;
  email: string | null;
  signIn: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

const KEY = "ledger.auth.email";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>("loading");
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(KEY).then((v) => {
      setEmail(v);
      setState(v ? "in" : "out");
    });
  }, []);

  const signIn = useCallback(async (e: string) => {
    await AsyncStorage.setItem(KEY, e);
    setEmail(e);
    setState("in");
  }, []);

  const signOut = useCallback(async () => {
    await AsyncStorage.removeItem(KEY);
    setEmail(null);
    setState("out");
  }, []);

  const value = useMemo(
    () => ({ state, email, signIn, signOut }),
    [state, email, signIn, signOut],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}
