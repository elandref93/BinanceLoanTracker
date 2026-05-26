/**
 * Session lifecycle for the Ledger mobile app.
 *
 * After the user signs in with Apple, we receive a backend-issued session JWT
 * and persist it (plus a small user profile snapshot) in iOS Keychain via
 * expo-secure-store. The JWT is then attached to every authenticated /api/*
 * call by the api-client-react `setAuthTokenGetter` hook in (tabs)/_layout.
 *
 * Apple identity tokens are short-lived (10 minutes) and intended ONLY for the
 * single sign-in handshake — we never store them. The backend's session JWT
 * is what gates subsequent traffic; it lives for 30 days.
 */

import * as AppleAuthentication from "expo-apple-authentication";
import * as SecureStore from "expo-secure-store";

const SESSION_STORE_KEY = "ledger.session.v1";

const baseUrl = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : "";

export interface SessionUser {
  sub: string;
  email: string | null;
  name: string | null;
}

export interface Session {
  sessionToken: string;
  user: SessionUser;
}

interface AppleSignInResponseBody {
  sessionToken: string;
  user: SessionUser;
}

export class AuthRequestError extends Error {
  readonly name = "AuthRequestError";
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.status = status;
  }
}

export async function loadStoredSession(): Promise<Session | null> {
  const raw = await SecureStore.getItemAsync(SESSION_STORE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as Session).sessionToken !== "string" ||
      !(parsed as Session).user ||
      typeof (parsed as Session).user.sub !== "string"
    ) {
      await SecureStore.deleteItemAsync(SESSION_STORE_KEY);
      return null;
    }
    return parsed as Session;
  } catch {
    // Corrupted entry — clear and start fresh.
    await SecureStore.deleteItemAsync(SESSION_STORE_KEY);
    return null;
  }
}

async function storeSession(session: Session): Promise<void> {
  await SecureStore.setItemAsync(
    SESSION_STORE_KEY,
    JSON.stringify(session),
    // KEYCHAIN_ACCESSIBLE_AFTER_FIRST_UNLOCK keeps the session alive across
    // reboots without exposing it on a locked device.
    { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY },
  );
}

export async function clearStoredSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_STORE_KEY);
}

/**
 * Runs the native Apple Sign In dialog, exchanges the resulting identity
 * token at the backend's `/api/auth/apple` endpoint, and persists the
 * returned session.
 *
 * Throws `AuthRequestError` for non-2xx responses from the backend, and the
 * native module's own errors (including user-cancellation, which callers
 * should treat as a no-op rather than an error banner).
 */
export async function signInWithApple(): Promise<Session> {
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
  });

  if (!credential.identityToken) {
    throw new Error(
      "Apple Sign In did not return an identity token — cannot authenticate.",
    );
  }

  if (!baseUrl) {
    throw new Error(
      "EXPO_PUBLIC_DOMAIN is not configured — the app cannot reach the backend.",
    );
  }

  const response = await fetch(`${baseUrl}/api/auth/apple`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      identityToken: credential.identityToken,
      // Apple only returns fullName on the FIRST sign-in. Forward whatever
      // we got — the backend treats missing names as "unchanged".
      ...(credential.fullName
        ? {
            name: {
              givenName: credential.fullName.givenName,
              familyName: credential.fullName.familyName,
            },
          }
        : {}),
    }),
  });

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === "string") detail = body.error;
    } catch {
      // ignore — keep the HTTP code as the message
    }
    throw new AuthRequestError(response.status, detail);
  }

  const body = (await response.json()) as AppleSignInResponseBody;
  if (typeof body.sessionToken !== "string" || !body.user) {
    throw new Error("Backend returned a malformed Apple Sign In response.");
  }

  const session: Session = {
    sessionToken: body.sessionToken,
    user: body.user,
  };
  await storeSession(session);
  return session;
}
