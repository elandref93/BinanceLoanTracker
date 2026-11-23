import { z } from "zod";

function isHttpUrlWithoutCredentials(value: string): boolean {
  if (value === "") return true;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const allowedProtocol = url.protocol === "https:" || url.protocol === "http:";
  return allowedProtocol && url.username === "" && url.password === "";
}

const WebEnvSchema = z.object({
  VITE_API_BASE_URL: z
    .string()
    .trim()
    .refine(
      isHttpUrlWithoutCredentials,
      "VITE_API_BASE_URL must be empty or an http(s) URL without embedded credentials",
    ),
});

export type WebEnv = {
  /** Empty string means same-origin `/api`. Never an exchange secret. */
  apiBaseUrl: string;
};

export function readWebEnv(source: { VITE_API_BASE_URL?: string }): WebEnv {
  const parsed = WebEnvSchema.parse({
    VITE_API_BASE_URL: source.VITE_API_BASE_URL ?? "",
  });
  return { apiBaseUrl: parsed.VITE_API_BASE_URL.replace(/\/+$/, "") };
}

export type LedgerRuntimePublic = {
  /** Present on the Azure host. Empty string means same-origin `/api`. */
  apiBaseUrl?: string;
  clerkPublishableKey?: string;
};

/**
 * The page served by the API includes runtime config and that config wins.
 * Production always sends an empty apiBaseUrl so the dashboard calls this host.
 */
export function resolveWebEnv(
  build: { VITE_API_BASE_URL?: string },
  runtime?: LedgerRuntimePublic,
): WebEnv {
  if (runtime && "apiBaseUrl" in runtime) {
    return readWebEnv({ VITE_API_BASE_URL: runtime.apiBaseUrl ?? "" });
  }
  return readWebEnv(build);
}

export function resolveClerkPublishableKey(
  buildValue: string | undefined,
  runtime?: LedgerRuntimePublic,
): string {
  if (runtime && typeof runtime.clerkPublishableKey === "string") {
    return runtime.clerkPublishableKey.trim();
  }
  return typeof buildValue === "string" ? buildValue.trim() : "";
}
