import Constants from "expo-constants";

/** True when running inside the Expo Go client (not a standalone/TestFlight build). */
export function isExpoGo(): boolean {
  return Constants.appOwnership === "expo";
}

/** Backend hostname the app syncs against (without scheme). */
export function syncBackendDomain(): string {
  return process.env.EXPO_PUBLIC_DOMAIN ?? "(not set)";
}
