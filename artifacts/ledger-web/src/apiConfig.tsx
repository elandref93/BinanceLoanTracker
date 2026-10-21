import { createContext, useContext, type ReactNode } from "react";

import type { WebEnv } from "@/env";

const ApiConfigContext = createContext<WebEnv>({
  apiBaseUrl: "",
});

export function ApiConfigProvider(props: { value: WebEnv; children: ReactNode }) {
  return <ApiConfigContext.Provider value={props.value}>{props.children}</ApiConfigContext.Provider>;
}

export function useApiConfig(): WebEnv {
  return useContext(ApiConfigContext);
}
