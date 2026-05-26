import { Feather } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";
import {
  authenticateAppLock,
  isAppLockEnabled,
} from "@/lib/appLock";

const RELOCK_AFTER_MS = 30_000;

/**
 * Wraps the app and shows a Face ID / passcode lock screen on launch and
 * whenever the app is backgrounded for >30s. No-op when the user hasn't
 * enabled the lock in Settings.
 */
export function AppLockGate({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  // `null` = unknown (still loading the pref), true = locked, false = unlocked
  const [locked, setLocked] = useState<boolean | null>(null);
  const [authInFlight, setAuthInFlight] = useState(false);
  const backgroundedAt = useRef<number | null>(null);

  // Initial check on mount.
  useEffect(() => {
    isAppLockEnabled().then((enabled) => {
      setLocked(enabled);
    });
  }, []);

  // Re-lock when returning to the foreground after a meaningful absence.
  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      if (next === "background" || next === "inactive") {
        backgroundedAt.current = Date.now();
      } else if (next === "active") {
        const since = backgroundedAt.current;
        backgroundedAt.current = null;
        if (since && Date.now() - since >= RELOCK_AFTER_MS) {
          isAppLockEnabled().then((enabled) => {
            if (enabled) setLocked(true);
          });
        }
      }
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, []);

  const unlock = async () => {
    if (authInFlight) return;
    setAuthInFlight(true);
    try {
      const ok = await authenticateAppLock();
      if (ok) setLocked(false);
    } finally {
      setAuthInFlight(false);
    }
  };

  // Auto-prompt as soon as we know we're locked.
  useEffect(() => {
    if (locked === true && !authInFlight) {
      void unlock();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked]);

  if (locked === null) {
    return (
      <View
        style={[styles.center, { backgroundColor: colors.background }]}
      />
    );
  }

  if (locked === false) {
    return <>{children}</>;
  }

  return (
    <View style={[styles.center, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.iconWrap,
          { borderColor: colors.border, borderRadius: 20 },
        ]}
      >
        <Feather name="lock" size={28} color={colors.primary} />
      </View>
      <Text style={[styles.title, { color: colors.foreground }]}>Ledger</Text>
      <Text style={[styles.sub, { color: colors.mutedForeground }]}>
        Locked — authenticate to continue
      </Text>
      <Pressable
        onPress={unlock}
        disabled={authInFlight}
        style={({ pressed }) => [
          styles.btn,
          {
            backgroundColor: colors.primary,
            borderRadius: colors.radius,
            opacity: pressed || authInFlight ? 0.7 : 1,
          },
        ]}
      >
        {authInFlight ? (
          <ActivityIndicator color={colors.primaryForeground} />
        ) : (
          <Text style={[styles.btnText, { color: colors.primaryForeground }]}>
            Unlock
          </Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    paddingHorizontal: 24,
  },
  iconWrap: {
    width: 64,
    height: 64,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  title: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  sub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginTop: -8,
  },
  btn: {
    marginTop: 8,
    paddingHorizontal: 32,
    paddingVertical: 14,
    minWidth: 180,
    alignItems: "center",
  },
  btnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
});
