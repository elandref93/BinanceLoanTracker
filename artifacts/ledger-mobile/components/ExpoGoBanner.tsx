import { Feather } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { isExpoGo } from "@/lib/runtime";
import type { AppleLinkWarning } from "@/lib/session";

const DEFAULT_MESSAGE =
  "This is Expo Go — Apple Sign In will fail here. Close Expo Go, open the Ledger development app, and connect to http://192.168.211.61:8081 (do not use exp://, that reopens Expo Go).";

const EMAIL_NOT_SHARED_MESSAGE =
  "Apple did not share an email this time. You can still use Expo Go — share your email on the next prompt if you want TestFlight accounts to sync.";

const PRIVATE_RELAY_MESSAGE =
  "Hide My Email can keep Expo Go and TestFlight from matching. You can still use Expo Go — share your real email next time if you want them linked.";

export function ExpoGoBanner({
  linkWarning,
  signedIn = false,
}: {
  linkWarning?: AppleLinkWarning | null;
  signedIn?: boolean;
}) {
  const colors = useColors();
  if (!isExpoGo()) return null;
  // Signed-in and linked: nothing to warn about — don't block the flow.
  if (signedIn && !linkWarning) return null;

  const message =
    linkWarning === "email_not_shared"
      ? EMAIL_NOT_SHARED_MESSAGE
      : linkWarning === "private_relay_unlinked"
        ? PRIVATE_RELAY_MESSAGE
        : DEFAULT_MESSAGE;

  const isProblem = Boolean(linkWarning);

  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: colors.card,
          borderColor: isProblem ? colors.danger : colors.border,
          borderRadius: colors.radius,
        },
      ]}
    >
      <Feather
        name={isProblem ? "alert-circle" : "info"}
        size={16}
        color={isProblem ? colors.danger : colors.mutedForeground}
      />
      <Text style={[styles.text, { color: colors.foreground }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    gap: 10,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "flex-start",
  },
  text: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: "Inter_500Medium",
  },
});
