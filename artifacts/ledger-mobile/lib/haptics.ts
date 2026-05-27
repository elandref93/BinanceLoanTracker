import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

function safe(fn: () => Promise<unknown> | unknown): void {
  if (Platform.OS === "web") return;
  try {
    void fn();
  } catch {
    // ignore — haptics are best-effort
  }
}

export const haptic = {
  /** Light feedback for taps on chips, toggles, list rows. */
  tap(): void {
    safe(() => Haptics.selectionAsync());
  },
  /** Medium impact for confirming an action (save, refresh started). */
  impact(): void {
    safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
  },
  /** Heavy impact for destructive confirmations. */
  heavy(): void {
    safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy));
  },
  /** Success notification (refresh completed, account added). */
  success(): void {
    safe(() =>
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
    );
  },
  /** Warning notification (LTV crossed threshold, retry-able failure). */
  warning(): void {
    safe(() =>
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
    );
  },
  /** Error notification (refresh failed, save rejected). */
  error(): void {
    safe(() =>
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
    );
  },
};
