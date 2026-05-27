import { Feather } from "@expo/vector-icons";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import { haptic } from "@/lib/haptics";
import { useEffect, useState } from "react";
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

import { QRScanner } from "@/components/QRScanner";
import { useColors } from "@/hooks/useColors";
import { useSession } from "@/context/SessionContext";
import {
  addLink,
  listContainers,
  type ExchangeKind,
  type StoredContainer,
} from "@/lib/accountStore";
import {
  validateBinanceKey,
  validateBinanceSecret,
} from "@/lib/binanceKeys";
import { validateLunoKeyId, validateLunoKeySecret } from "@/lib/lunoKeys";
import { parseBinanceQR } from "@/lib/parseBinanceQR";

type Step = "exchange" | "container" | "credentials";

export default function AddAccountScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isLoaded, isSignedIn } = useSession();
  const params = useLocalSearchParams<{
    exchange?: string;
    containerId?: string;
  }>();

  const [containers, setContainers] = useState<StoredContainer[]>([]);
  const [exchange, setExchange] = useState<ExchangeKind | null>(
    params.exchange === "binance" || params.exchange === "luno"
      ? params.exchange
      : null,
  );
  // Container state has two layers:
  //   - `containerDraft` = what the user has highlighted in the picker
  //   - `containerChoice` = what they've confirmed via the Continue button
  // We advance to the credentials step ONLY on confirm — tapping an option
  // doesn't auto-advance, so the user can change their mind and the
  // Continue button isn't bypassed. Pre-seeded via URL params skips both.
  const seeded: { kind: "existing"; id: string } | null = params.containerId
    ? { kind: "existing", id: params.containerId }
    : null;
  const [containerDraft, setContainerDraft] = useState<
    { kind: "existing"; id: string } | { kind: "new"; name: string } | null
  >(seeded);
  const [containerChoice, setContainerChoice] = useState<
    { kind: "existing"; id: string } | { kind: "new"; name: string } | null
  >(seeded);
  const [newContainerName, setNewContainerName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [revealSecret, setRevealSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanInfo, setScanInfo] = useState<string | null>(null);

  useEffect(() => {
    void listContainers().then((c) => {
      setContainers(c);
      // Auto-confirm the only existing container so a user with a single
      // account isn't forced through a redundant picker. URL-pinned choices
      // are already seeded above.
      if (!params.containerId && c.length === 1 && !containerChoice) {
        const auto = { kind: "existing" as const, id: c[0].id };
        setContainerDraft(auto);
        setContainerChoice(auto);
      }
    });
  }, []);

  const step: Step = exchange === null
    ? "exchange"
    : containerChoice === null
      ? "container"
      : "credentials";

  const onScanned = (raw: string) => {
    setScanning(false);
    const { apiKey: k, apiSecret: s } = parseBinanceQR(raw);
    if (!k && !s) {
      setError(
        "That QR code didn't contain a Binance API key. Enter it manually below.",
      );
      return;
    }
    setError(null);
    if (k) setApiKey(k);
    if (s) setApiSecret(s);
    if (k && s) setScanInfo("Scanned API key and secret. Review, then Save.");
    else if (k) setScanInfo("Scanned API key. Paste or type the secret to continue.");
    else setScanInfo("Scanned secret. Paste or type the API key to continue.");
  };

  const onSave = async () => {
    if (!exchange || !containerChoice) return;
    setError(null);

    // Container validation
    if (containerChoice.kind === "new") {
      const name = newContainerName.trim();
      if (!name) return setError("Give the account a name (e.g. \"Personal\")");
    }

    // Credentials validation
    if (exchange === "binance") {
      const ke = validateBinanceKey(apiKey);
      if (ke) return setError(ke);
      const se = validateBinanceSecret(apiSecret);
      if (se) return setError(se);
    } else {
      const ke = validateLunoKeyId(apiKey);
      if (ke) return setError(ke);
      const se = validateLunoKeySecret(apiSecret);
      if (se) return setError(se);
    }

    setBusy(true);
    try {
      await addLink(
        containerChoice.kind === "new"
          ? { kind: "new", name: newContainerName }
          : { kind: "existing", containerId: containerChoice.id },
        {
          exchange,
          label: linkLabel.trim() || undefined,
          credentials: { apiKey, apiSecret },
        },
      );
      haptic.success();
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const onCancel = () => {
    const dirty = !!(apiKey || apiSecret || newContainerName);
    if (!dirty) {
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

  const title =
    step === "exchange"
      ? "Add exchange"
      : step === "container"
        ? `Add ${exchange === "binance" ? "Binance" : "Luno"} link`
        : `Add ${exchange === "binance" ? "Binance" : "Luno"} link`;

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
            {title}
          </Text>
          {step === "credentials" ? (
            <Pressable onPress={onSave} disabled={busy} hitSlop={12}>
              {busy ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Text style={[styles.headerBtn, { color: colors.primary }]}>
                  Save
                </Text>
              )}
            </Pressable>
          ) : (
            <View style={{ width: 56 }} />
          )}
        </View>

        {step === "exchange" ? (
          <ExchangePicker
            onPick={(e) => {
              haptic.tap();
              setExchange(e);
            }}
          />
        ) : null}

        {step === "container" ? (
          <ContainerPicker
            containers={containers}
            value={containerDraft}
            newName={newContainerName}
            onPick={(choice) => {
              haptic.tap();
              setContainerDraft(choice);
              setError(null);
            }}
            onChangeNewName={setNewContainerName}
            onContinue={() => {
              if (!containerDraft) return;
              if (
                containerDraft.kind === "new" &&
                !newContainerName.trim()
              ) {
                setError("Give the account a name (e.g. \"Personal\")");
                return;
              }
              setError(null);
              setContainerChoice(containerDraft);
            }}
          />
        ) : null}

        {step === "credentials" && exchange ? (
          <CredentialsForm
            exchange={exchange}
            containerChoice={containerChoice!}
            containers={containers}
            newContainerName={newContainerName}
            onChangeNewContainerName={setNewContainerName}
            linkLabel={linkLabel}
            onChangeLinkLabel={setLinkLabel}
            apiKey={apiKey}
            apiSecret={apiSecret}
            revealSecret={revealSecret}
            onToggleReveal={() => setRevealSecret((v) => !v)}
            onChangeApiKey={setApiKey}
            onChangeApiSecret={setApiSecret}
            onScan={() => {
              setError(null);
              setScanInfo(null);
              setScanning(true);
            }}
            scanInfo={scanInfo}
          />
        ) : null}

        {error ? (
          <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>
        ) : null}
      </ScrollView>

      <QRScanner
        visible={scanning}
        onClose={() => setScanning(false)}
        onScanned={onScanned}
      />
    </KeyboardAvoidingView>
  );
}

function ExchangePicker({ onPick }: { onPick: (e: ExchangeKind) => void }) {
  const colors = useColors();
  return (
    <View style={{ gap: 12 }}>
      <Text style={[styles.bodyHint, { color: colors.mutedForeground }]}>
        Which exchange do you want to link?
      </Text>
      <ExchangeOption
        title="Binance"
        subtitle="Loans, margin, collateral, interest history."
        onPress={() => onPick("binance")}
      />
      <ExchangeOption
        title="Luno"
        subtitle="ZAR balance, BTC wallets, transactions, pending sends."
        onPress={() => onPick("luno")}
      />
      <Text style={[styles.fine, { color: colors.mutedForeground }]}>
        Use read-only keys. Credentials are encrypted in the iOS Keychain on
        this device and never leave it.
      </Text>
    </View>
  );
}

function ExchangeOption({
  title,
  subtitle,
  onPress,
}: {
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.exchangeOpt,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.exchangeTitle, { color: colors.foreground }]}>
          {title}
        </Text>
        <Text style={[styles.exchangeSub, { color: colors.mutedForeground }]}>
          {subtitle}
        </Text>
      </View>
      <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
    </Pressable>
  );
}

