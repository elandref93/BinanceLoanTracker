import { Feather } from "@expo/vector-icons";
import { reloadAppAsync } from "expo";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { reportFatal } from "@/lib/crashReporting";

export type ErrorFallbackProps = {
  error: Error;
  resetError: () => void;
};

export function ErrorFallback({ error, resetError }: ErrorFallbackProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [isModalVisible, setIsModalVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  // Persist the error to the on-device crash buffer the moment the boundary
  // renders this fallback. The boundary's onError also reports, but doing it
  // here too guarantees capture regardless of how the boundary is wired — and
  // double-reporting is harmless (the buffer is a small ring).
  useEffect(() => {
    reportFatal(error, { source: "ErrorFallback" });
  }, [error]);

  const handleRestart = async () => {
    try {
      await reloadAppAsync();
    } catch (restartError) {
      console.error("Failed to restart app:", restartError);
      resetError();
    }
  };

  const formatErrorDetails = (): string => {
    let details = `Error: ${error.message}\n\n`;
    if (error.stack) {
      details += `Stack Trace:\n${error.stack}`;
    }
    return details;
  };

  const handleCopy = async () => {
    try {
      await Clipboard.setStringAsync(formatErrorDetails());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is best-effort; the text is still selectable on screen.
    }
  };

  const handleOpenDiagnostics = () => {
    setIsModalVisible(false);
    // Reset the boundary first so the navigator can mount the next screen,
    // then route to the full Diagnostics history.
    resetError();
    try {
      router.replace("/diagnostics");
    } catch {
      // If routing fails for any reason, the reload button remains.
    }
  };

  const monoFont = Platform.select({
    ios: "Menlo",
    android: "monospace",
    default: "monospace",
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          Something went wrong
        </Text>

        <Text style={[styles.message, { color: colors.mutedForeground }]}>
          The app hit an unexpected error. Tap “View error details” and send it
          to the developer, then reload to continue.
        </Text>

        <Pressable
          onPress={handleRestart}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: colors.primary,
              opacity: pressed ? 0.9 : 1,
              transform: [{ scale: pressed ? 0.98 : 1 }],
            },
          ]}
        >
          <Text
            style={[styles.buttonText, { color: colors.primaryForeground }]}
          >
            Reload app
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setIsModalVisible(true)}
          accessibilityLabel="View error details"
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.secondaryButton,
            { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Feather name="alert-circle" size={16} color={colors.foreground} />
          <Text style={[styles.secondaryText, { color: colors.foreground }]}>
            View error details
          </Text>
        </Pressable>
      </View>

      <Modal
        visible={isModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalContainer,
              { backgroundColor: colors.background },
            ]}
          >
            <View
              style={[styles.modalHeader, { borderBottomColor: colors.border }]}
            >
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                Error Details
              </Text>
              <Pressable
                onPress={() => setIsModalVisible(false)}
                accessibilityLabel="Close error details"
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.closeButton,
                  { opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Feather name="x" size={24} color={colors.foreground} />
              </Pressable>
            </View>

            <View
              style={[styles.modalActions, { borderBottomColor: colors.border }]}
            >
              <Pressable
                onPress={handleCopy}
                style={({ pressed }) => [
                  styles.modalActionBtn,
                  { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Feather
                  name={copied ? "check" : "copy"}
                  size={14}
                  color={copied ? colors.primary : colors.foreground}
                />
                <Text
                  style={[
                    styles.modalActionText,
                    { color: copied ? colors.primary : colors.foreground },
                  ]}
                >
                  {copied ? "Copied" : "Copy details"}
                </Text>
              </Pressable>
              <Pressable
                onPress={handleOpenDiagnostics}
                style={({ pressed }) => [
                  styles.modalActionBtn,
                  { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Feather name="list" size={14} color={colors.foreground} />
                <Text
                  style={[styles.modalActionText, { color: colors.foreground }]}
                >
                  All crash logs
                </Text>
              </Pressable>
            </View>

            <ScrollView
              style={styles.modalScrollView}
              contentContainerStyle={[
                styles.modalScrollContent,
                { paddingBottom: insets.bottom + 16 },
              ]}
              showsVerticalScrollIndicator
            >
              <View
                style={[styles.errorContainer, { backgroundColor: colors.card }]}
              >
                <Text
                  style={[
                    styles.errorText,
                    { color: colors.foreground, fontFamily: monoFont },
                  ]}
                  selectable
                >
                  {formatErrorDetails()}
                </Text>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  content: {
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    width: "100%",
    maxWidth: 600,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 40,
  },
  message: {
    fontSize: 16,
    textAlign: "center",
    lineHeight: 24,
  },
  button: {
    paddingVertical: 16,
    borderRadius: 8,
    paddingHorizontal: 24,
    minWidth: 200,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  buttonText: {
    fontWeight: "600",
    textAlign: "center",
    fontSize: 16,
  },
  secondaryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  secondaryText: {
    fontSize: 14,
    fontWeight: "600",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  modalContainer: {
    width: "100%",
    height: "90%",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "600",
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  modalActions: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
  },
  modalActionText: { fontSize: 13, fontWeight: "600" },
  modalScrollView: {
    flex: 1,
  },
  modalScrollContent: {
    padding: 16,
  },
  errorContainer: {
    width: "100%",
    borderRadius: 8,
    overflow: "hidden",
    padding: 16,
  },
  errorText: {
    fontSize: 12,
    lineHeight: 18,
    width: "100%",
  },
});
