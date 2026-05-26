import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import {
  addAccount,
  validateBinanceKey,
  validateBinanceSecret,
} from "@/lib/binanceKeys";

export default function AddAccountScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();

  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [revealSecret, setRevealSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSave = async () => {
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Give this account a name (e.g. \"Main\")");
      return;
    }
    const keyErr = validateBinanceKey(apiKey);
    if (keyErr) return setError(keyErr);
    const secretErr = validateBinanceSecret(apiSecret);
    if (secretErr) return setError(secretErr);

    setBusy(true);
    try {
      await addAccount({ name: trimmedName, apiKey, apiSecret });
      if (Platform.OS !== "web") {
        await Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        );
      }
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const onCancel = () => {
    if (!name && !apiKey && !apiSecret) {
      router.back();
      return;
    }
    Alert.alert("Discard?", "Your entries will be lost.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => router.back() },
    ]);
  };

  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/(auth)/sign-in" />;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom + 24,
          paddingHorizontal: 16,
          gap: 20,
        }}
      >
        <View style={styles.header}>
          <Pressable onPress={onCancel} hitSlop={12}>
            <Text style={[styles.headerBtn, { color: colors.mutedForeground }]}>
              Cancel
            </Text>
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            Add account
          </Text>
          <Pressable onPress={onSave} disabled={busy} hitSlop={12}>
            {busy ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Text style={[styles.headerBtn, { color: colors.primary }]}>
                Save
              </Text>
            )}
          </Pressable>
        </View>

        <View
          style={[
            styles.notice,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: colors.radius,
            },
          ]}
        >
          <Feather name="shield" size={16} color={colors.primary} />
          <Text style={[styles.noticeText, { color: colors.mutedForeground }]}>
            Use a read-only API key. Keys are encrypted in the iOS Keychain on
            this device and never leave it.
          </Text>
        </View>

        <Field label="Name" hint="A label only you see">
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Main"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="words"
            style={[
              styles.input,
              {
                color: colors.foreground,
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: colors.radius,
              },
            ]}
          />
        </Field>

        <Field label="API key">
          <TextInput
            value={apiKey}
            onChangeText={setApiKey}
            placeholder="64-character key from Binance"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            multiline
            style={[
              styles.input,
              styles.mono,
              {
                color: colors.foreground,
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: colors.radius,
                minHeight: 64,
              },
            ]}
          />
        </Field>

        <Field label="API secret">
          <View style={{ position: "relative" }}>
            <TextInput
              value={apiSecret}
              onChangeText={setApiSecret}
              placeholder="64-character secret from Binance"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              multiline={revealSecret}
              secureTextEntry={!revealSecret}
              style={[
                styles.input,
                revealSecret ? styles.mono : null,
                {
                  color: colors.foreground,
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  borderRadius: colors.radius,
                  paddingRight: 44,
                  minHeight: revealSecret ? 64 : undefined,
                },
              ]}
            />
            <Pressable
              onPress={() => setRevealSecret((v) => !v)}
              style={styles.eye}
              hitSlop={8}
            >
              <Feather
                name={revealSecret ? "eye-off" : "eye"}
                size={18}
                color={colors.mutedForeground}
              />
            </Pressable>
          </View>
        </Field>

        {error ? (
          <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>
        ) : null}

        <Text style={[styles.fine, { color: colors.mutedForeground }]}>
          Create a key at binance.com → API Management. Permissions: enable
          only “Read Info”. Restrict to your IP if you can.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>
        {label.toUpperCase()}
      </Text>
      {children}
      {hint ? (
        <Text style={[styles.hint, { color: colors.mutedForeground }]}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
  },
  headerBtn: { fontSize: 15, fontFamily: "Inter_500Medium" },
  headerTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  notice: {
    flexDirection: "row",
    gap: 10,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "flex-start",
  },
  noticeText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: "Inter_400Regular",
  },
  label: { fontSize: 10, letterSpacing: 1, fontFamily: "Inter_600SemiBold" },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  mono: { fontFamily: "Inter_400Regular", fontVariant: ["tabular-nums"] },
  eye: { position: "absolute", right: 12, top: 14, padding: 4 },
  hint: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  error: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
  },
  fine: {
    fontSize: 11,
    lineHeight: 16,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
});
