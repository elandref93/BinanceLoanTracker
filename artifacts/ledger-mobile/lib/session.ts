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

import { backendBaseUrl, isExpoGo } from "@/lib/runtime";

const SESSION_STORE_KEY = "ledger.session.v1";

const baseUrl = backendBaseUrl();

export interface SessionUser {
  sub: string;
  email: string | null;
  name: string | null;
}

export type AppleLinkWarning = "email_not_shared" | "private_relay_unlinked";

export interface Session {
  sessionToken: string;
  user: SessionUser;
  linkWarning?: AppleLinkWarning | null;
}

interface AppleSignInResponseBody {
  sessionToken: string;
  user: SessionUser;
  link?: {
    resolution?: unknown;
    warning?: unknown;
  };
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
  try {
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
      await SecureStore.deleteItemAsync(SESSION_STORE_KEY);
      return null;
    }
  } catch {
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

function mapAppleNativeError(err: unknown): unknown {
  if (!err || typeof err !== "object") return err;
  const e = err as { code?: unknown; message?: unknown };
  const code = typeof e.code === "string" ? e.code : "";
  const message = typeof e.message === "string" ? e.message : "";
  if (
    code === "ERR_UNAVAILABLE" ||
    code === "ERR_APPLE_AUTHENTICATION_UNAVAILABLE" ||
    code === "ERR_APPLE_AUTHENTICATION_UNABLE_TO_FIND_MODULE" ||
    /not available|unavailable|native module/i.test(message)
  ) {
    if (isExpoGo()) {
      return new Error(
        "This session is Expo Go, which cannot run Sign in with Apple. Close Expo Go, open the Ledger app, and connect with http://192.168.211.61:8081 (not exp://).",
      );
    }
    return new Error(
      "Sign in with Apple is missing from this Ledger binary. Reinstall the development-device IPA, then open Ledger (not Expo Go).",
    );
  }
  return err;
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
  // Visible in Metro so we can see native vs backend failures without Sentry.
  // eslint-disable-next-line no-console
  console.log("[auth] apple native start", {
    backend: baseUrl,
    expoGo: isExpoGo(),
  });
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.log("[auth] apple native error", {
      code: err && typeof err === "object" ? (err as { code?: unknown }).code : null,
      message: err instanceof Error ? err.message : String(err),
    });
    throw mapAppleNativeError(err);
  }

  if (!credential.identityToken) {
    throw new Error(
      "Apple Sign In did not return an identity token — cannot authenticate.",
    );
  }

  // eslint-disable-next-line no-console
  console.log("[auth] exchanging apple identity token");
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
    // eslint-disable-next-line no-console
    console.log("[auth] apple backend rejected", { status: response.status });
    let detail = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === "string") detail = body.error;
    } catch {
      // ignore — keep the HTTP code as the message
    }
    throw new AuthRequestError(response.status, detail);
  }

  // eslint-disable-next-line no-console
  console.log("[auth] apple backend ok");

  const body = (await response.json()) as AppleSignInResponseBody;
  if (typeof body.sessionToken !== "string" || !body.user) {
    throw new Error("Backend returned a malformed Apple Sign In response.");
  }

  const warningRaw = body.link?.warning;
  const linkWarning: AppleLinkWarning | null =
    warningRaw === "email_not_shared" || warningRaw === "private_relay_unlinked"
      ? warningRaw
      : null;

  const session: Session = {
    sessionToken: body.sessionToken,
    user: body.user,
    linkWarning,
  };
  await storeSession(session);
  return session;
}
