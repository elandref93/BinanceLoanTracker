import * as Updates from "expo-updates";
import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";

import { checkAndApplyUpdate } from "@/lib/otaUpdates";

interface Props {
  /**
   * Called once the launch-time OTA pass finishes without reloading (no update,
   * check failed, or timed out). The root layout uses this to dismiss the
   * splash so the user never flashes the old bundle before an update reload.
   */
  onLaunchReady?: () => void;
}

/**
 * Headless over-the-air updater. Stages a newer JS bundle if one exists, but
 * never activates it in-process.
 *
 * `Updates.reloadAsync()` (and cold-start activation of a just-downloaded
 * update) aborts natively on iOS 26 via expo-updates ErrorRecovery — TestFlight
 * SIGABRT with no JS/Sentry frame. Stage only; the next cold launch can pick
 * the bundle up once activation is safe.
 *
 * Renders nothing. A no-op in development / Expo Go.
 */
export function AutoUpdater({ onLaunchReady }: Props): null {
  const appState = useRef<AppStateStatus>(AppState.currentState);
  const launchReadyCalled = useRef(false);

  const signalLaunchReady = () => {
    if (launchReadyCalled.current) return;
    launchReadyCalled.current = true;
    onLaunchReady?.();
  };

  useEffect(() => {
    signalLaunchReady();
    if (__DEV__ || !Updates.isEnabled) {
      return;
    }

    void checkAndApplyUpdate({ reload: false });

    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      const previous = appState.current;
      appState.current = next;
      if (
        (previous === "background" || previous === "inactive") &&
        next === "active"
      ) {
        void checkAndApplyUpdate({ reload: false });
      }
    });

    return () => {
      sub.remove();
    };
  }, [onLaunchReady]);

  return null;
}
