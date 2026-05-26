import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

const PREF_KEY = "ledger.appLock.enabled.v1";

/**
 * Whether the user has enabled biometric/passcode lock on app open.
 * Stored in SecureStore so it survives reinstalls of the keychain item set
 * but is wiped if the user uninstalls the app.
 */
export async function isAppLockEnabled(): Promise<boolean> {
  const v = await SecureStore.getItemAsync(PREF_KEY);
  return v === "1";
}

export async function setAppLockEnabled(enabled: boolean): Promise<void> {
  if (enabled) {
    await SecureStore.setItemAsync(PREF_KEY, "1");
  } else {
    await SecureStore.deleteItemAsync(PREF_KEY);
  }
}

/**
 * Whether the device has any biometric or device-passcode auth available.
 * If false, enabling the lock would be meaningless — keep the toggle hidden.
 */
export async function isAppLockSupported(): Promise<boolean> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  if (!hasHardware) return false;
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  return enrolled;
}

/**
 * Prompts the user for Face ID / Touch ID / device passcode.
 * Returns true if authenticated, false on cancel/failure.
 */
export async function authenticateAppLock(): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: "Unlock Ledger",
    cancelLabel: "Cancel",
    fallbackLabel: "Use passcode",
    disableDeviceFallback: false,
  });
  return result.success;
}