function ContainerPicker({
  containers,
  value,
  newName,
  onPick,
  onChangeNewName,
  onContinue,
}: {
  containers: StoredContainer[];
  value:
    | { kind: "existing"; id: string }
    | { kind: "new"; name: string }
    | null;
  newName: string;
  onPick: (
    v: { kind: "existing"; id: string } | { kind: "new"; name: string },
  ) => void;
  onChangeNewName: (s: string) => void;
  onContinue: () => void;
}) {
  const colors = useColors();
  return (
    <View style={{ gap: 12 }}>
      <Text style={[styles.bodyHint, { color: colors.mutedForeground }]}>
        Add this link to an existing account, or create a new one.
      </Text>
      {containers.map((c) => {
        const selected =
          value?.kind === "existing" && value.id === c.id;
        return (
          <Pressable
            key={c.id}
            onPress={() => onPick({ kind: "existing", id: c.id })}
            style={({ pressed }) => [
              styles.exchangeOpt,
              {
                backgroundColor: colors.card,
                borderColor: selected ? colors.primary : colors.border,
                borderRadius: colors.radius,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text
                style={[styles.exchangeTitle, { color: colors.foreground }]}
              >
                {c.name}
              </Text>
              <Text
                style={[styles.exchangeSub, { color: colors.mutedForeground }]}
              >
                {c.links.length === 0
                  ? "No exchanges linked yet"
                  : c.links.map((l) => l.exchange).join(" · ")}
              </Text>
            </View>
            {selected ? (
              <Feather name="check" size={20} color={colors.primary} />
            ) : null}
          </Pressable>
        );
      })}
      <Pressable
        onPress={() => onPick({ kind: "new", name: newName })}
        style={({ pressed }) => [
          styles.exchangeOpt,
          {
            backgroundColor: colors.card,
            borderColor: value?.kind === "new" ? colors.primary : colors.border,
            borderRadius: colors.radius,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        <View style={{ flex: 1 }}>
          <Text style={[styles.exchangeTitle, { color: colors.foreground }]}>
            New account
          </Text>
          <Text style={[styles.exchangeSub, { color: colors.mutedForeground }]}>
            Group this and any future links under a fresh name.
          </Text>
        </View>
        {value?.kind === "new" ? (
          <Feather name="check" size={20} color={colors.primary} />
        ) : null}
      </Pressable>
      {value?.kind === "new" ? (
        <TextInput
          value={newName}
          onChangeText={onChangeNewName}
          placeholder="Account name (e.g. Personal)"
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
      ) : null}
      <Pressable
        onPress={onContinue}
        disabled={!value}
        style={({ pressed }) => [
          styles.continueBtn,
          {
            backgroundColor: colors.primary,
            borderRadius: colors.radius,
            opacity: !value ? 0.4 : pressed ? 0.7 : 1,
          },
        ]}
      >
        <Text style={[styles.continueText, { color: colors.background }]}>
          Continue
        </Text>
      </Pressable>
    </View>
  );
}

function CredentialsForm({
  exchange,
  containerChoice,
  containers,
  newContainerName,
  onChangeNewContainerName,
  linkLabel,
  onChangeLinkLabel,
  apiKey,
  apiSecret,
  revealSecret,
  onToggleReveal,
  onChangeApiKey,
  onChangeApiSecret,
  onScan,
  scanInfo,
}: {
  exchange: ExchangeKind;
  containerChoice:
    | { kind: "existing"; id: string }
    | { kind: "new"; name: string };
  containers: StoredContainer[];
  newContainerName: string;
  onChangeNewContainerName: (s: string) => void;
  linkLabel: string;
  onChangeLinkLabel: (s: string) => void;
  apiKey: string;
  apiSecret: string;
  revealSecret: boolean;
  onToggleReveal: () => void;
  onChangeApiKey: (s: string) => void;
  onChangeApiSecret: (s: string) => void;
  onScan: () => void;
  scanInfo: string | null;
}) {
  const colors = useColors();
  const isBinance = exchange === "binance";
  const targetName =
    containerChoice.kind === "existing"
      ? containers.find((c) => c.id === containerChoice.id)?.name ?? "account"
      : newContainerName || "new account";

  return (
    <View style={{ gap: 20 }}>
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
          Use a read-only key. {isBinance
            ? "On Binance enable only “Read Info”."
            : "On Luno enable only Perm_R_Balance, Perm_R_Transactions, Perm_R_Orders."}
        </Text>
      </View>

      <Text style={[styles.fine, { color: colors.mutedForeground }]}>
        Linking to: <Text style={{ color: colors.foreground }}>{targetName}</Text>
      </Text>

      {isBinance ? (
        <Pressable
          onPress={onScan}
          style={({ pressed }) => [
            styles.scanBtn,
            {
              backgroundColor: colors.card,
              borderColor: colors.primary,
              borderRadius: colors.radius,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Feather name="maximize" size={18} color={colors.primary} />
          <Text style={[styles.scanBtnText, { color: colors.primary }]}>
            Scan QR code from Binance
          </Text>
        </Pressable>
      ) : null}

      {scanInfo ? (
        <Text style={[styles.scanInfo, { color: colors.primary }]}>
          {scanInfo}
        </Text>
      ) : null}

      <Field label="Label (optional)" hint="Distinguish multiple keys on the same exchange">
        <TextInput
          value={linkLabel}
          onChangeText={onChangeLinkLabel}
          placeholder={isBinance ? "e.g. Spot" : "e.g. ZAR"}
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

      {containerChoice.kind === "new" ? (
        <Field label="Account name">
          <TextInput
            value={newContainerName}
            onChangeText={onChangeNewContainerName}
            placeholder="Personal"
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
      ) : null}

      <Field label={isBinance ? "API key" : "Key ID"}>
        <TextInput
          value={apiKey}
          onChangeText={onChangeApiKey}
          placeholder={isBinance ? "64-character key from Binance" : "Luno key_id"}
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

      <Field label={isBinance ? "API secret" : "Key secret"}>
        <View style={{ position: "relative" }}>
          <TextInput
            value={apiSecret}
            onChangeText={onChangeApiSecret}
            placeholder={
              isBinance ? "64-character secret from Binance" : "Luno key_secret"
            }
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
          <Pressable onPress={onToggleReveal} style={styles.eye} hitSlop={8}>
            <Feather
              name={revealSecret ? "eye-off" : "eye"}
              size={18}
              color={colors.mutedForeground}
            />
          </Pressable>
        </View>
      </Field>

      <Text style={[styles.fine, { color: colors.mutedForeground }]}>
        {isBinance
          ? "Create a key at binance.com → API Management. Permissions: enable only “Read Info”."
          : "Create a key at luno.com → API Keys. Select only Perm_R_Balance, Perm_R_Transactions, Perm_R_Orders."}
      </Text>
    </View>
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
  bodyHint: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 19,
  },
  exchangeOpt: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  exchangeTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  exchangeSub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 16,
    marginTop: 2,
  },
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
  hint: { fontSize: 11, fontFamily: "Inter_400Regular" },
  error: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
  },
  fine: {
    fontSize: 12,
    lineHeight: 17,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  scanBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 14,
    borderWidth: 1,
  },
  scanBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  scanInfo: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
  },
  continueBtn: {
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  continueText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
