import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

// Load expo-camera at runtime, not at module init, so an older dev client
// or TestFlight build (compiled before expo-camera was added) can still
// open the add-account screen — it just won't be able to scan.
type CameraModule = typeof import("expo-camera");
let cameraModule: CameraModule | null = null;
let cameraImportError: Error | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  cameraModule = require("expo-camera") as CameraModule;
} catch (err) {
  cameraImportError = err instanceof Error ? err : new Error(String(err));
}

export const isCameraAvailable = (): boolean =>
  cameraModule !== null &&
  typeof cameraModule.useCameraPermissions === "function" &&
  typeof cameraModule.CameraView === "function";

type Props = {
  visible: boolean;
  onClose: () => void;
  onScanned: (data: string) => void;
};

export function QRScanner(props: Props) {
  if (!isCameraAvailable()) {
    return <UnavailableScanner {...props} reason={cameraImportError} />;
  }
  return <RealScanner {...props} mod={cameraModule!} />;
}

function UnavailableScanner({
  visible,
  onClose,
}: Props & { reason: Error | null }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      statusBarTranslucent
    >
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          paddingTop: insets.top + 32,
          paddingHorizontal: 24,
          gap: 16,
          alignItems: "center",
        }}
      >
        <Feather name="camera-off" size={36} color={colors.mutedForeground} />
        <Text
          style={[
            styles.permTitle,
            { color: colors.foreground, textAlign: "center" },
          ]}
        >
          QR scanning needs a new build
        </Text>
        <Text style={[styles.permBody, { color: colors.mutedForeground }]}>
          The camera module was added after this build was installed. A new
          TestFlight (or dev client) build is needed before you can scan.
          For now, paste the API key and secret manually below.
        </Text>
        <Pressable
          onPress={onClose}
          style={[
            styles.permBtn,
            { backgroundColor: colors.primary, borderRadius: colors.radius },
          ]}
        >
          <Text
            style={[styles.permBtnText, { color: colors.primaryForeground }]}
          >
            OK
          </Text>
        </Pressable>
      </View>
    </Modal>
  );
}

function RealScanner({
  visible,
  onClose,
  onScanned,
  mod,
}: Props & { mod: CameraModule }) {
  const { CameraView, useCameraPermissions } = mod;
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  // Camera fires barcode callbacks continuously; one scan should hand off to
  // the caller and stop until the modal is reopened.
  const handled = useRef(false);
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    if (visible) handled.current = false;
  }, [visible]);

  // Re-poll permission whenever the scanner opens AND whenever the app
  // returns to foreground from Settings — otherwise a user who flips the
  // toggle in iOS Settings still sees the stale "denied" screen.
  useEffect(() => {
    if (!visible) return;

    void getPermission();

    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void getPermission();
    });
    return () => sub.remove();
  }, [visible, getPermission]);

  // First-time prompt only — once the OS has hard-denied, the system will
  // not show the dialog again and we must direct the user to Settings.
  useEffect(() => {
    if (!visible || !permission) return;
    if (!permission.granted && permission.canAskAgain && !requesting) {
      setRequesting(true);
      requestPermission().finally(() => setRequesting(false));
    }
  }, [visible, permission, requestPermission, requesting]);

  const handleScan = ({ data }: { data: string }) => {
    if (handled.current) return;
    handled.current = true;
    if (Platform.OS !== "web") {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    onScanned(data);
  };

  const body = () => {
    if (!permission || requesting) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      );
    }
    if (!permission.granted) {
      return (
        <View style={styles.center}>
          <Feather name="camera-off" size={32} color={colors.mutedForeground} />
          <Text style={[styles.permTitle, { color: colors.foreground }]}>
            Camera access needed
          </Text>
          <Text style={[styles.permBody, { color: colors.mutedForeground }]}>
            {permission.canAskAgain
              ? "Allow camera access to scan a Binance API QR code."
              : "Enable camera access for Ledger in iOS Settings, then try again."}
          </Text>
          <Pressable
            onPress={() => {
              if (permission.canAskAgain) {
                setRequesting(true);
                requestPermission().finally(() => setRequesting(false));
              } else {
                void Linking.openSettings();
              }
            }}
            style={[
              styles.permBtn,
              {
                backgroundColor: colors.primary,
                borderRadius: colors.radius,
              },
            ]}
          >
            <Text
              style={[styles.permBtnText, { color: colors.primaryForeground }]}
            >
              {permission.canAskAgain ? "Allow camera" : "Open Settings"}
            </Text>
          </Pressable>
        </View>
      );
    }
    return (
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={handleScan}
      >
        <View style={styles.reticleWrap} pointerEvents="none">
          <View
            style={[styles.reticle, { borderColor: colors.primary }]}
          />
          <Text style={styles.reticleHint}>
            Point at the QR code from Binance
          </Text>
        </View>
      </CameraView>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      statusBarTranslucent
    >
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        {body()}
        <View
          style={[
            styles.topBar,
            { paddingTop: insets.top + 8 },
          ]}
        >
          <Pressable
            onPress={onClose}
            hitSlop={12}
            style={styles.closeBtn}
          >
            <Feather name="x" size={22} color="#FFFFFF" />
          </Pressable>
          <Text style={styles.topTitle}>Scan API QR</Text>
          <View style={{ width: 32 }} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  closeBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  topTitle: {
    color: "#FFFFFF",
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 12,
    backgroundColor: "#000",
  },
  permTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    marginTop: 4,
  },
  permBody: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 18,
  },
  permBtn: {
    marginTop: 12,
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  permBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  reticleWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
  },
  reticle: {
    width: 240,
    height: 240,
    borderWidth: 2,
    borderRadius: 18,
    backgroundColor: "transparent",
  },
  reticleHint: {
    color: "#FFFFFF",
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowRadius: 4,
  },
});
