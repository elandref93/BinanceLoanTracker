/**
 * Production boot checks. These are intentionally not part of `/api/healthz`:
 * Azure recycles the instance when that liveness probe is non-200, and a
 * missing browser origin or encryption key must not become a recycle loop
 * signal. Production refuses to listen instead. Local and dev keep serving.
 */

export interface ProductionStartupInput {
  nodeEnv: string | undefined;
  azureHost: boolean;
  appServiceStorageEnabled: boolean;
  encryptionKeyConfigured: boolean;
  allowedOrigins: string | undefined;
  dataDirIsEphemeralFallback: boolean;
}

export interface ProductionStartupDecision {
  /** When true, a non-empty `missing` list must stop the process before listen. */
  enforce: boolean;
  missing: string[];
}

export function hasExplicitAllowedOrigins(allowedOrigins: string | undefined): boolean {
  return (allowedOrigins ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .some((origin) => origin.length > 0);
}

/**
 * Production needs an encryption key, an explicit browser allow-list, and a
 * data directory that will survive restart. On Azure that means
 * `WEBSITES_ENABLE_APP_SERVICE_STORAGE=true` and not the temp-dir fallback.
 */
export function evaluateProductionStartup(
  input: ProductionStartupInput,
): ProductionStartupDecision {
  const missing: string[] = [];
  if (!input.encryptionKeyConfigured) missing.push("CREDENTIAL_ENCRYPTION_KEY");
  const dataDirPersistent =
    !input.dataDirIsEphemeralFallback &&
    (!input.azureHost || input.appServiceStorageEnabled);
  if (!dataDirPersistent) missing.push("persistent data directory");
  if (!hasExplicitAllowedOrigins(input.allowedOrigins)) {
    missing.push("ALLOWED_ORIGINS");
  }
  return {
    enforce: input.nodeEnv === "production",
    missing,
  };
}
