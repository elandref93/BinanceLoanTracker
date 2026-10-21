export type ReadinessCheckState = "ok" | "missing" | "unavailable";

export interface ReadinessChecks {
  encryptionKey: ReadinessCheckState;
  dataDir: ReadinessCheckState;
  microsoft: ReadinessCheckState;
}

export function microsoftConfigCheck(env: {
  MICROSOFT_TENANT_ID?: string;
  MICROSOFT_CLIENT_ID?: string;
}): "ok" | "missing" {
  const tenantId = env.MICROSOFT_TENANT_ID?.trim() ?? "";
  const clientId = env.MICROSOFT_CLIENT_ID?.trim() ?? "";
  return tenantId.length > 0 && clientId.length > 0 ? "ok" : "missing";
}

/**
 * Ready when credential encryption and the data directory are usable.
 * The Microsoft field stays in the body for the existing response shape.
 * It does not gate readiness: browser sign-in is Clerk with Apple, and a
 * missing Microsoft app registration must not mark the API down.
 */
export function aggregateReadiness(checks: ReadinessChecks): "ready" | "not_ready" {
  if (checks.encryptionKey === "ok" && checks.dataDir === "ok") {
    return "ready";
  }
  return "not_ready";
}
