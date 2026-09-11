import Constants, { ExecutionEnvironment } from "expo-constants";

const DEFAULT_BACKEND_HOST = "binance-loan-tracker-backend.azurewebsites.net";

/** True when running inside the Expo Go client (not a standalone/TestFlight build). */
export function isExpoGo(): boolean {
  return (
    Constants.appOwnership === "expo" ||
    Constants.executionEnvironment === ExecutionEnvironment.StoreClient
  );
}

/** Backend hostname the app syncs against (without scheme). */
export function backendHost(): string {
  return process.env.EXPO_PUBLIC_DOMAIN || DEFAULT_BACKEND_HOST;
}

/** HTTPS origin for `/api/*` calls. */
export function backendBaseUrl(): string {
  return `https://${backendHost()}`;
}

/** Backend hostname the app syncs against (without scheme). */
export function syncBackendDomain(): string {
  return backendHost();
}
