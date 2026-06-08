import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";

import { checkAndApplyUpdate } from "@/lib/otaUpdates";

/**
 * Headless over-the-air auto-updater. Keeps the app on the latest published
 * bundle with ZERO user interaction — no banner, no prompt, no "close &
 * reopen":
 *
 *   - Shortly after launch (deferred past the native cold-start window so it
 *     never races expo-updates' own ON_LOAD check) it stages any newer bundle.
 *     A staged bundle applies on the next cold launch automatically.
 *   - Whenever the app returns to the foreground it downloads AND reloads into
 *     a newer bundle on the spot, so in-session updates apply immediately
 *     without the user doing anything.
 *
 * Renders nothing. A no-op in development / Expo Go.
 */
export function AutoUpdater(): null {
  const appState = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    // Initial pass stages only (reload: false). Reloading right after the user
    // just opened the app would be jarring, and the native ON_LOAD path already
    // applies a previously-staged bundle on cold launch.
    const initial = setTimeout(() => {
      void checkAndApplyUpdate();
    }, 3000);

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
      clearTimeout(initial);
      sub.remove();
    };
  }, []);

  return null;
}
