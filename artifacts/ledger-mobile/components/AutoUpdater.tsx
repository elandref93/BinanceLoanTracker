import * as Updates from "expo-updates";
import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";

import { checkAndApplyUpdate } from "@/lib/otaUpdates";

/** Past the native cold-start window where reloadAsync can race ON_LOAD. */
const LAUNCH_CHECK_DELAY_MS = 2500;
/** Never block launch on a slow/offline update server. */
const LAUNCH_CHECK_TIMEOUT_MS = 15_000;

interface Props {
  /**
   * Called once the launch-time OTA pass finishes without reloading (no update,
   * check failed, or timed out). The root layout uses this to dismiss the
   * splash so the user never flashes the old bundle before an update reload.
   */
  onLaunchReady?: () => void;
}

/**
 * Headless over-the-air auto-updater. Keeps the app on the latest published
 * bundle with ZERO user interaction — no banner, no prompt, no "close &
 * reopen":
 *
 *   - On launch (after a short delay past the native ON_LOAD check) it checks
 *     for a newer bundle, downloads it, and reloads straight into it while the
 *     splash is still up — so updates land before the user sees the UI.
 *   - Whenever the app returns to the foreground it downloads AND reloads into
 *     a newer bundle on the spot, so in-session updates apply immediately
 *     without the user doing anything.
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
    if (__DEV__ || !Updates.isEnabled) {
      signalLaunchReady();
      return;
    }

    let cancelled = false;

    const runLaunchCheck = async () => {
      await new Promise((r) => setTimeout(r, LAUNCH_CHECK_DELAY_MS));
      if (cancelled) return;

      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        signalLaunchReady();
      }, LAUNCH_CHECK_TIMEOUT_MS);

      try {
        await checkAndApplyUpdate({ reload: true });
      } finally {
        clearTimeout(timeout);
        // reloadAsync never returns; if we get here there was no reload.
        if (!cancelled && !timedOut) {
          signalLaunchReady();
        }
      }
    };

    void runLaunchCheck();

    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      const previous = appState.current;
      appState.current = next;
      // Only on a genuine background -> active transition: the app is fully
      // initialised here, so reloading is safe and the timing feels natural.
      if (
        (previous === "background" || previous === "inactive") &&
        next === "active"
      ) {
        void checkAndApplyUpdate({ reload: true });
      }
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [onLaunchReady]);

  return null;
}
